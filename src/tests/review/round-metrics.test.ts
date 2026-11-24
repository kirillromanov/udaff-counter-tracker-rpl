import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDIT_TIME_UNKNOWN_NOTE } from "@/lib/domain/import/fixture-deadline";
import { displayedResultLabel } from "@/lib/domain/results/correction";
import { explainResultIssue, explainSetIssue, metricTone, primaryConsistencyMetric, resultIssueCount, resultIssueRows, reviewMetricHref, roundConsistency, roundCounters, setsForMetric, type MetricFixture, type MetricSet } from "@/lib/domain/review/round-metrics";

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
    expect(displayedResultLabel({ resultProvenance: "", manuallyCorrected: false, resultConflict: false, resultState: "verified" }, "Source verified")).toBe("Source verified");
    expect(displayedResultLabel({ resultProvenance: "two-source", manuallyCorrected: false, resultConflict: false, resultState: "verified" }, "Source verified")).toBe("Verified, two sources");
    expect(displayedResultLabel({ resultProvenance: "manual", manuallyCorrected: true, resultConflict: true, resultState: "verified" }, "Source verified", "other")).toBe("manual corrected, not source verified");
    expect(displayedResultLabel({ resultProvenance: "", manuallyCorrected: false, resultConflict: false, resultState: "manual" }, "Manual")).toBe("older manual score");
    expect(explainResultIssue({ ...fixture, resultConflict: true, resultNote: "sport-ru 1-0; premierliga 2-0" })?.reason).toBe("Result-source conflict");
    const red = { ...fixture, manuallyCorrected: true, resultProvenance: "manual", resultConflict: true, resultState: "verified" };
    const report = roundConsistency({ counters: roundCounters({ comments: [], sets: [set()], fixtures: [red] }), fixtures: [red], selectedCoversFixture: () => true });
    expect(report.consistent).toBe(true);
    expect(report.blocking.join(" ")).not.toContain("result conflict");
    expect(report.notes.join(" ")).toContain("manual corrected, not source verified");
    expect(roundCounters({ comments: [], sets: [set()], fixtures: [red] }).corrections).toBe(0);
  });
});

function fixture(overrides: Partial<MetricFixture> = {}): MetricFixture {
  return {
    id: "m",
    homeTeam: "Home",
    awayTeam: "Away",
    actualHomeGoals: null,
    actualAwayGoals: null,
    resultState: "",
    resultResolution: "",
    resultConflict: false,
    manuallyCorrected: false,
    resultProvenance: "",
    resultNote: null,
    ...overrides,
  };
}

describe("review presentation counters", () => {
  it("keeps result conflicts out of the parse-conflict counter and pending out of the error count", () => {
    const conflict = fixture({ id: "conflict", resultConflict: true, resultNote: "sport-ru 1-0; premierliga 2-0" });
    const pending = fixture({ id: "later" });
    const unverified = fixture({ id: "provisional", actualHomeGoals: 1, actualAwayGoals: 0, resultState: "provisional", resultResolution: "provisional" });
    const counters = roundCounters({ comments: [], sets: [], fixtures: [conflict, pending, unverified] });
    expect(counters.conflicts).toBe(0);
    const rows = resultIssueRows([conflict, pending, unverified], () => true);
    expect(rows.find((row) => row.id === "conflict")?.kind).toBe("blocking");
    expect(rows.find((row) => row.id === "later:pending")?.kind).toBe("pending");
    expect(rows.find((row) => row.id === "provisional:unverified")?.kind).toBe("blocking");
    expect(resultIssueCount(rows)).toBe(2);
    expect(primaryConsistencyMetric(counters, rows)).toBe("results");
  });

  it("toggles the selected counter in the shareable review URL", () => {
    const path = "/admin/rounds/round/review";
    expect(reviewMetricHref(path, { metric: null }, "conflicts")).toBe(`${path}?metric=conflicts`);
    expect(reviewMetricHref(path, { metric: "conflicts", view: "accepted", q: "ada" }, "conflicts")).toBe(`${path}?view=accepted&q=ada`);
    expect(reviewMetricHref(path, { metric: "conflicts" }, "results")).toBe(`${path}?metric=results`);
  });

  it("keeps the review page from showing the old expanded warning blocks", () => {
    const page = readFileSync("src/app/admin/rounds/[roundId]/review/page.tsx", "utf8");
    const overview = readFileSync("src/app/admin/rounds/[roundId]/page.tsx", "utf8");
    const score = readFileSync("src/app/admin/rounds/[roundId]/review/score-lock.tsx", "utf8");
    expect(page).not.toContain("sets have a parse conflict");
    expect(page).not.toContain('id="result-issues"');
    expect(page).toContain("MetricPanel");
    expect(overview).not.toContain("prediction set has");
    expect(score).not.toContain("requestSubmit");
    expect(score).toContain("Save actual results");
  });
});
