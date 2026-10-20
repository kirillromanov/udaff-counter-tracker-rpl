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
  it("awards +2 for 0-0 and does not also award the zero-total bonus", () => {
    const result = scoreMatch(match({ home: 0, away: 0 }, { home: 0, away: 0 }));

    expect(result.baseCategory).toBe("exact");
    expect(result.bonusPoints).toBe(2);
    expect(result.finalMatchPoints).toBe(12);
    expect(result.explanations).toContain("Bonus: 0-0 (+2)");
    expect(result.explanations.some((line) => line.includes("zero total"))).toBe(false);
  });

  it("does not award a zero-goal bonus for any other scoreline", () => {
    const result = scoreMatch(match({ home: 1, away: 0 }, { home: 1, away: 0 }));

    expect(result.bonusPoints).toBe(0);
  });

  it("awards the big goal-difference bonus at the boundary, including away wins", () => {
    const below = scoreMatch(match({ home: 2, away: 0 }, { home: 2, away: 0 }));
    const home = scoreMatch(match({ home: 3, away: 0 }, { home: 3, away: 0 }));
    const away = scoreMatch(match({ home: 0, away: 3 }, { home: 0, away: 3 }));

    expect(below.bonusPoints).toBe(0);
    expect(home.bonusPoints).toBe(3);
    expect(home.finalMatchPoints).toBe(13);
    expect(away.bonusPoints).toBe(3);
  });

  it("awards the high-total bonus only when the predicted total matches and the actual total is at least 5", () => {
    const below = scoreMatch(match({ home: 2, away: 2 }, { home: 0, away: 0 }));
    const matched = scoreMatch(match({ home: 3, away: 2 }, { home: 4, away: 1 }));
    const unmatched = scoreMatch(match({ home: 3, away: 2 }, { home: 3, away: 1 }));

    expect(below.baseCategory).toBe("diff");
    expect(below.bonusPoints).toBe(0);
    expect(matched.baseCategory).toBe("outcome");
    expect(matched.bonusPoints).toBe(4);
    expect(matched.finalMatchPoints).toBe(7);
    expect(unmatched.baseCategory).toBe("outcome");
    expect(unmatched.bonusPoints).toBe(0);
    expect(unmatched.finalMatchPoints).toBe(3);
  });

  it("stacks the big-difference and exact-total bonuses", () => {
    const result = scoreMatch(match({ home: 5, away: 0 }, { home: 5, away: 0 }));

    expect(result.basePoints).toBe(10);
    expect(result.bonusPoints).toBe(7);
    expect(result.finalMatchPoints).toBe(17);
  });

  it("withholds match bonuses on a miss unless the config allows them", () => {
    const withheld = scoreMatch(match({ home: 0, away: 0 }, { home: 1, away: 0 }));
    const applied = scoreMatch(
      match({ home: 0, away: 0 }, { home: 1, away: 0 }),
      withConfig({ bonusesRequireRewardedBase: false }),
    );

    expect(withheld.baseCategory).toBe("miss");
    expect(withheld.finalMatchPoints).toBe(-1);
    expect(applied.bonusPoints).toBe(2);
    expect(applied.finalMatchPoints).toBe(1);
  });

  it("can apply an actual-only bonus to a missing prediction when the config allows it", () => {
    const result = scoreMatch(
      match({ home: 4, away: 0 }, null),
      withConfig({ bonusesRequireRewardedBase: false }),
    );

    expect(result.baseCategory).toBe("miss");
    expect(result.bonusPoints).toBe(3);
    expect(result.finalMatchPoints).toBe(2);
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
