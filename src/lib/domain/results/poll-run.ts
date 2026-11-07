import { prisma } from "@/lib/db/prisma";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";
import { recalculateRound, type RoundCalculationReport } from "@/lib/domain/standings/recalculate-round";
import { ROUND_STATUS_STALE } from "@/lib/domain/standings/intermediate";
import { ingestRoundResults, ingestSeasonResults, type IngestReport } from "./ingest";
import {
  advanceFixtureCheck,
  fixtureBlocksPolling,
  planRoundPoll,
  pollIntervals,
  selectDueRoundIds,
  sourceHealthSummary,
  strongestSuccessfulSource,
  type PollFixture,
} from "./poll";

function toPollFixture(match: {
  kickoffAt: Date | null;
  actualHomeGoals?: number | null;
  actualAwayGoals?: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledgedAt: Date | null;
  autoCheckAttempts?: number;
  autoCheckKickoffAt?: Date | null;
  autoCheckNextAt?: Date | null;
  autoCheckHistory?: string;
  resultObservations?: readonly { matchStatus: string }[];
}): PollFixture {
  return {
    kickoffAt: match.kickoffAt,
    actualHomeGoals: match.actualHomeGoals ?? null,
    actualAwayGoals: match.actualAwayGoals ?? null,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledgedAt: match.conflictAcknowledgedAt,
    autoCheckAttempts: match.autoCheckAttempts,
    autoCheckKickoffAt: match.autoCheckKickoffAt,
    autoCheckNextAt: match.autoCheckNextAt,
    autoCheckHistory: match.autoCheckHistory,
    liveReported: match.resultObservations?.some((observation) => observation.matchStatus === "live") ?? false,
    providerStatus: providerStatusOf(match.resultObservations),
  };
}

function providerStatusOf(
  observations: readonly { matchStatus: string }[] | undefined,
): PollFixture["providerStatus"] {
  const statuses = new Set(observations?.map((observation) => observation.matchStatus) ?? []);
  for (const status of ["postponed", "cancelled", "suspended", "live"] as const) {
    if (statuses.has(status)) {
      return status;
    }
  }
  return null;
}

const roundRefreshLocks = new Set<string>();

/** One ingestion at a time for a round. A second caller leaves the stored scores alone. */
export function beginRoundRefresh(roundId: string): boolean {
  if (roundRefreshLocks.has(roundId)) {
    return false;
  }
  roundRefreshLocks.add(roundId);
  return true;
}

export function finishRoundRefresh(roundId: string): void {
  roundRefreshLocks.delete(roundId);
}

export interface RoundRefreshReport extends IngestReport {
  busy: boolean;
  recalculated: boolean;
  calculation: RoundCalculationReport["status"] | "skipped" | "stale";
  included: number;
  total: number;
}

/**
 * Fetch and apply actual results for one round.
 * Manual buttons and the due-round poll use this same ingestion path.
 * A busy lock does not fetch again and does not change stored scores.
 */
export async function refreshRoundResults(roundId: string, options?: { automatic?: boolean }): Promise<RoundRefreshReport> {
  if (!beginRoundRefresh(roundId)) {
    return {
      busy: true,
      recalculated: false,
      calculation: "skipped",
      included: 0,
      total: 0,
      confirmed: 0,
      verified: 0,
      conflicts: 0,
      insufficient: 0,
      updated: 0,
      sources: [],
    };
  }
  try {
    const report = await ingestRoundResults(roundId);
    await syncRoundPollState(roundId, new Date(), report.sources, options?.automatic === true);
    const round = await prisma.round.findUniqueOrThrow({
      where: { id: roundId },
      select: { standingRole: true },
    });
    if (round.standingRole === ARCHIVED_ROUND) {
      return { ...report, busy: false, recalculated: false, calculation: "skipped", included: 0, total: 0 };
    }
    try {
      const calculation = await recalculateRound(roundId);
      return {
        ...report,
        busy: false,
        recalculated: true,
        calculation: calculation.status,
        included: calculation.included,
        total: calculation.total,
      };
    } catch (error) {
      await prisma.round.update({ where: { id: roundId }, data: { status: ROUND_STATUS_STALE } });
      console.error(error);
      return { ...report, busy: false, recalculated: false, calculation: "stale", included: 0, total: 0 };
    }
  } finally {
    finishRoundRefresh(roundId);
  }
}

async function persistFixtureCheck(
  match: {
    id: string;
    kickoffAt: Date | null;
    resultState: string;
    resultResolution: string;
    resultConflict: boolean;
    conflictAcknowledgedAt: Date | null;
    autoCheckAttempts: number;
    autoCheckKickoffAt: Date | null;
    autoCheckNextAt: Date | null;
    autoCheckHistory: string;
    resultObservations?: readonly { matchStatus: string }[];
  },
  checkedAt: Date,
  automatic: boolean,
): Promise<void> {
  const fixture = toPollFixture(match);
  const next = advanceFixtureCheck(
    {
      kickoffAt: match.kickoffAt,
      autoCheckAttempts: match.autoCheckAttempts,
      autoCheckKickoffAt: match.autoCheckKickoffAt,
      autoCheckNextAt: match.autoCheckNextAt,
      autoCheckHistory: match.autoCheckHistory,
      verified:
        !match.resultConflict &&
        (match.resultState === "verified" ||
          match.resultState === "manual" ||
          match.resultResolution === "verified" ||
          match.resultResolution === "manual"),
      held: fixture.providerStatus === "postponed" || fixture.providerStatus === "cancelled" || fixture.providerStatus === "suspended",
      acknowledged: Boolean(fixture.resultConflict && fixture.conflictAcknowledgedAt),
    },
    checkedAt,
    automatic,
  );
  if (
    next.autoCheckAttempts !== match.autoCheckAttempts ||
    next.autoCheckNextAt?.getTime() !== match.autoCheckNextAt?.getTime() ||
    next.autoCheckKickoffAt?.getTime() !== match.autoCheckKickoffAt?.getTime() ||
    next.autoCheckHistory !== match.autoCheckHistory
  ) {
    await prisma.match.update({
      where: { id: match.id },
      data: {
        autoCheckAttempts: next.autoCheckAttempts,
        autoCheckKickoffAt: next.autoCheckKickoffAt,
        autoCheckNextAt: next.autoCheckNextAt,
        autoCheckHistory: next.autoCheckHistory ?? "[]",
      },
    });
    match.autoCheckAttempts = next.autoCheckAttempts;
    match.autoCheckKickoffAt = next.autoCheckKickoffAt;
    match.autoCheckNextAt = next.autoCheckNextAt;
    match.autoCheckHistory = next.autoCheckHistory ?? "[]";
  }
}

async function syncRoundPollState(
  roundId: string,
  checkedAt: Date,
  sources: IngestReport["sources"],
  automatic: boolean,
): Promise<void> {
  const round = await prisma.round.findUniqueOrThrow({
    where: { id: roundId },
    include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
  });
  const intervals = pollIntervals();
  for (const match of round.matches) {
    await persistFixtureCheck(match, checkedAt, automatic);
  }
  const plan = planRoundPoll(round.matches.map(toPollFixture), checkedAt, intervals);
  const lastSuccessfulSource = strongestSuccessfulSource(sources);
  await prisma.round.update({
    where: { id: round.id },
    data: {
      pollStatus: plan.pollStatus,
      lastPolledAt: checkedAt,
      nextPollAt: plan.nextPollAt,
      lastSuccessfulSource: lastSuccessfulSource ?? round.lastSuccessfulSource,
      pollHealthSummary: sourceHealthSummary(sources),
    },
  });
}

/** Refresh the schedule after a multi-source fetch. A finalized round gets no next check. */
export async function syncSeasonPollState(
  seasonId: string,
  checkedAt: Date,
  sources: IngestReport["sources"],
  options?: { includeArchivedRoundIds?: readonly string[] },
): Promise<void> {
  const rounds = await prisma.round.findMany({
    where: { seasonId },
    include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
  });
  const extra = new Set(options?.includeArchivedRoundIds ?? []);
  const intervals = pollIntervals();
  const summary = sourceHealthSummary(sources);
  const lastSuccessfulSource = strongestSuccessfulSource(sources);
  for (const round of rounds) {
    if (round.standingRole === ARCHIVED_ROUND && !extra.has(round.id)) {
      continue;
    }
    for (const match of round.matches) {
      await persistFixtureCheck(match, checkedAt, false);
    }
    const plan = planRoundPoll(round.matches.map(toPollFixture), checkedAt, intervals);
    await prisma.round.update({
      where: { id: round.id },
      data: {
        pollStatus: plan.pollStatus,
        lastPolledAt: checkedAt,
        nextPollAt: plan.nextPollAt,
        lastSuccessfulSource: lastSuccessfulSource ?? round.lastSuccessfulSource,
        pollHealthSummary: summary,
      },
    });
  }
}

export async function ingestAndTrack(
  seasonId: string,
  options?: { includeArchivedRoundIds?: readonly string[] },
): Promise<IngestReport> {
  const report = await ingestSeasonResults(seasonId, options);
  await syncSeasonPollState(seasonId, new Date(), report.sources, options);
  return report;
}

export interface PollRunReport {
  checked: boolean;
  roundIds: string[];
  seasons: { seasonId: string; report: IngestReport }[];
}

/**
 * Check rounds whose next poll time has arrived.
 * A finalized round is skipped. Nothing is fetched when no round is due.
 * The dev server does not run this on a timer. Use the admin button or `npm run results:poll`.
 */
export async function pollDueRounds(options?: { now?: Date; forceRoundId?: string }): Promise<PollRunReport> {
  const now = options?.now ?? new Date();
  const intervals = pollIntervals();
  const rounds = await prisma.round.findMany({
    include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
  });
  for (const round of rounds) {
    if (round.standingRole === ARCHIVED_ROUND && round.id !== options?.forceRoundId) {
      continue;
    }
    const fixtures = round.matches.map(toPollFixture);
    const plan = planRoundPoll(fixtures, now, intervals);
    const open = fixtures.some((fixture) => fixtureBlocksPolling(fixture, now));
    if (!open && (round.pollStatus !== "finalized" || round.nextPollAt != null)) {
      await prisma.round.update({
        where: { id: round.id },
        data: { pollStatus: "finalized", nextPollAt: null },
      });
      round.pollStatus = "finalized";
      round.nextPollAt = null;
    } else if (!plan.active && round.nextPollAt != null) {
      await prisma.round.update({
        where: { id: round.id },
        data: { pollStatus: plan.pollStatus, nextPollAt: null },
      });
      round.pollStatus = plan.pollStatus;
      round.nextPollAt = null;
    }
  }
  const dueIds = new Set(
    selectDueRoundIds(
      rounds.map((round) => ({
        id: round.id,
        nextPollAt: round.nextPollAt,
        standingRole: round.standingRole,
        matches: round.matches.map(toPollFixture),
      })),
      now,
      intervals,
      options?.forceRoundId,
    ),
  );
  if (dueIds.size === 0) {
    return { checked: false, roundIds: [], seasons: [] };
  }
  const grouped = new Map<string, IngestReport>();
  for (const roundId of dueIds) {
    const round = rounds.find((item) => item.id === roundId);
    if (!round) {
      continue;
    }
    const report = await refreshRoundResults(roundId, { automatic: options?.forceRoundId !== roundId });
    const current = grouped.get(round.seasonId);
    grouped.set(round.seasonId, current ? combineReports(current, report) : report);
  }
  return {
    checked: true,
    roundIds: [...dueIds],
    seasons: [...grouped.entries()].map(([seasonId, report]) => ({ seasonId, report })),
  };
}

function combineReports(left: IngestReport, right: IngestReport): IngestReport {
  return {
    confirmed: left.confirmed + right.confirmed,
    verified: left.verified + right.verified,
    conflicts: left.conflicts + right.conflicts,
    insufficient: left.insufficient + right.insufficient,
    updated: left.updated + right.updated,
    sources: [...left.sources, ...right.sources],
  };
}
