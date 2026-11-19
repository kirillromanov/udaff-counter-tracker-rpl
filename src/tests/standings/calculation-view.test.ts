import { describe, expect, it } from "vitest";
import type { StoredBreakdown } from "@/lib/domain/export/export-audit";
import { calculationView, officialFixture, presentSavedMatch } from "@/lib/domain/standings/calculation-view";
import { mergePredictionCells } from "@/lib/domain/import/merge-predictions";

const breakdown: StoredBreakdown = {
  matches: [
    {
      label: "Ростов — Акрон",
      predicted: "2-2",
      actual: "1-0",
      baseCategory: "miss",
      basePoints: -1,
      bonusPoints: 0,
      mtMultiplier: 1,
      mtApplied: false,
      finalMatchPoints: -1,
      explanations: [],
    },
    {
      label: "Факел — Оренбург",
      predicted: "—",
      actual: "1-0",
      baseCategory: "miss",
      basePoints: -1,
      bonusPoints: 0,
      mtMultiplier: 1,
      mtApplied: false,
      finalMatchPoints: -1,
      explanations: [],
    },
  ],
  matchPointsTotal: -2,
  roundTotalGoalsBonus: 0,
  roundTotal: -2,
};

describe("saved calculation and live selection stay separate", () => {
  it("keeps a saved score and a saved miss, and does not fill either from a current candidate", () => {
    const savedScore = presentSavedMatch(breakdown, "Ростов — Акрон");
    const savedMiss = presentSavedMatch(breakdown, "Факел — Оренбург");
    const absent = presentSavedMatch(breakdown, "ЦСКА — Ахмат");
    const officialScore = officialFixture({
      view: "saved-calculation",
      saved: savedScore,
      live: { state: "missing" },
    });
    const officialMiss = officialFixture({
      view: "saved-calculation",
      saved: savedMiss,
      live: { state: "selected", home: 4, away: 4 },
    });
    const officialAbsent = officialFixture({
      view: "saved-calculation",
      saved: absent,
      live: { state: "selected", home: 1, away: 0 },
    });
    expect(officialScore).toMatchObject({ source: "saved", home: 2, away: 2, points: -1, missing: false });
    expect(officialMiss).toMatchObject({ source: "saved", missing: true, home: null, points: -1 });
    expect(officialAbsent).toMatchObject({ source: "saved", inCalculation: false, home: null });
  });

  it("leaves a closed round on the saved calculation", () => {
    expect(calculationView({ standingRole: "operational", closedAt: new Date("2026-11-06T12:00:00.000Z"), status: "scored" })).toBe("saved-calculation");
    expect(calculationView({ standingRole: "archived", closedAt: null, status: "scored" })).toBe("saved-calculation");
  });

  it("does not freeze a later fixture on an open partial round", () => {
    expect(calculationView({ standingRole: "operational", closedAt: null, status: "partial" })).toBe("live-selection");
    const kickoff = new Date("2026-11-22T16:00:00.000Z");
    const cells = mergePredictionCells(
      [
        { id: "saved", kickoffAt: new Date("2026-11-20T16:30:00.000Z") },
        { id: "future", kickoffAt: kickoff },
      ],
      [{
        id: "next",
        postedAt: new Date("2026-11-21T12:00:00.000Z"),
        manual: false,
        predictions: [{ matchId: "future", home: 1, away: 0, ignored: false, warning: null }],
      }],
    );
    const future = officialFixture({
      view: "live-selection",
      saved: presentSavedMatch(breakdown, "Ростов — Акрон"),
      live: cells.find((cell) => cell.matchId === "future") ?? null,
    });
    expect(future).toMatchObject({ source: "live", home: 1, away: 0, missing: false });
  });
});
