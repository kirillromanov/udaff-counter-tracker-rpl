import { describe, expect, it } from "vitest";
import { scoreRound } from "@/lib/domain/scoring/score-round";
import type { MatchScoreInput } from "@/lib/domain/scoring/types";

function fixture(
  matchId: string,
  actualHome: number,
  actualAway: number,
  predicted: { home: number; away: number } | null,
  isMatchOfTheRound = false,
): MatchScoreInput {
  return {
    matchId,
    actual: { home: actualHome, away: actualAway },
    predicted,
    isMatchOfTheRound,
  };
}

describe("scoreRound", () => {
  it("awards the round total-goals bonus when every predicted total matches", () => {
    const result = scoreRound({
      roundId: "r1",
      participantId: "p1",
      matches: [
        fixture("a", 2, 1, { home: 1, away: 0 }),
        fixture("b", 1, 0, { home: 2, away: 1 }),
      ],
    });

    expect(result.roundTotalGoalsBonus).toBe(3);
    expect(result.matchPointsTotal).toBe(12);
    expect(result.roundTotal).toBe(15);
    expect(result.summary).toEqual({
      exactCount: 0,
      neighborCount: 2,
      diffCount: 0,
      outcomeCount: 0,
      missCount: 0,
    });
  });

  it("withholds the round bonus when the totals differ by one", () => {
    const result = scoreRound({
      roundId: "r1",
      participantId: "p1",
      matches: [
        fixture("a", 2, 1, { home: 2, away: 0 }),
        fixture("b", 1, 0, { home: 2, away: 1 }),
      ],
    });

    expect(result.roundTotalGoalsBonus).toBe(0);
    expect(result.roundTotal).toBe(result.matchPointsTotal);
  });

  it("withholds the round bonus when any prediction is missing", () => {
    const result = scoreRound({
      roundId: "r1",
      participantId: "p1",
      matches: [
        fixture("a", 1, 0, { home: 1, away: 0 }),
        fixture("b", 0, 0, null),
      ],
    });

    expect(result.roundTotalGoalsBonus).toBe(0);
    expect(result.summary.exactCount).toBe(1);
    expect(result.summary.missCount).toBe(1);
    expect(result.matchPointsTotal).toBe(9);
  });

  it("counts every base category and includes the Match of the Round multiplier", () => {
    const result = scoreRound({
      roundId: "r1",
      participantId: "p1",
      matches: [
        fixture("exact", 2, 1, { home: 2, away: 1 }, true),
        fixture("neighbor", 2, 1, { home: 1, away: 0 }),
        fixture("diff", 4, 2, { home: 2, away: 0 }),
        fixture("outcome", 3, 0, { home: 2, away: 0 }),
        fixture("miss", 0, 1, { home: 1, away: 0 }),
      ],
    });

    expect(result.summary).toEqual({
      exactCount: 1,
      neighborCount: 1,
      diffCount: 1,
      outcomeCount: 1,
      missCount: 1,
    });
    expect(result.matches[0]?.finalMatchPoints).toBe(20);
    expect(result.matchPointsTotal).toBe(20 + 6 + 4 + 6 + -1);
    expect(result.roundTotalGoalsBonus).toBe(0);
    expect(result.roundTotal).toBe(result.matchPointsTotal);
  });

  it("does not award a round bonus for an empty slip", () => {
    const result = scoreRound({
      roundId: "r1",
      participantId: "p1",
      matches: [],
    });

    expect(result.roundTotal).toBe(0);
    expect(result.roundTotalGoalsBonus).toBe(0);
    expect(result.summary).toEqual({
      exactCount: 0,
      neighborCount: 0,
      diffCount: 0,
      outcomeCount: 0,
      missCount: 0,
    });
  });
});
