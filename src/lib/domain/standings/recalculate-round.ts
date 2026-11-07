import { prisma } from "@/lib/db/prisma";
import { defaultScoringConfig, scoringConfigFromRecord } from "@/lib/config/scoring";
import type { RoundScoreResult } from "@/lib/domain/scoring/types";
import type { StoredBreakdown } from "@/lib/domain/export/export-audit";
import { ARCHIVED_ROUND } from "./round-role";
import { rebuildSeasonSnapshots } from "./build-season-standings";
import {
  ROUND_STATUS_PARTIAL,
  ROUND_STATUS_SCORED,
  scoreIntermediateRound,
  type IntermediateFixture,
} from "./intermediate";
import { rosterIdsToScore } from "./roster-scores";
import { slipsByParticipant } from "@/lib/domain/import/effective-slip";

interface SelectedSet {
  participantId: string;
  updatedAt: Date;
  predictions: {
    matchId: string;
    homeGoals: number | null;
    awayGoals: number | null;
    ignored: boolean;
  }[];
}

export function oneSelectedSetPerParticipant(sets: SelectedSet[]): SelectedSet[] {
  const chosen = new Map<string, SelectedSet>();
  for (const set of sets) {
    const current = chosen.get(set.participantId);
    if (!current || set.updatedAt > current.updatedAt) {
      chosen.set(set.participantId, set);
    }
  }
  return [...chosen.values()];
}

export function winnerIds(results: { participantId: string; total: number }[]): Set<string> {
  if (results.length === 0) {
    return new Set();
  }
  const max = Math.max(...results.map((result) => result.total));
  return new Set(results.filter((result) => result.total === max).map((result) => result.participantId));
}

function breakdownOf(
  result: RoundScoreResult,
  labels: Map<string, string>,
  actuals: Map<string, { home: number; away: number }>,
  predictions: Map<string, { home: number; away: number } | null>,
): StoredBreakdown {
  return {
    matches: result.matches.map((match) => {
      const predicted = predictions.get(match.matchId);
      const actual = actuals.get(match.matchId);
      return {
        label: labels.get(match.matchId) ?? match.matchId,
        predicted: predicted ? `${predicted.home}-${predicted.away}` : "—",
        actual: actual ? `${actual.home}-${actual.away}` : "—",
        baseCategory: match.baseCategory,
        basePoints: match.basePoints,
        bonusPoints: match.bonusPoints,
        mtMultiplier: match.mtMultiplier,
        mtApplied: match.mtApplied,
        finalMatchPoints: match.finalMatchPoints,
        explanations: match.explanations,
      };
    }),
    matchPointsTotal: result.matchPointsTotal,
    roundTotalGoalsBonus: result.roundTotalGoalsBonus,
    roundTotal: result.roundTotal,
  };
}

export interface RoundCalculationReport {
  participants: number;
  status: "empty" | "partial" | "complete";
  included: number;
  total: number;
}

export async function recalculateRound(roundId: string): Promise<RoundCalculationReport> {
  const round = await prisma.round.findUniqueOrThrow({
    where: { id: roundId },
    include: {
      matches: { orderBy: { sortOrder: "asc" }, include: { resultObservations: { select: { matchStatus: true } } } },
      predictionSets: {
        include: { predictions: true, forumComment: { select: { postedAt: true } } },
      },
      season: {
        include: {
          scoringConfig: true,
          participants: {
            where: { status: "included", participant: { archivedAt: null } },
            select: { participantId: true },
          },
        },
      },
    },
  });

  if (round.matches.length === 0) {
    throw new Error("Add fixtures before calculating this round");
  }
  const fixtures: IntermediateFixture[] = round.matches.map((match) => ({
    matchId: match.id,
    label: `${match.homeTeam} — ${match.awayTeam}`,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    isMatchOfTheRound: match.isMatchOfTheRound,
    observationStatuses: match.resultObservations.map((observation) => observation.matchStatus),
  }));
  const config = round.season.scoringConfig
    ? scoringConfigFromRecord(round.season.scoringConfig)
    : defaultScoringConfig;
  const fixtureIds = round.matches.map((match) => match.id);
  const slips = slipsByParticipant(
    fixtureIds,
    round.predictionSets.filter((set) => set.selected).map((set) => ({
      id: set.id,
      participantId: set.participantId,
      selection: set.selection,
      manuallyEdited: set.manuallyEdited,
      createdAt: set.createdAt,
      postedAt: set.forumComment?.postedAt ?? null,
      predictions: set.predictions,
    })),
  );
  const slipsById = new Map(slips.map((slip) => [slip.participantId, slip]));
  const selectedIds = slips.map((slip) => slip.participantId);
  const selectedIdSet = new Set(selectedIds);
  const unresolvedIds = [
    ...new Set(
      round.predictionSets
        .filter((set) => set.attributionReview === "review" && !selectedIdSet.has(set.participantId))
        .map((set) => set.participantId),
    ),
  ];
  const scoreIds = rosterIdsToScore({
    rosterIds: round.season.participants.map((membership) => membership.participantId),
    selectedIds,
    unresolvedIds,
  });
  if (scoreIds.length === 0) {
    throw new Error("No selected prediction set to score");
  }
  const calculation = scoreIntermediateRound(
    {
      roundId,
      fixtures,
      participants: scoreIds.map((participantId) => {
        const slip = slipsById.get(participantId);
        return {
          participantId,
          unresolvedMatchIds: slip?.unresolvedMatchIds ?? [],
          predictions: (slip?.predictions ?? []).map((prediction) => ({
            matchId: prediction.matchId,
            home: prediction.home,
            away: prediction.away,
            ignored: false,
          })),
        };
      }),
    },
    config,
  );
  if (round.standingRole === ARCHIVED_ROUND && calculation.status !== "complete") {
    const waiting = calculation.excluded.map((fixture) => `${fixture.label} (${fixture.reason})`);
    throw new Error(
      `This round is still live: ${waiting.join(", ")}. Provisional points stay on the results page. A confirmed total is stored only after every fixture is verified.`,
    );
  }

  const labels = new Map(round.matches.map((match) => [match.id, `${match.homeTeam} — ${match.awayTeam}`]));
  const actuals = new Map(
    round.matches.flatMap((match) =>
      match.actualHomeGoals == null || match.actualAwayGoals == null
        ? []
        : [[match.id, { home: match.actualHomeGoals, away: match.actualAwayGoals }] as const],
    ),
  );
  const winners =
    calculation.status === "complete"
      ? winnerIds(calculation.scores.map((item) => ({ participantId: item.participantId, total: item.result.roundTotal })))
      : new Set<string>();

  await prisma.$transaction(async (tx) => {
    await tx.roundScore.deleteMany({ where: { roundId } });
    if (calculation.scores.length > 0) {
      await tx.roundScore.createMany({
        data: calculation.scores.map(({ result, predictedByMatch }) => ({
          roundId,
          participantId: result.participantId,
          totalPoints: result.roundTotal,
          matchPoints: result.matchPointsTotal,
          roundBonusPoints: result.roundTotalGoalsBonus,
          exactCount: result.summary.exactCount,
          neighborCount: result.summary.neighborCount,
          diffCount: result.summary.diffCount,
          outcomeCount: result.summary.outcomeCount,
          missCount: result.summary.missCount,
          isRoundWinner: winners.has(result.participantId),
          breakdownJson: JSON.stringify(breakdownOf(result, labels, actuals, predictedByMatch)),
        })),
      });
    }
    if (calculation.status !== "complete") {
      await tx.standingSnapshot.deleteMany({ where: { roundId } });
    }
    await tx.round.update({
      where: { id: roundId },
      data: { status: calculation.status === "complete" ? ROUND_STATUS_SCORED : calculation.status === "partial" ? ROUND_STATUS_PARTIAL : "open" },
    });
  });

  if (calculation.status === "complete") {
    await rebuildSeasonSnapshots(round.seasonId, round.number);
  }
  return {
    participants: calculation.scores.length,
    status: calculation.status,
    included: calculation.includedCount,
    total: calculation.fixtureCount,
  };
}
