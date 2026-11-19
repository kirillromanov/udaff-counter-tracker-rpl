import { prisma } from "@/lib/db/prisma";
import type { PollFixture } from "@/lib/domain/results/poll";
import type { WorkerRound } from "./plan";

/** Scheduling columns only. Comment text is not loaded. */
export async function loadWorkerRounds(): Promise<WorkerRound[]> {
  const rounds = await prisma.round.findMany({
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      standingRole: true,
      forumUrl: true,
      nextPollAt: true,
      nextPredictionFetchAt: true,
      closedAt: true,
      productionStartedAt: true,
      matches: {
        select: {
          kickoffAt: true,
          actualHomeGoals: true,
          actualAwayGoals: true,
          resultState: true,
          resultResolution: true,
          resultConflict: true,
          conflictAcknowledgedAt: true,
          autoCheckAttempts: true,
          autoCheckKickoffAt: true,
          autoCheckNextAt: true,
          autoCheckHistory: true,
          resultObservations: { select: { matchStatus: true } },
        },
      },
    },
  });
  return rounds.map((round) => ({
    id: round.id,
    number: round.number,
    standingRole: round.standingRole,
    forumUrl: round.forumUrl,
    nextPollAt: round.nextPollAt,
    nextPredictionFetchAt: round.nextPredictionFetchAt,
    closedAt: round.closedAt,
    productionStartedAt: round.productionStartedAt,
    matches: round.matches.map(toFixture),
  }));
}

function toFixture(match: {
  kickoffAt: Date | null;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledgedAt: Date | null;
  autoCheckAttempts: number;
  autoCheckKickoffAt: Date | null;
  autoCheckNextAt: Date | null;
  autoCheckHistory: string;
  resultObservations: readonly { matchStatus: string }[];
}): PollFixture {
  const statuses = new Set(match.resultObservations.map((observation) => observation.matchStatus));
  let providerStatus: PollFixture["providerStatus"] = null;
  for (const status of ["postponed", "cancelled", "suspended", "live"] as const) {
    if (statuses.has(status)) {
      providerStatus = status;
      break;
    }
  }
  return {
    kickoffAt: match.kickoffAt,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledgedAt: match.conflictAcknowledgedAt,
    autoCheckAttempts: match.autoCheckAttempts,
    autoCheckKickoffAt: match.autoCheckKickoffAt,
    autoCheckNextAt: match.autoCheckNextAt,
    autoCheckHistory: match.autoCheckHistory,
    liveReported: statuses.has("live"),
    providerStatus,
  };
}
