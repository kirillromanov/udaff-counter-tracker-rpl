import { describe, expect, it } from "vitest";
import { isAcceptableImport } from "@/lib/domain/import/accept-import";
import { mergePredictionCells, submissionLabel } from "@/lib/domain/import/merge-predictions";
import { resolveSelections, type SelectableSet } from "@/lib/domain/import/select-sets";
import { scoreIntermediateRound, type IntermediateFixture } from "@/lib/domain/standings/intermediate";

const fixtures = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];

function prediction(matchId: string, home: number, away: number) {
  return { matchId, home, away, ignored: false, warning: null };
}

function selectable(id: string, postedAt: string, valid = true): SelectableSet {
  return { id, participantId: "p", postedAt: new Date(postedAt), valid, selection: "auto", selected: false };
}

describe("incremental prediction slips", () => {
  it("selects one valid match without requiring the rest of the round", () => {
    const cells = mergePredictionCells(fixtures, [{
      id: "one",
      postedAt: new Date("2026-11-05T10:00:00Z"),
      manual: false,
      predictions: [prediction("m1", 1, 0)],
    }]);
    expect(cells.filter((cell) => cell.state === "selected")).toEqual([
      { matchId: "m1", state: "selected", home: 1, away: 0, setId: "one" },
    ]);
    expect(submissionLabel(cells, 8)).toBe("1/8 predictions");
    expect(isAcceptableImport({
      warnings: ["No prediction for Факел — Динамо"],
      unmatchedLines: 0,
      fixtureCount: 8,
      predictions: [{ ignored: false, homeGoals: 1, awayGoals: 0, warning: null }],
    })).toBe(true);
  });

  it("merges 1 + 3 + 4 comments into eight predictions and keeps the earlier cells", () => {
    const first = ["m1"];
    const second = ["m2", "m3", "m4"];
    const third = ["m5", "m6", "m7", "m8"];
    const sets = [
      { id: "a", postedAt: new Date("2026-11-05T10:00:00Z"), manual: false, predictions: first.map((id) => prediction(id, 1, 0)) },
      { id: "b", postedAt: new Date("2026-11-05T12:00:00Z"), manual: false, predictions: second.map((id) => prediction(id, 0, 0)) },
      { id: "c", postedAt: new Date("2026-11-05T14:00:00Z"), manual: false, predictions: third.map((id) => prediction(id, 2, 1)) },
    ];
    const cells = mergePredictionCells(fixtures, sets);
    expect(cells.every((cell) => cell.state === "selected")).toBe(true);
    const kept = cells.find((cell) => cell.matchId === "m1");
    expect(kept?.state === "selected" ? kept.setId : null).toBe("a");
    expect(resolveSelections([selectable("a", "2026-11-05T10:00:00Z"), selectable("b", "2026-11-05T12:00:00Z"), selectable("c", "2026-11-05T14:00:00Z")])).toEqual(["a", "b", "c"]);
  });

  it("keeps a two-of-eight slip partial and does not duplicate an identical repeat", () => {
    const cells = mergePredictionCells(fixtures, [
      { id: "a", postedAt: new Date("2026-11-05T10:00:00Z"), manual: false, predictions: [prediction("m1", 1, 0), prediction("m2", 2, 2)] },
      { id: "repeat", postedAt: new Date("2026-11-05T11:00:00Z"), manual: false, predictions: [prediction("m1", 1, 0)] },
    ]);
    expect(submissionLabel(cells, 8)).toBe("2/8 predictions");
    expect(cells.filter((cell) => cell.state === "selected")).toHaveLength(2);
    const kept = cells.find((cell) => cell.matchId === "m1");
    expect(kept?.state === "selected" ? kept.setId : null).toBe("a");
  });

  it("reviews only the conflicting fixture", () => {
    const cells = mergePredictionCells(["m1", "m2"], [
      { id: "a", postedAt: new Date("2026-11-05T10:00:00Z"), manual: false, predictions: [prediction("m1", 1, 0), prediction("m2", 0, 1)] },
      { id: "b", postedAt: new Date("2026-11-05T12:00:00Z"), manual: false, predictions: [prediction("m1", 2, 0)] },
    ]);
    expect(cells.find((cell) => cell.matchId === "m1")?.state).toBe("review");
    expect(cells.find((cell) => cell.matchId === "m2")).toMatchObject({ state: "selected", home: 0, away: 1, setId: "a" });
  });

  it("keeps a manual slip ahead of a later import", () => {
    const cells = mergePredictionCells(["m1", "m2"], [
      { id: "manual", postedAt: new Date("2026-11-05T09:00:00Z"), manual: true, predictions: [prediction("m1", 3, 1)] },
      { id: "auto", postedAt: new Date("2026-11-05T18:00:00Z"), manual: false, predictions: [prediction("m1", 0, 0), prediction("m2", 1, 1)] },
    ]);
    expect(cells).toEqual([
      { matchId: "m1", state: "selected", home: 3, away: 1, setId: "manual" },
      { matchId: "m2", state: "missing" },
    ]);
  });

  it("does not penalize a pending fixture or an unresolved cell, and still penalizes a real miss", () => {
    const finished = (id: string, home: number, away: number): IntermediateFixture => ({
      matchId: id,
      label: id,
      actualHomeGoals: home,
      actualAwayGoals: away,
      resultState: "verified",
      resultResolution: "verified",
      resultConflict: false,
      isMatchOfTheRound: id === "mt",
      observationStatuses: ["finished"],
    });
    const pending: IntermediateFixture = {
      ...finished("later", 0, 0),
      actualHomeGoals: null,
      actualAwayGoals: null,
      resultState: "open",
      resultResolution: "",
      observationStatuses: [],
    };
    const scored = scoreIntermediateRound({
      roundId: "round",
      fixtures: [finished("done", 1, 0), finished("mt", 2, 0), pending],
      participants: [{
        participantId: "p",
        unresolvedMatchIds: ["done"],
        predictions: [],
      }],
    });
    expect(scored.status).toBe("partial");
    expect(scored.scores[0]?.result.matches.map((match) => match.matchId)).toEqual(["mt"]);
    expect(scored.scores[0]?.result.roundTotal).toBe(-2);
  });
});
