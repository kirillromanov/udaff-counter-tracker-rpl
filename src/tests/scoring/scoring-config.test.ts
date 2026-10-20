import { describe, expect, it } from "vitest";
import {
  defaultScoringConfig,
  parseScoringConfig,
  scoringConfigFromRecord,
} from "@/lib/config/scoring";

describe("scoring config", () => {
  it("accepts the default settings", () => {
    expect(parseScoringConfig(defaultScoringConfig)).toEqual(defaultScoringConfig);
  });

  it("maps a stored scoring config record", () => {
    expect(
      scoringConfigFromRecord({
        exactPoints: 10,
        neighborPoints: 6,
        diffPoints: 4,
        outcomePoints: 3,
        missPoints: -1,
        zeroTotalBonus: 1,
        nilNilBonus: 2,
        bigDiffBonus: 3,
        bigDiffMin: 3,
        highTotalBonus: 4,
        highTotalMin: 5,
        roundTotalGoalsBonus: 3,
        mtMultiplier: 2,
        mtAppliesToNegative: true,
        bonusesRequireRewardedBase: true,
      }),
    ).toEqual(defaultScoringConfig);
  });

  it("rejects a non-positive Match of the Round multiplier", () => {
    expect(() =>
      parseScoringConfig({
        ...defaultScoringConfig,
        mtMultiplier: 0,
      }),
    ).toThrow();
  });
});
