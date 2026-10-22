import { describe, expect, it } from "vitest";
import {
  ARCHIVED_ROUND,
  OPERATIONAL_ROUND,
  countsTowardProduction,
  standingRoleForRound,
  standingRoleLabel,
} from "@/lib/domain/standings/round-role";

describe("round standing roles", () => {
  it("archives every round covered by the trusted baseline and keeps later rounds in production", () => {
    expect(standingRoleForRound(1, 11)).toBe(ARCHIVED_ROUND);
    expect(standingRoleForRound(11, 11)).toBe(ARCHIVED_ROUND);
    expect(standingRoleForRound(12, 11)).toBe(OPERATIONAL_ROUND);
    expect(standingRoleLabel(ARCHIVED_ROUND)).toBe("Archived reference");
    expect(standingRoleLabel(OPERATIONAL_ROUND)).toBe("Production");
  });

  it("keeps a season with no baseline entirely operational", () => {
    expect(standingRoleForRound(3, null)).toBe(OPERATIONAL_ROUND);
    expect(countsTowardProduction(OPERATIONAL_ROUND, 3, null)).toBe(true);
  });

  it("excludes archived rounds and rounds already inside the baseline from production accumulation", () => {
    expect(countsTowardProduction(ARCHIVED_ROUND, 7, 11)).toBe(false);
    expect(countsTowardProduction(ARCHIVED_ROUND, 14, 11)).toBe(false);
    expect(countsTowardProduction(OPERATIONAL_ROUND, 11, 11)).toBe(false);
    expect(countsTowardProduction(OPERATIONAL_ROUND, 12, 11)).toBe(true);
  });
});
