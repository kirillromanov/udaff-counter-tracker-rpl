import { prisma } from "@/lib/db/prisma";
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
import { parseStoredComments, saveForumPost } from "./persist-import";

export interface PredictionRefreshReport {
  roundId: string;
  seasonId: string;
  number: number;
  counts: IngestionCounts;
  summary: string;
  plan: PredictionRefreshPlan;
  failed: boolean;
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
 * Fetch one round's thread, store new and updated comments, and parse slips.
 * This does not calculate round scores. Live standings read the selected slips on the next page load.
 */
export async function refreshRoundPredictions(
  roundId: string,
  options?: { url?: string; now?: Date; fetchPost?: (url: string) => Promise<ForumPost> },
): Promise<PredictionRefreshReport> {
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
  const plan = planPredictionRefresh(
    { standingRole: round.standingRole, hasForumUrl: true, fixtures: round.matches.map(toPollFixture) },
    now,
  );
  await prisma.round.update({
    where: { id: roundId },
    data: {
      fetchedAt: post.fetchedAt ?? now,
      lastPredictionFetchAt: now,
      nextPredictionFetchAt: plan.nextAt,
      predictionFetchSummary: summary,
    },
  });
  return { roundId, seasonId: round.seasonId, number: round.number, counts, summary, plan, failed: false };
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
      const message = error instanceof Error ? error.message : "Prediction refresh failed";
      const plan = planPredictionRefresh(
        {
          standingRole: round?.standingRole ?? "operational",
          hasForumUrl: true,
          fixtures: (round?.matches ?? []).map(toPollFixture),
        },
        now,
      );
      await prisma.round.update({
        where: { id: roundId },
        data: {
          lastPredictionFetchAt: now,
          nextPredictionFetchAt: plan.nextAt,
          predictionFetchSummary: message,
        },
      });
      reports.push({
        roundId,
        seasonId: round?.seasonId ?? "",
        number: round?.number ?? 0,
        counts: emptyIngestionCounts(),
        summary: message,
        plan,
        failed: true,
      });
    }
  }
  return { checked: dueIds.length > 0, rounds: reports };
}
