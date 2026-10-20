import { describe, expect, it } from "vitest";
import { predictionTone, setTone, summarizeSets } from "@/lib/domain/import/review-status";

const clean = { warning: null, homeGoals: 1, awayGoals: 0, ignored: false };

describe("review status", () => {
  it("marks duplicate and ambiguous lines as parse conflicts", () => {
    expect(predictionTone({ ...clean, warning: "Duplicate prediction for Зенит — Ахмат; kept the stronger line" })).toBe(
      "conflict",
    );
    expect(predictionTone({ ...clean, warning: "Ambiguous fixture match for Динамо - ЦСКА" })).toBe("conflict");
  });

  it("marks missing scores, swaps, and unmatched lines as needing correction", () => {
    expect(predictionTone({ ...clean, homeGoals: null, awayGoals: null })).toBe("correction");
    expect(predictionTone({ ...clean, warning: "Home and away look swapped for Зенит — Ахмат" })).toBe("correction");
    expect(predictionTone({ ...clean, ignored: true, homeGoals: null, awayGoals: null })).toBe("ok");
    expect(
      setTone({
        selected: false,
        warnings: ["Could not match fixture: Зенит / Ахмат"],
        unmatched: 1,
        predictions: [clean],
      }),
    ).toBe("correction");
  });

  it("flags a selected slip that skipped a fixture, and leaves an unselected partial slip alone", () => {
    const warnings = ["No prediction for Родина — Оренбург"];
    expect(setTone({ selected: true, warnings, unmatched: 0, predictions: [clean] })).toBe("correction");
    expect(setTone({ selected: false, warnings, unmatched: 0, predictions: [clean] })).toBe("ok");
  });

  it("counts conflicts ahead of other corrections", () => {
    expect(
      summarizeSets([
        { selected: true, warnings: ["Duplicate prediction for a fixture"], unmatched: 0, predictions: [clean] },
        { selected: true, warnings: ["Missing score"], unmatched: 0, predictions: [{ ...clean, homeGoals: null }] },
        { selected: false, warnings: [], unmatched: 0, predictions: [clean] },
      ]),
    ).toEqual({ conflicts: 1, corrections: 1, selected: 2 });
  });
});
