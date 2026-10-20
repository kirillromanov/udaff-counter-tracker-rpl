import { describe, expect, it } from "vitest";
import { scoreRound } from "@/lib/domain/scoring/score-round";
import { exportAudit, type StoredBreakdown } from "@/lib/domain/export/export-audit";
import { exportRoundStandings } from "@/lib/domain/export/export-round-standings";
import { exportSeasonStandings } from "@/lib/domain/export/export-season-standings";
import { formatMovement, medalSymbols } from "@/lib/domain/standings/format-movement";
import { winnerIds } from "@/lib/domain/standings/recalculate-round";

describe("formatMovement", () => {
  it("prints arrows, a zero change, and a first appearance", () => {
    expect(formatMovement("up", 1, 3)).toBe("▲ 2");
    expect(formatMovement("down", 4, 2)).toBe("▼ 2");
    expect(formatMovement("same", 2, 2)).toBe("◄► 0");
    expect(formatMovement("new", 1, null)).toBe("new");
    expect(medalSymbols(3)).toBe("☼ ☼ ☼");
  });
});

describe("exports", () => {
  it("formats a round table with points, bonus, and the winner note", () => {
    const text = exportRoundStandings([
      { name: "pitchezz", matchPoints: 24, roundBonus: 0, totalPoints: 24, isWinner: false },
      { name: "Doctor Livesey", matchPoints: 25, roundBonus: 0, totalPoints: 25, isWinner: true },
    ]);

    expect(text.split("\n")[0]).toContain("1 ==");
    expect(text).toContain("Doctor Livesey");
    expect(text).toContain("25+ 0 (мидалько, епт)");
    expect(text).toContain("pitchezz");
    expect(text).toContain("24+ 0");
    expect(text.indexOf("Doctor Livesey")).toBeLessThan(text.indexOf("pitchezz"));
  });

  it("formats season movement and medal symbols", () => {
    const text = exportSeasonStandings([
      { rank: 1, name: "зукабля", totalPoints: 244, medals: 3, movement: "up", previousRank: 2 },
      { rank: 2, name: "Hordi Cruyff", totalPoints: 240, medals: 1, movement: "down", previousRank: 1 },
    ]);

    expect(text).toContain("1 ▲ 1");
    expect(text).toContain("==зукабля ☼ ☼ ☼");
    expect(text).toContain("244");
    expect(text).toContain("2 ▼ 1");
    expect(text).toContain("==Hordi Cruyff ☼");
    expect(text).toContain("240");
  });

  it("shows the Match of the Round multiplier in the audit", () => {
    const result = scoreRound({
      roundId: "round",
      participantId: "anna",
      matches: [
        {
          matchId: "mt",
          actual: { home: 3, away: 0 },
          predicted: { home: 3, away: 0 },
          isMatchOfTheRound: true,
        },
        {
          matchId: "other",
          actual: { home: 1, away: 0 },
          predicted: { home: 1, away: 0 },
          isMatchOfTheRound: false,
        },
      ],
    });
    const breakdown: StoredBreakdown = {
      matches: result.matches.map((match) => ({
        label: match.matchId,
        predicted: "3-0",
        actual: "3-0",
        baseCategory: match.baseCategory,
        basePoints: match.basePoints,
        bonusPoints: match.bonusPoints,
        mtMultiplier: match.mtMultiplier,
        mtApplied: match.mtApplied,
        finalMatchPoints: match.finalMatchPoints,
        explanations: match.explanations,
      })),
      matchPointsTotal: result.matchPointsTotal,
      roundTotalGoalsBonus: result.roundTotalGoalsBonus,
      roundTotal: result.roundTotal,
    };
    const text = exportAudit([{ name: "Anna", isWinner: true, breakdown }]);

    expect(text).toContain("Anna — round winner");
    expect(text).toContain("x2");
    expect(text).toContain("Match of the Round: x2");
    expect(result.matches[0]?.mtApplied).toBe(true);
    expect(result.matches[0]?.finalMatchPoints).toBeGreaterThan(result.matches[0]?.basePoints ?? 0);
  });

  it("shares the round medal when totals tie", () => {
    expect([...winnerIds([
      { participantId: "a", total: 10 },
      { participantId: "b", total: 10 },
      { participantId: "c", total: 4 },
    ])]).toEqual(["a", "b"]);
  });
});
