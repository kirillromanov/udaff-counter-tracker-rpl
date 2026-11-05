import { describe, expect, it } from "vitest";
import { scoreMatch } from "@/lib/domain/scoring/score-match";
import { scoreRound } from "@/lib/domain/scoring/score-round";
import { rosterIdsToScore } from "@/lib/domain/standings/roster-scores";
import type { MatchScoreInput } from "@/lib/domain/scoring/types";

function missingRound(): MatchScoreInput[] {
  return Array.from({ length: 8 }, (_, index) => ({
    matchId: `m${index + 1}`,
    actual: { home: 1, away: 0 },
    predicted: null,
    isMatchOfTheRound: index === 7,
  }));
}

describe("missing prediction penalties", () => {
  it("scores eight missing fixtures with one Match of the Round as -9", () => {
    const result = scoreRound({ roundId: "r", participantId: "p", matches: missingRound() });

    expect(result.matches.filter((match) => !match.mtApplied).map((match) => match.finalMatchPoints)).toEqual([-1, -1, -1, -1, -1, -1, -1]);
    expect(result.matches[7]).toMatchObject({ finalMatchPoints: -2, mtMultiplier: 2 });
    expect(result.matches[7]?.explanations.filter((line) => line.includes("x2"))).toHaveLength(1);
    expect(result.roundTotal).toBe(-9);
    expect(result.roundTotalGoalsBonus).toBe(0);
  });

  it("scores one missing Match of the Round as -2 and keeps a real 0-0", () => {
    const missing = scoreMatch({
      matchId: "mt",
      actual: { home: 0, away: 4 },
      predicted: null,
      isMatchOfTheRound: true,
    });
    const nil = scoreMatch({
      matchId: "draw",
      actual: { home: 0, away: 0 },
      predicted: { home: 0, away: 0 },
      isMatchOfTheRound: false,
    });

    expect(missing.finalMatchPoints).toBe(-2);
    expect(nil).toMatchObject({ baseCategory: "exact", bonusPoints: 2, finalMatchPoints: 12 });
  });

  it("adds missing-fixture penalties to a partial slip", () => {
    const matches = missingRound();
    matches[0] = { ...matches[0], predicted: { home: 1, away: 0 } };
    const result = scoreRound({ roundId: "r", participantId: "p", matches });

    expect(result.matches[0]?.finalMatchPoints).toBe(11);
    expect(result.roundTotal).toBe(11 - 1 * 6 - 2);
  });

  it("does not score an unresolved owner as a confirmed blank slip", () => {
    expect(rosterIdsToScore({
      rosterIds: ["pavel", "sashko"],
      selectedIds: ["pavel"],
      unresolvedIds: ["sashko"],
    })).toEqual(["pavel"]);
    expect(rosterIdsToScore({
      rosterIds: ["pavel", "sashko"],
      selectedIds: [],
      unresolvedIds: [],
    })).toEqual(["pavel", "sashko"]);
  });
});
