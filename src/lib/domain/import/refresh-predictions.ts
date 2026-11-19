import { prisma } from "@/lib/db/prisma";
import { RoundClosedError } from "@/lib/domain/rounds/round-lock";
import { assertRoundMutable } from "@/lib/domain/rounds/round-lock-db";
import { fetchForumPost } from "@/lib/domain/forum/fetch-post";
import type { ForumPost } from "@/lib/domain/forum/types";
import { pollIntervals, type PollFixture } from "@/lib/domain/results/poll";
import {
  countThisFetch,
  emptyIngestionCounts,
  formatIngestionCounts,
  planPredictionRefresh,
  selectDuePredictionRoundIds,
  type IngestionCounts,
  type PredictionRefreshPlan,
} from "./incremental";
import { acquireClaim } from "@/lib/domain/worker/claims";
import { ensureRoundFixtures } from "./ensure-fixtures";
import { parseStoredComments, saveForumPost } from "./persist-import";

const predictionRefreshLocks = new Set<string>();

export interface PredictionRefreshReport {
  roundId: string;
  seasonId: string;
  number: number;
  counts: IngestionCounts;
  summary: string;
  plan: PredictionRefreshPlan;
  failed: boolean;
  /** True when this process or another process already holds the round. Nothing was fetched. */
  busy: boolean;
}

export interface PredictionDueReport {
  checked: boolean;
  rounds: PredictionRefreshReport[];
}

function toPollFixture(match: {
  kickoffAt: Date | null;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledgedAt: Date | null;
  resultObservations?: readonly { matchStatus: string }[];
}): PollFixture {
  return {
    kickoffAt: match.kickoffAt,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledgedAt: match.conflictAcknowledgedAt,
    liveReported: match.resultObservations?.some((observation) => observation.matchStatus === "live") ?? false,
  };
}

/**
 * Record a failed prediction fetch without moving fixture retry counters.
 * A round that closed during the request is left unchanged.
 */
export async function notePredictionRefreshFailure(roundId: string, now: Date, message: string): Promise<PredictionRefreshPlan> {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
  });
  const plan = planPredictionRefresh(
    {
      standingRole: round?.standingRole ?? "operational",
      hasForumUrl: Boolean(round?.forumUrl),
      productionStartedAt: round?.productionStartedAt,
      fixtures: (round?.matches ?? []).map(toPollFixture),
    },
    now,
  );
  if (!round || round.closedAt) {
    return plan;
  }
  try {
    await assertRoundMutable(roundId);
    await prisma.round.update({
      where: { id: roundId },
      data: {
        lastPredictionFetchAt: now,
        nextPredictionFetchAt: plan.nextAt,
        predictionFetchSummary: message,
      },
    });
  } catch (error) {
    if (!(error instanceof RoundClosedError)) {
      throw error;
    }
  }
  return plan;
}

/**
 * Fetch one round's thread, store new and updated comments, and parse slips.
 * This does not calculate round scores. Live standings read the selected slips on the next page load.
 */
export async function refreshRoundPredictions(
  roundId: string,
  options?: { url?: string; now?: Date; claimDir?: string; fetchPost?: (url: string) => Promise<ForumPost> },
): Promise<PredictionRefreshReport> {
  if (predictionRefreshLocks.has(roundId)) {
    return busyPredictionReport(roundId);
  }
  predictionRefreshLocks.add(roundId);
  let release: (() => Promise<void>) | null = null;
  try {
    const claimDir = options?.claimDir ?? process.env.WORKER_LOCK_DIR;
    if (claimDir) {
      release = await acquireClaim(claimDir, `prediction-${roundId}`);
      if (!release) {
        return busyPredictionReport(roundId);
      }
    }
    await assertRoundMutable(roundId);
  const round = await prisma.round.findUniqueOrThrow({
    where: { id: roundId },
    include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
  });
  const url = options?.url?.trim() || round.forumUrl;
  if (!url) {
    throw new Error("Add the forum URL before predictions can be refreshed.");
  }
  const now = options?.now ?? new Date();
  const load = options?.fetchPost ?? fetchForumPost;
  const post = await load(url);
  const fixtures = await ensureRoundFixtures(roundId, post);
  const saved = await saveForumPost(roundId, post);
  await parseStoredComments(roundId);
  const comments = await prisma.forumComment.findMany({
    where: { roundId },
    select: { externalId: true, ingestionStatus: true },
  });
  const counts = countThisFetch(
    saved.classes,
    new Map(
      comments.flatMap((comment) => (comment.externalId ? [[comment.externalId, comment.ingestionStatus] as const] : [])),
    ),
  );
  const summary = formatIngestionCounts(counts);
  const scheduled = fixtures.createdFixtures.map((fixture) =>
    toPollFixture({
      kickoffAt: fixture.kickoffAt,
      actualHomeGoals: null,
      actualAwayGoals: null,
      resultState: "open",
      resultResolution: "",
      resultConflict: false,
      conflictAcknowledgedAt: null,
    }),
  );
  const plan = planPredictionRefresh(
    {
      standingRole: round.standingRole,
      hasForumUrl: true,
      productionStartedAt: round.productionStartedAt,
      fixtures: fixtures.created ? scheduled : round.matches.map(toPollFixture),
    },
    now,
  );
  await assertRoundMutable(roundId);
  await prisma.round.update({
    where: { id: roundId },
    data: {
      fetchedAt: post.fetchedAt ?? now,
      lastPredictionFetchAt: now,
      nextPredictionFetchAt: plan.nextAt,
      predictionFetchSummary: summary,
    },
  });
  return { roundId, seasonId: round.seasonId, number: round.number, counts, summary, plan, failed: false, busy: false };
  } finally {
    predictionRefreshLocks.delete(roundId);
    await release?.();
  }
}

function busyPredictionReport(roundId: string): PredictionRefreshReport {
  return {
    roundId,
    seasonId: "",
    number: 0,
    counts: emptyIngestionCounts(),
    summary: "Skipped because another refresh holds this round.",
    plan: { active: false, nextAt: null, reason: "busy" },
    failed: false,
    busy: true,
  };
}

/**
 * Refresh operational rounds whose next prediction fetch has arrived.
 * Archived rounds and rounds with final results are left out.
 * The dev server does not run this on a timer. Use the review page or `npm run predictions:refresh`.
 */
export async function refreshDuePredictions(options?: {
  now?: Date;
  forceRoundId?: string;
  fetchPost?: (url: string) => Promise<ForumPost>;
}): Promise<PredictionDueReport> {
  const now = options?.now ?? new Date();
  const rounds = await prisma.round.findMany({
    where: { forumUrl: { not: null } },
    include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
  });
  const dueIds = selectDuePredictionRoundIds(
    rounds.map((round) => ({
      id: round.id,
      standingRole: round.standingRole,
      forumUrl: round.forumUrl,
      nextPredictionFetchAt: round.nextPredictionFetchAt,
      closedAt: round.closedAt,
      productionStartedAt: round.productionStartedAt,
      matches: round.matches.map(toPollFixture),
    })),
    now,
    pollIntervals(),
    options?.forceRoundId,
  );
  const reports: PredictionRefreshReport[] = [];
  for (const roundId of dueIds) {
    const round = rounds.find((item) => item.id === roundId);
    try {
      reports.push(await refreshRoundPredictions(roundId, { now, fetchPost: options?.fetchPost }));
    } catch (error) {
      if (error instanceof RoundClosedError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Prediction refresh failed";
      const plan = await notePredictionRefreshFailure(roundId, now, message);
      reports.push({
        roundId,
        seasonId: round?.seasonId ?? "",
        number: round?.number ?? 0,
        counts: emptyIngestionCounts(),
        summary: message,
        plan,
        failed: true,
        busy: false,
      });
    }
  }
  return { checked: dueIds.length > 0, rounds: reports };
}
