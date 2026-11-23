import { describe, expect, it } from "vitest";
import { automaticProvenanceUpdate } from "@/lib/domain/results/decide";
import { readFixtureScoreEdit } from "@/lib/domain/results/correction";

describe("unified fixture score entry", () => {
  it("leaves an unchanged score, rejects a clear, and edits a different score", () => {
    expect(readFixtureScoreEdit(1, 0, "1", "0")).toBe("leave");
    expect(readFixtureScoreEdit(1, 0, "", "")).toBe("clear");
    expect(readFixtureScoreEdit(null, null, "", "")).toBe("leave");
    expect(readFixtureScoreEdit(1, 0, "2", "")).toBe("partial");
    expect(readFixtureScoreEdit(1, 0, "2", "0")).toBe("edit");
  });

  it("lets two agreeing sources replace only a same-score confirmation", () => {
    const replacement = { changedGoals: true, resultState: "verified", resultResolution: "verified" } as const;
    expect(automaticProvenanceUpdate("operator-confirmed", replacement)).toBe("two-source");
    expect(automaticProvenanceUpdate("manual", replacement)).toBeNull();
    expect(automaticProvenanceUpdate("operator-confirmed", { ...replacement, changedGoals: false })).toBeNull();
  });
});
