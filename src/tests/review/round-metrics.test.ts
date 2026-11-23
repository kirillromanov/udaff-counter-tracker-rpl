import { describe, expect, it } from "vitest";
import { EDIT_TIME_UNKNOWN_NOTE } from "@/lib/domain/import/fixture-deadline";
import { displayedResultLabel } from "@/lib/domain/results/correction";
import { explainResultIssue, explainSetIssue, metricTone, roundConsistency, roundCounters, setsForMetric, type MetricSet } from "@/lib/domain/review/round-metrics";

function set(overrides: Partial<MetricSet> = {}): MetricSet {
  return {
    id: "set",
    status: "accepted",
    selected: true,
    warningsJson: "[]",
    parsedJson: "[]",
    rawComment: "1-0",
    predictions: [{ warning: null, homeGoals: 1, awayGoals: 0, ignored: false, rawLine: "1-0" }],
    ...overrides,
  };
}

describe("shared round counters", () => {
  it("counts a flagged unresolved edit once on both definitions", () => {
    const flagged = set({
      id: "5707",
      status: "accepted",
      reviewState: "flagged",
      reviewNote: EDIT_TIME_UNKNOWN_NOTE,
      externalId: "5707",
      authorName: "Vinnie",
    });
    const counters = roundCounters({ comments: [{}, {}], sets: [flagged], fixtures: [] });
    expect(counters.corrections).toBe(1);
    expect(counters.conflicts).toBe(0);
    expect(setsForMetric([flagged], "corrections")).toHaveLength(counters.corrections);
    expect(metricTone(flagged)).toBe("correction");
    const issue = explainSetIssue(flagged);
    expect(issue?.reason).toBe("Unresolved edit");
    expect(issue?.evidence).toBe(EDIT_TIME_UNKNOWN_NOTE);
    expect(issue?.actions.join(" ")).not.toMatch(/fix all/i);
  });

  it("matches an empty round and a consistent scored round", () => {
    const empty = roundCounters({ comments: [], sets: [], fixtures: [] });
    expect(roundConsistency({ counters: empty, fixtures: [], selectedCoversFixture: () => false }).consistent).toBe(true);
    const fixture = {
      id: "m",
      homeTeam: "A",
      awayTeam: "B",
      actualHomeGoals: 1,
      actualAwayGoals: 0,
      resultState: "verified",
      resultResolution: "verified",
      resultConflict: false,
      manuallyCorrected: false,
      resultProvenance: "",
      resultNote: null,
    };
    const counters = roundCounters({ comments: [], sets: [set()], fixtures: [fixture] });
    expect(roundConsistency({ counters, fixtures: [fixture], selectedCoversFixture: () => true }).consistent).toBe(true);
    expect(displayedResultLabel({ resultProvenance: "", manuallyCorrected: false, resultConflict: false }, "Source verified")).toBe("Source verified");
    expect(displayedResultLabel({ resultProvenance: "two-source", manuallyCorrected: false, resultConflict: false }, "Source verified")).toBe("Verified, two sources");
    expect(explainResultIssue({ ...fixture, resultConflict: true, resultNote: "sport-ru 1-0; premierliga 2-0" })?.reason).toBe("Result-source conflict");
  });
});
