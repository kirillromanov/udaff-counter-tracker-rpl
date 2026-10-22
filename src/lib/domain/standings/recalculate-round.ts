import { prisma } from "@/lib/db/prisma";
import { defaultScoringConfig, scoringConfigFromRecord } from "@/lib/config/scoring";
import { fixtureConfidence, type LiveFixtureInput } from "@/lib/domain/scoring/live-score";
import { scoreRound } from "@/lib/domain/scoring/score-round";
import type { RoundScoreResult } from "@/lib/domain/scoring/types";
import type { StoredBreakdown } from "@/lib/domain/export/export-audit";
import { rebuildSeasonSnapshots } from "./build-season-standings";

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

export async function recalculateRound(roundId: string): Promise<number> {
  const round = await prisma.round.findUniqueOrThrow({
    where: { id: roundId },
    include: {
      matches: { orderBy: { sortOrder: "asc" } },
      season: { include: { scoringConfig: true } },
      predictionSets: {
        where: { selected: true },
        include: { predictions: true },
      },
    },
  });

  if (round.matches.length === 0) {
    throw new Error("Add fixtures before calculating this round");
  }
  const unconfirmed = round.matches.flatMap((match) => {
    const fixture: LiveFixtureInput = {
      matchId: match.id,
      label: `${match.homeTeam} — ${match.awayTeam}`,
      actualHomeGoals: match.actualHomeGoals,
      actualAwayGoals: match.actualAwayGoals,
      resultState: match.resultState,
      resultResolution: match.resultResolution,
      resultConflict: match.resultConflict,
      conflictAcknowledged: match.conflictAcknowledgedAt != null,
      isMatchOfTheRound: match.isMatchOfTheRound,
    };
    const confidence = fixtureConfidence(fixture);
    return confidence === "verified" ? [] : [`${fixture.label} (${confidence})`];
  });
  if (unconfirmed.length > 0) {
    throw new Error(
      `This round is still live: ${unconfirmed.join(", ")}. Provisional points stay on the results page. A confirmed total is stored only after every fixture is verified.`,
    );
  }
  if (round.predictionSets.length === 0) {
    throw new Error("No selected prediction set to score");
  }

  const config = round.season.scoringConfig
    ? scoringConfigFromRecord(round.season.scoringConfig)
    : defaultScoringConfig;
  const sets = oneSelectedSetPerParticipant(round.predictionSets);
  const labels = new Map(round.matches.map((match) => [match.id, `${match.homeTeam} — ${match.awayTeam}`]));
  const actuals = new Map(
    round.matches.map((match) => [
      match.id,
      { home: match.actualHomeGoals as number, away: match.actualAwayGoals as number },
    ]),
  );

  const scored = sets.map((set) => {
    const predictedByMatch = new Map<string, { home: number; away: number } | null>();
    const matches = round.matches.map((match) => {
      const prediction = set.predictions.find((item) => item.matchId === match.id);
      const predicted =
        prediction && !prediction.ignored && prediction.homeGoals != null && prediction.awayGoals != null
          ? { home: prediction.homeGoals, away: prediction.awayGoals }
          : null;
      predictedByMatch.set(match.id, predicted);
      return {
        matchId: match.id,
        actual: actuals.get(match.id) as { home: number; away: number },
        predicted,
        isMatchOfTheRound: match.isMatchOfTheRound,
      };
    });
    const result = scoreRound({ roundId, participantId: set.participantId, matches }, config);
    return { result, predictedByMatch };
  });

  const winners = winnerIds(scored.map((item) => ({ participantId: item.result.participantId, total: item.result.roundTotal })));

  await prisma.$transaction(async (tx) => {
    await tx.roundScore.deleteMany({ where: { roundId } });
    await tx.roundScore.createMany({
      data: scored.map(({ result, predictedByMatch }) => ({
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
    await tx.round.update({
      where: { id: roundId },
      data: { status: "scored" },
    });
  });

  await rebuildSeasonSnapshots(round.seasonId, round.number);
  return scored.length;
}
