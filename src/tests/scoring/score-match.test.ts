import { describe, expect, it } from "vitest";
import {
  defaultScoringConfig,
  type ScoringConfig,
} from "@/lib/config/scoring";
import { scoreMatch } from "@/lib/domain/scoring/score-match";
import type { MatchScoreInput, Scoreline } from "@/lib/domain/scoring/types";

function match(
  actual: Scoreline,
  predicted: Scoreline | null,
  isMatchOfTheRound = false,
): MatchScoreInput {
  return {
    matchId: "m1",
    actual,
    predicted,
    isMatchOfTheRound,
  };
}

function withConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return {
    ...defaultScoringConfig,
    ...overrides,
    points: { ...defaultScoringConfig.points, ...overrides.points },
    bonuses: { ...defaultScoringConfig.bonuses, ...overrides.bonuses },
  };
}

describe("scoreMatch categories", () => {
  it("awards exact score and does not also treat it as a neighbor", () => {
    const result = scoreMatch(match({ home: 2, away: 1 }, { home: 2, away: 1 }));

    expect(result.baseCategory).toBe("exact");
    expect(result.basePoints).toBe(10);
    expect(result.bonusPoints).toBe(0);
    expect(result.finalMatchPoints).toBe(10);
    expect(result.explanations[0]).toBe("Exact score 2-1");
  });

  it("scores a one-goal shift in both directions as a neighbor", () => {
    const forward = scoreMatch(match({ home: 2, away: 1 }, { home: 1, away: 0 }));
    const reverse = scoreMatch(match({ home: 1, away: 0 }, { home: 2, away: 1 }));

    expect(forward.baseCategory).toBe("neighbor");
    expect(forward.basePoints).toBe(6);
    expect(forward.explanations[0]).toContain("shifted by +1");
    expect(reverse.baseCategory).toBe("neighbor");
    expect(reverse.basePoints).toBe(6);
    expect(reverse.explanations[0]).toContain("shifted by -1");
  });

  it("scores draw neighbors one goal either side of the actual draw", () => {
    const down = scoreMatch(match({ home: 0, away: 0 }, { home: 1, away: 1 }));
    const up = scoreMatch(match({ home: 2, away: 2 }, { home: 1, away: 1 }));

    expect(down.baseCategory).toBe("neighbor");
    expect(up.baseCategory).toBe("neighbor");
  });

  it("scores the same goal difference shifted by two as diff, not neighbor", () => {
    const result = scoreMatch(match({ home: 4, away: 2 }, { home: 2, away: 0 }));

    expect(result.baseCategory).toBe("diff");
    expect(result.basePoints).toBe(4);
    expect(result.finalMatchPoints).toBe(4);
    expect(result.explanations[0]).toContain("Same goal difference (2)");
  });

  it("scores 0-0 against 2-2 as diff", () => {
    const result = scoreMatch(match({ home: 2, away: 2 }, { home: 0, away: 0 }));

    expect(result.baseCategory).toBe("diff");
    expect(result.basePoints).toBe(4);
  });

  it("scores a correct winner with a different goal difference as outcome only", () => {
    const result = scoreMatch(match({ home: 3, away: 0 }, { home: 2, away: 0 }));

    expect(result.baseCategory).toBe("outcome");
    expect(result.basePoints).toBe(3);
    expect(result.explanations[0]).toBe("Correct outcome only (home win)");
  });

  it("scores the wrong outcome as a miss", () => {
    const result = scoreMatch(match({ home: 0, away: 1 }, { home: 1, away: 0 }));

    expect(result.baseCategory).toBe("miss");
    expect(result.basePoints).toBe(-1);
    expect(result.finalMatchPoints).toBe(-1);
    expect(result.bonusPoints).toBe(0);
  });

  it("scores a missing prediction as a miss", () => {
    const result = scoreMatch(match({ home: 2, away: 0 }, null));

    expect(result.baseCategory).toBe("miss");
    expect(result.basePoints).toBe(-1);
    expect(result.explanations).toEqual(["Missing prediction"]);
  });

  it("rejects negative and non-integer goals", () => {
    expect(() => scoreMatch(match({ home: -1, away: 0 }, { home: 0, away: 0 }))).toThrow(
      /cannot be negative/,
    );
    expect(() => scoreMatch(match({ home: 1, away: 0 }, { home: 1.5, away: 0 }))).toThrow(
      /must be integers/,
    );
  });
});

describe("scoreMatch bonuses", () => {
  it("awards +1 for each correctly predicted zero, so exact 0-0 is +2 once", () => {
    const exact = scoreMatch(match({ home: 0, away: 0 }, { home: 0, away: 0 }));
    const homeZero = scoreMatch(match({ home: 0, away: 1 }, { home: 0, away: 2 }));
    const awayZero = scoreMatch(match({ home: 1, away: 0 }, { home: 1, away: 0 }));
    const wrongSide = scoreMatch(match({ home: 1, away: 0 }, { home: 0, away: 1 }));
    const nonzeroDraw = scoreMatch(match({ home: 1, away: 1 }, { home: 1, away: 1 }));
    const predictedZerosOnADraw = scoreMatch(match({ home: 1, away: 1 }, { home: 0, away: 0 }));

    expect(exact).toMatchObject({ baseCategory: "exact", basePoints: 10, bonusPoints: 2, finalMatchPoints: 12 });
    expect(exact.explanations).toContain("Bonus: correctly predicted zero goals (+2)");
    expect(exact.explanations.filter((line) => line.startsWith("Bonus:")).length).toBe(1);
    expect(homeZero).toMatchObject({ baseCategory: "outcome", basePoints: 3, bonusPoints: 1, finalMatchPoints: 4 });
    expect(awayZero).toMatchObject({ baseCategory: "exact", basePoints: 10, bonusPoints: 1, finalMatchPoints: 11 });
    expect(wrongSide).toMatchObject({ baseCategory: "miss", basePoints: -1, bonusPoints: 0, finalMatchPoints: -1 });
    expect(nonzeroDraw).toMatchObject({ baseCategory: "exact", bonusPoints: 0, finalMatchPoints: 10 });
    expect(predictedZerosOnADraw).toMatchObject({ baseCategory: "neighbor", basePoints: 6, bonusPoints: 0, finalMatchPoints: 6 });
  });

  it("awards the difference bonus from the prediction, including the exact threshold", () => {
    const qualifies = scoreMatch(match({ home: 1, away: 0 }, { home: 3, away: 0 }));
    const below = scoreMatch(match({ home: 4, away: 1 }, { home: 2, away: 0 }));
    const away = scoreMatch(match({ home: 0, away: 1 }, { home: 0, away: 3 }));

    expect(qualifies).toMatchObject({ baseCategory: "outcome", basePoints: 3, bonusPoints: 4, finalMatchPoints: 7 });
    expect(qualifies.explanations).toContain("Bonus: predicted goal difference 3 >= 3 (+3)");
    expect(qualifies.explanations).toContain("Bonus: correctly predicted zero goals (+1)");
    expect(below).toMatchObject({ baseCategory: "outcome", bonusPoints: 0, finalMatchPoints: 3 });
    expect(away).toMatchObject({ baseCategory: "outcome", basePoints: 3, bonusPoints: 4, finalMatchPoints: 7 });
  });

  it("awards the high-total bonus only when the matching total is at least 5", () => {
    const predictedFiveActualThree = scoreMatch(match({ home: 2, away: 1 }, { home: 3, away: 2 }));
    const predictedThreeActualFive = scoreMatch(match({ home: 3, away: 2 }, { home: 2, away: 1 }));
    const predictedFiveActualSix = scoreMatch(match({ home: 4, away: 2 }, { home: 3, away: 2 }));
    const matchedFive = scoreMatch(match({ home: 4, away: 1 }, { home: 3, away: 2 }));
    const matchedSix = scoreMatch(match({ home: 5, away: 1 }, { home: 4, away: 2 }));
    const matchedFour = scoreMatch(match({ home: 3, away: 1 }, { home: 3, away: 1 }));

    expect(predictedFiveActualThree).toMatchObject({ baseCategory: "neighbor", basePoints: 6, bonusPoints: 0, finalMatchPoints: 6 });
    expect(predictedThreeActualFive).toMatchObject({ baseCategory: "neighbor", basePoints: 6, bonusPoints: 0, finalMatchPoints: 6 });
    expect(predictedFiveActualSix).toMatchObject({ baseCategory: "outcome", basePoints: 3, bonusPoints: 0, finalMatchPoints: 3 });
    expect(matchedFive).toMatchObject({ baseCategory: "outcome", basePoints: 3, bonusPoints: 4, finalMatchPoints: 7 });
    expect(matchedFive.explanations).toContain("Bonus: predicted total goals 5 matches actual total and is >= 5 (+4)");
    expect(matchedSix).toMatchObject({ baseCategory: "outcome", basePoints: 3, bonusPoints: 4, finalMatchPoints: 7 });
    expect(matchedSix.explanations).toContain("Bonus: predicted total goals 6 matches actual total and is >= 5 (+4)");
    expect(matchedFour).toMatchObject({ baseCategory: "exact", basePoints: 10, bonusPoints: 0, finalMatchPoints: 10 });
  });

  it("stacks the predicted-difference bonus with a matching high total", () => {
    const result = scoreMatch(match({ home: 5, away: 0 }, { home: 4, away: 1 }));

    expect(result).toMatchObject({ baseCategory: "outcome", basePoints: 3, bonusPoints: 7, finalMatchPoints: 10 });
    expect(result.explanations).toEqual([
      "Correct outcome only (home win)",
      "Bonus: predicted goal difference 3 >= 3 (+3)",
      "Bonus: predicted total goals 5 matches actual total and is >= 5 (+4)",
    ]);
  });

  it("withholds a matching high total on a wrong outcome unless the configured policy allows it", () => {
    const withheld = scoreMatch(match({ home: 5, away: 0 }, { home: 0, away: 5 }));
    const applied = scoreMatch(
      match({ home: 5, away: 0 }, { home: 0, away: 5 }),
      withConfig({ bonusesRequireRewardedBase: false }),
    );

    expect(defaultScoringConfig.bonusesRequireRewardedBase).toBe(true);
    expect(withheld).toMatchObject({ baseCategory: "miss", bonusPoints: 0, finalMatchPoints: -1 });
    expect(applied).toMatchObject({ bonusPoints: 7, finalMatchPoints: 6 });
    expect(applied.explanations).toContain("Bonus: predicted total goals 5 matches actual total and is >= 5 (+4)");
  });

  it("doubles a matching high-total subtotal once for Match of the Round", () => {
    const result = scoreMatch(match({ home: 4, away: 1 }, { home: 3, away: 2 }, true));

    expect(result).toMatchObject({
      basePoints: 3,
      bonusPoints: 4,
      mtApplied: true,
      mtMultiplier: 2,
      finalMatchPoints: 14,
    });
  });

  it("scores Yosh's round 13 Krylia Sovetov slip as 9 without a high-total bonus", () => {
    const result = scoreMatch(match({ home: 0, away: 3 }, { home: 1, away: 4 }));

    expect(result).toMatchObject({
      baseCategory: "neighbor",
      basePoints: 6,
      bonusPoints: 3,
      mtApplied: false,
      mtMultiplier: 1,
      finalMatchPoints: 9,
    });
    expect(result.explanations).toEqual([
      "Neighbor result: both sides shifted by -1 (1-4 → 0-3)",
      "Bonus: predicted goal difference 3 >= 3 (+3)",
    ]);
  });

  it("keeps bonuses off a wrong outcome unless the configured policy allows them", () => {
    const withheld = scoreMatch(match({ home: 0, away: 0 }, { home: 1, away: 0 }));
    const applied = scoreMatch(
      match({ home: 0, away: 0 }, { home: 1, away: 0 }),
      withConfig({ bonusesRequireRewardedBase: false }),
    );

    expect(defaultScoringConfig.bonusesRequireRewardedBase).toBe(true);
    expect(withheld).toMatchObject({ baseCategory: "miss", bonusPoints: 0, finalMatchPoints: -1 });
    expect(applied).toMatchObject({ bonusPoints: 1, finalMatchPoints: 0 });
  });

  it("does not invent a bonus for a missing prediction", () => {
    const result = scoreMatch(
      match({ home: 4, away: 0 }, null),
      withConfig({ bonusesRequireRewardedBase: false }),
    );

    expect(result).toMatchObject({ baseCategory: "miss", bonusPoints: 0, finalMatchPoints: -1 });
  });

  it("scores Doctor Livesey's round 13 Rubin and Lokomotiv slips", () => {
    const rubin = scoreMatch(match({ home: 1, away: 0 }, { home: 1, away: 0 }));
    const lokomotiv = scoreMatch(match({ home: 0, away: 4 }, { home: 1, away: 2 }, true));

    expect(rubin).toMatchObject({
      baseCategory: "exact",
      basePoints: 10,
      bonusPoints: 1,
      mtApplied: false,
      mtMultiplier: 1,
      finalMatchPoints: 11,
    });
    expect(lokomotiv).toMatchObject({
      baseCategory: "outcome",
      basePoints: 3,
      bonusPoints: 0,
      mtApplied: true,
      mtMultiplier: 2,
      finalMatchPoints: 6,
    });
    expect(lokomotiv.explanations).toEqual([
      "Correct outcome only (away win)",
      "Match of the Round: x2",
    ]);
  });
});

describe("scoreMatch Match of the Round", () => {
  it("doubles a positive score", () => {
    const result = scoreMatch(match({ home: 2, away: 1 }, { home: 2, away: 1 }, true));

    expect(result.mtApplied).toBe(true);
    expect(result.mtMultiplier).toBe(2);
    expect(result.finalMatchPoints).toBe(20);
    expect(result.explanations).toContain("Match of the Round: x2");
  });

  it("doubles bonuses together with the base score", () => {
    const result = scoreMatch(match({ home: 0, away: 0 }, { home: 0, away: 0 }, true));

    expect(result.finalMatchPoints).toBe(24);
  });

  it("doubles a negative score by default and can leave it unchanged", () => {
    const doubled = scoreMatch(match({ home: 1, away: 0 }, null, true));
    const unchanged = scoreMatch(
      match({ home: 1, away: 0 }, null, true),
      withConfig({ mtAppliesToNegative: false }),
    );
    const ordinaryMiss = scoreMatch(match({ home: 1, away: 0 }, null, false));

    expect(doubled.finalMatchPoints).toBe(-2);
    expect(doubled.mtApplied).toBe(true);
    expect(unchanged.finalMatchPoints).toBe(-1);
    expect(unchanged.mtApplied).toBe(false);
    expect(unchanged.mtMultiplier).toBe(1);
    expect(unchanged.explanations).toContain(
      "Match of the Round multiplier skipped for a negative score",
    );
    expect(ordinaryMiss.finalMatchPoints).toBe(-1);
    expect(ordinaryMiss.mtApplied).toBe(false);
  });
});
