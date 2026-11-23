import { describe, expect, it } from "vitest";
import { displayedResultLabel, LABEL_FIXED_ONE_SOURCE, LABEL_MANUAL_NOT_VERIFIED, LABEL_OLDER_MANUAL, LABEL_VERIFIED_FIXED, readFixtureScoreEdit, recomputeFromSources, sourceAgreement } from "@/lib/domain/results/correction";

const fresh = new Date("2026-11-23T16:00:00.000Z");

function observation(source: string, home: number, away: number) {
  return {
    source,
    sourceKey: source,
    homeGoals: home,
    awayGoals: away,
    role: "primary",
    confidence: "high",
    matchStatus: "finished",
    completeness: "complete",
    fetchedAt: fresh,
  };
}

describe("fixture score lock labels", () => {
  it("leaves an unchanged score, rejects a clear, and edits a different score", () => {
    expect(readFixtureScoreEdit(1, 0, "1", "0")).toBe("leave");
    expect(readFixtureScoreEdit(1, 0, "", "")).toBe("clear");
    expect(readFixtureScoreEdit(null, null, "", "")).toBe("leave");
    expect(readFixtureScoreEdit(1, 0, "2", "")).toBe("partial");
    expect(readFixtureScoreEdit(1, 0, "2", "0")).toBe("edit");
  });

  it("names an automatic score, a fixed score, and an older manual row", () => {
    expect(displayedResultLabel({ resultProvenance: "", manuallyCorrected: false, resultConflict: false, resultState: "verified" }, "Source verified")).toBe("Source verified");
    expect(displayedResultLabel({ resultProvenance: "one-source", manuallyCorrected: false, resultConflict: false, resultState: "confirmed" }, "Finished")).toBe("Provisional");
    expect(displayedResultLabel({ resultProvenance: "two-source", manuallyCorrected: false, resultConflict: false, resultState: "verified" }, "Finished")).toBe("Verified, two sources");
    expect(displayedResultLabel({ resultProvenance: "", manuallyCorrected: false, resultConflict: false, resultState: "manual" }, "Manual")).toBe(LABEL_OLDER_MANUAL);
    const fixed = { resultProvenance: "manual", manuallyCorrected: true, resultConflict: false, resultState: "verified" };
    expect(displayedResultLabel(fixed, "Finished", "verified")).toBe(LABEL_VERIFIED_FIXED);
    expect(displayedResultLabel(fixed, "Finished", "provisional")).toBe(LABEL_FIXED_ONE_SOURCE);
    expect(displayedResultLabel({ ...fixed, resultConflict: true }, "Finished", "other")).toBe(LABEL_MANUAL_NOT_VERIFIED);
  });

  it("compares a fixed score with stored sources and recomputes each source situation", () => {
    const one = [observation("sport-ru", 1, 0)];
    const two = [observation("sport-ru", 1, 0), observation("premierliga", 1, 0)];
    const split = [observation("sport-ru", 1, 0), observation("premierliga", 2, 0)];
    expect(sourceAgreement(1, 0, one)).toBe("provisional");
    expect(sourceAgreement(1, 0, two)).toBe("verified");
    expect(sourceAgreement(3, 0, two)).toBe("other");
    expect(recomputeFromSources(one)).toMatchObject({ resultState: "confirmed", resultProvenance: "", awaitingRecheck: true, home: 1, away: 0 });
    expect(recomputeFromSources(two)).toMatchObject({ resultState: "verified", resultProvenance: "two-source", awaitingRecheck: false, home: 1, away: 0 });
    expect(recomputeFromSources(split)).toMatchObject({ resultState: "conflict", resultConflict: true, home: null, away: null, awaitingRecheck: true });
  });
});
