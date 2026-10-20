import {
  defaultScoringConfig,
  type ScoringConfig,
} from "@/lib/config/scoring";
import { scoreMatch } from "./score-match";
import type {
  BaseCategory,
  MatchScoreInput,
  RoundScoreInput,
  RoundScoreResult,
  RoundScoreSummary,
} from "./types";

function emptySummary(): RoundScoreSummary {
  return {
    exactCount: 0,
    neighborCount: 0,
    diffCount: 0,
    outcomeCount: 0,
    missCount: 0,
  };
}

function addCategory(summary: RoundScoreSummary, category: BaseCategory): void {
  switch (category) {
    case "exact":
      summary.exactCount += 1;
      break;
    case "neighbor":
      summary.neighborCount += 1;
      break;
    case "diff":
      summary.diffCount += 1;
      break;
    case "outcome":
      summary.outcomeCount += 1;
      break;
    case "miss":
      summary.missCount += 1;
      break;
  }
}

/**
 * Awarded only when every match has a prediction and the predicted
 * goal total equals the actual goal total. A missing match blocks it.
 */
export function roundTotalGoalsBonus(
  matches: MatchScoreInput[],
  config: ScoringConfig,
): number {
  if (matches.length === 0) {
    return 0;
  }

  let predictedTotal = 0;
  let actualTotal = 0;

  for (const match of matches) {
    if (!match.predicted) {
      return 0;
    }
    predictedTotal += match.predicted.home + match.predicted.away;
    actualTotal += match.actual.home + match.actual.away;
  }

  return predictedTotal === actualTotal ? config.bonuses.roundTotalGoals : 0;
}

export function scoreRound(
  input: RoundScoreInput,
  config: ScoringConfig = defaultScoringConfig,
): RoundScoreResult {
  const matches = input.matches.map((match) => scoreMatch(match, config));
  const summary = emptySummary();

  for (const match of matches) {
    addCategory(summary, match.baseCategory);
  }

  const matchPointsTotal = matches.reduce(
    (total, match) => total + match.finalMatchPoints,
    0,
  );
  const bonus = roundTotalGoalsBonus(input.matches, config);

  return {
    roundId: input.roundId,
    participantId: input.participantId,
    matches,
    matchPointsTotal,
    roundTotalGoalsBonus: bonus,
    roundTotal: matchPointsTotal + bonus,
    summary,
  };
}
