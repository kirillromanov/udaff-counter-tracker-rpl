import {
  defaultScoringConfig,
  type ScoringConfig,
} from "@/lib/config/scoring";
import type {
  BaseCategory,
  MatchScoreBreakdown,
  MatchScoreInput,
  Outcome,
  Scoreline,
} from "./types";

const REWARDED_CATEGORIES = new Set<BaseCategory>([
  "exact",
  "neighbor",
  "diff",
  "outcome",
]);

export function outcomeOf(score: Scoreline): Outcome {
  if (score.home > score.away) {
    return "home";
  }
  if (score.home < score.away) {
    return "away";
  }
  return "draw";
}

export function goalDifference(score: Scoreline): number {
  return score.home - score.away;
}

function assertScoreline(score: Scoreline, label: string): void {
  if (!Number.isInteger(score.home) || !Number.isInteger(score.away)) {
    throw new Error(`${label} goals must be integers`);
  }
  if (score.home < 0 || score.away < 0) {
    throw new Error(`${label} goals cannot be negative`);
  }
}

/**
 * Neighbor: same outcome, same signed goal difference, and both teams
 * shifted by the same offset of exactly 1.
 * Example: predicted 1-0 vs actual 2-1, and the reverse.
 * A same-difference score shifted by 2 or more is `diff`, not `neighbor`.
 */
export function classifyBase(predicted: Scoreline, actual: Scoreline): BaseCategory {
  if (predicted.home === actual.home && predicted.away === actual.away) {
    return "exact";
  }

  const sameOutcome = outcomeOf(predicted) === outcomeOf(actual);
  const sameDiff = goalDifference(predicted) === goalDifference(actual);
  const offsetHome = actual.home - predicted.home;
  const offsetAway = actual.away - predicted.away;
  const isNeighbor =
    sameOutcome &&
    sameDiff &&
    offsetHome === offsetAway &&
    Math.abs(offsetHome) === 1;

  if (isNeighbor) {
    return "neighbor";
  }
  if (sameOutcome && sameDiff) {
    return "diff";
  }
  if (sameOutcome) {
    return "outcome";
  }
  return "miss";
}

function pointsFor(category: BaseCategory, config: ScoringConfig): number {
  return config.points[category];
}

function formatScore(score: Scoreline): string {
  return `${score.home}-${score.away}`;
}

function outcomeLabel(outcome: Outcome): string {
  if (outcome === "home") {
    return "home win";
  }
  if (outcome === "away") {
    return "away win";
  }
  return "draw";
}

function baseExplanation(
  category: BaseCategory,
  predicted: Scoreline,
  actual: Scoreline,
): string {
  switch (category) {
    case "exact":
      return `Exact score ${formatScore(actual)}`;
    case "neighbor": {
      const offset = actual.home - predicted.home;
      const direction = offset > 0 ? `+${offset}` : `${offset}`;
      return `Neighbor result: both sides shifted by ${direction} (${formatScore(predicted)} → ${formatScore(actual)})`;
    }
    case "diff":
      return `Same goal difference (${goalDifference(actual)}), not a one-goal shift`;
    case "outcome":
      return `Correct outcome only (${outcomeLabel(outcomeOf(actual))})`;
    case "miss":
      return "Wrong outcome";
  }
}

function matchBonuses(
  predicted: Scoreline | null,
  actual: Scoreline,
  config: ScoringConfig,
): { points: number; explanations: string[] } {
  const explanations: string[] = [];
  let points = 0;
  const actualTotal = actual.home + actual.away;
  const actualDiff = Math.abs(goalDifference(actual));

  // 0-0 is the only non-negative scoreline with zero total goals, so +2 replaces +1.
  if (actual.home === 0 && actual.away === 0) {
    points += config.bonuses.nilNil;
    explanations.push(`Bonus: 0-0 (+${config.bonuses.nilNil})`);
  } else if (actualTotal === 0) {
    points += config.bonuses.zeroTotalGoals;
    explanations.push(`Bonus: zero total goals (+${config.bonuses.zeroTotalGoals})`);
  }

  if (actualDiff >= config.bonuses.bigGoalDiffMin) {
    points += config.bonuses.bigGoalDiff;
    explanations.push(
      `Bonus: goal difference ${actualDiff} >= ${config.bonuses.bigGoalDiffMin} (+${config.bonuses.bigGoalDiff})`,
    );
  }

  if (predicted && actualTotal >= config.bonuses.highTotalMin) {
    const predictedTotal = predicted.home + predicted.away;
    if (predictedTotal === actualTotal) {
      points += config.bonuses.highTotalExact;
      explanations.push(
        `Bonus: predicted total goals ${predictedTotal} matches actual total ${actualTotal} (+${config.bonuses.highTotalExact})`,
      );
    }
  }

  return { points, explanations };
}

export function scoreMatch(
  input: MatchScoreInput,
  config: ScoringConfig = defaultScoringConfig,
): MatchScoreBreakdown {
  assertScoreline(input.actual, "Actual");
  if (input.predicted) {
    assertScoreline(input.predicted, "Predicted");
  }

  const explanations: string[] = [];
  const category: BaseCategory = input.predicted
    ? classifyBase(input.predicted, input.actual)
    : "miss";

  explanations.push(
    input.predicted
      ? baseExplanation(category, input.predicted, input.actual)
      : "Missing prediction",
  );

  const basePoints = pointsFor(category, config);
  const rewarded = REWARDED_CATEGORIES.has(category);
  const applyBonuses = rewarded || !config.bonusesRequireRewardedBase;
  const bonus = applyBonuses
    ? matchBonuses(input.predicted, input.actual, config)
    : { points: 0, explanations: [] };

  explanations.push(...bonus.explanations);

  const preMultiplier = basePoints + bonus.points;
  const mtApplied =
    input.isMatchOfTheRound &&
    (config.mtAppliesToNegative || preMultiplier >= 0);
  const mtMultiplier = mtApplied ? config.mtMultiplier : 1;

  if (mtApplied) {
    explanations.push(`Match of the Round: x${config.mtMultiplier}`);
  } else if (input.isMatchOfTheRound) {
    explanations.push("Match of the Round multiplier skipped for a negative score");
  }

  return {
    matchId: input.matchId,
    baseCategory: category,
    basePoints,
    bonusPoints: bonus.points,
    mtMultiplier,
    mtApplied,
    finalMatchPoints: preMultiplier * mtMultiplier,
    explanations,
  };
}
