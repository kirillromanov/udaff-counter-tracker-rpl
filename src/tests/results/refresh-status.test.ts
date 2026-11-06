import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beginRoundRefresh, finishRoundRefresh } from "@/lib/domain/results/poll-run";
import { describeRefreshQuery, hasUnsavedFieldEdits } from "@/lib/domain/results/refresh-status";

describe("shared match-result refresh", () => {
  it("renders the same refresh control in the clean matrix and the fixtures results section", () => {
    const matrix = readFileSync("src/app/admin/rounds/[roundId]/review/clean-matrix.tsx", "utf8");
    const fixtures = readFileSync("src/app/admin/rounds/[roundId]/fixtures/page.tsx", "utf8");
    const button = readFileSync("src/app/admin/rounds/[roundId]/refresh-results-button.tsx", "utf8");
    expect(matrix).toContain("MatchResultsRefresh");
    expect(matrix).toContain('returnTo="review"');
    expect(fixtures).toContain("MatchResultsRefresh");
    expect(fixtures).toContain('returnTo="fixtures"');
    expect(button).toContain("refreshMatchResultsAction");
    expect(button).toContain("Обновить результаты матчей");
  });

  it("keeps a failed source check distinct from an unchanged successful check", () => {
    expect(describeRefreshQuery({ refreshed: "1", failed: "4", sourceOk: "0", updated: "0" })).toMatchObject({ tone: "error" });
    expect(describeRefreshQuery({ refreshed: "1", failed: "1", sourceOk: "2", updated: "0", conflicts: "0" })?.text).toMatch(/unchanged/);
    expect(describeRefreshQuery({ refreshed: "1", sourceOk: "2", updated: "3", conflicts: "1" })?.tone).toBe("warning");
    expect(describeRefreshQuery({ busy: "1" })?.text).toMatch(/already running/);
  });

  it("detects unsaved edits and ignores the refresh form's own hidden fields", () => {
    expect(hasUnsavedFieldEdits([{ value: "1-0", defaultValue: "" }])).toBe(true);
    expect(hasUnsavedFieldEdits([{ value: "1-0", defaultValue: "1-0" }])).toBe(false);
    expect(hasUnsavedFieldEdits([{ type: "hidden", value: "round", defaultValue: "" }])).toBe(false);
    expect(hasUnsavedFieldEdits([{ type: "checkbox", checked: true, defaultChecked: false }])).toBe(true);
  });

  it("does not start a second refresh for the same round while the first lock is held", () => {
    expect(beginRoundRefresh("round-14")).toBe(true);
    expect(beginRoundRefresh("round-14")).toBe(false);
    expect(beginRoundRefresh("round-15")).toBe(true);
    finishRoundRefresh("round-14");
    finishRoundRefresh("round-15");
    expect(beginRoundRefresh("round-14")).toBe(true);
    finishRoundRefresh("round-14");
  });
});
