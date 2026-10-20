import { z } from "zod";

export const scoringConfigSchema = z.object({
  points: z.object({
    exact: z.number().int(),
    neighbor: z.number().int(),
    diff: z.number().int(),
    outcome: z.number().int(),
    miss: z.number().int(),
  }),
  bonuses: z.object({
    zeroTotalGoals: z.number().int(),
    nilNil: z.number().int(),
    bigGoalDiff: z.number().int(),
    bigGoalDiffMin: z.number().int().positive(),
    highTotalExact: z.number().int(),
    highTotalMin: z.number().int().positive(),
    roundTotalGoals: z.number().int(),
  }),
  mtMultiplier: z.number().int().positive(),
  mtAppliesToNegative: z.boolean(),
  bonusesRequireRewardedBase: z.boolean(),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const defaultScoringConfig: ScoringConfig = {
  points: {
    exact: 10,
    neighbor: 6,
    diff: 4,
    outcome: 3,
    miss: -1,
  },
  bonuses: {
    zeroTotalGoals: 1,
    nilNil: 2,
    bigGoalDiff: 3,
    bigGoalDiffMin: 3,
    highTotalExact: 4,
    highTotalMin: 5,
    roundTotalGoals: 3,
  },
  mtMultiplier: 2,
  mtAppliesToNegative: true,
  bonusesRequireRewardedBase: true,
};

export interface ScoringConfigRecord {
  exactPoints: number;
  neighborPoints: number;
  diffPoints: number;
  outcomePoints: number;
  missPoints: number;
  zeroTotalBonus: number;
  nilNilBonus: number;
  bigDiffBonus: number;
  bigDiffMin: number;
  highTotalBonus: number;
  highTotalMin: number;
  roundTotalGoalsBonus: number;
  mtMultiplier: number;
  mtAppliesToNegative: boolean;
  bonusesRequireRewardedBase: boolean;
}

export function parseScoringConfig(input: unknown): ScoringConfig {
  return scoringConfigSchema.parse(input);
}

export function scoringConfigFromRecord(record: ScoringConfigRecord): ScoringConfig {
  return parseScoringConfig({
    points: {
      exact: record.exactPoints,
      neighbor: record.neighborPoints,
      diff: record.diffPoints,
      outcome: record.outcomePoints,
      miss: record.missPoints,
    },
    bonuses: {
      zeroTotalGoals: record.zeroTotalBonus,
      nilNil: record.nilNilBonus,
      bigGoalDiff: record.bigDiffBonus,
      bigGoalDiffMin: record.bigDiffMin,
      highTotalExact: record.highTotalBonus,
      highTotalMin: record.highTotalMin,
      roundTotalGoals: record.roundTotalGoalsBonus,
    },
    mtMultiplier: record.mtMultiplier,
    mtAppliesToNegative: record.mtAppliesToNegative,
    bonusesRequireRewardedBase: record.bonusesRequireRewardedBase,
  });
}
