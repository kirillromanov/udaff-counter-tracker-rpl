import { describe, expect, it } from "vitest";
import { parseCellScore, revisionToken, revisionsMatch } from "@/lib/domain/import/matrix-edits";

describe("clean matrix edits", () => {
  it("treats an empty cell as missing and 0-0 as a real score", () => {
    expect(parseCellScore("")).toBeNull();
    expect(parseCellScore("—")).toBeNull();
    expect(parseCellScore("0-0")).toEqual({ home: 0, away: 0 });
    expect(parseCellScore("2:2")).toEqual({ home: 2, away: 2 });
  });

  it("rejects a stale revision instead of saving over a newer edit", () => {
    const stored = revisionToken(new Date("2026-11-05T16:00:00Z"));

    expect(revisionsMatch(stored, stored)).toBe(true);
    expect(revisionsMatch(stored, revisionToken(new Date("2026-11-05T16:05:00Z")))).toBe(false);
    expect(revisionsMatch("new", "new")).toBe(true);
  });
});
