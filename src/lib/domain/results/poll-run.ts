import { prisma } from "@/lib/db/prisma";
import { ingestSeasonResults, type IngestReport } from "./ingest";
import {
  planRoundPoll,
  pollIntervals,
  selectDueRoundIds,
  sourceHealthSummary,
  strongestSuccessfulSource,
  type PollFixture,
} from "./poll";

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

/** Refresh the schedule after a multi-source fetch. A finalized round gets no next check. */
export async function syncSeasonPollState(seasonId: string, checkedAt: Date, sources: IngestReport["sources"]): Promise<void> {
  const rounds = await prisma.round.findMany({
    where: { seasonId },
    include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
  });
  const intervals = pollIntervals();
  const summary = sourceHealthSummary(sources);
  const lastSuccessfulSource = strongestSuccessfulSource(sources);
  for (const round of rounds) {
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

export async function ingestAndTrack(seasonId: string): Promise<IngestReport> {
  const report = await ingestSeasonResults(seasonId);
  await syncSeasonPollState(seasonId, new Date(), report.sources);
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
    const plan = planRoundPoll(round.matches.map(toPollFixture), now, intervals);
    if (!plan.active && (round.pollStatus !== "finalized" || round.nextPollAt != null)) {
      await prisma.round.update({
        where: { id: round.id },
        data: { pollStatus: "finalized", nextPollAt: null },
      });
    }
  }
  const dueIds = new Set(
    selectDueRoundIds(
      rounds.map((round) => ({
        id: round.id,
        nextPollAt: round.nextPollAt,
        matches: round.matches.map(toPollFixture),
      })),
      now,
      intervals,
      options?.forceRoundId,
    ),
  );
  const seasonIds = [...new Set(rounds.filter((round) => dueIds.has(round.id)).map((round) => round.seasonId))];
  if (seasonIds.length === 0) {
    return { checked: false, roundIds: [], seasons: [] };
  }
  const seasons = [];
  for (const seasonId of seasonIds) {
    const report = await ingestAndTrack(seasonId);
    seasons.push({ seasonId, report });
  }
  return { checked: true, roundIds: [...dueIds], seasons };
}
