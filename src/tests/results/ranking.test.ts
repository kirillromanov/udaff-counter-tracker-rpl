import { describe, expect, it } from "vitest";
import { applyResultDecision, type AlignedObservation } from "@/lib/domain/results/decide";
import { resolveFixture } from "@/lib/domain/results/policy";
import { STALE_AFTER_MS } from "@/lib/domain/results/ranking";

const now = new Date("2026-10-22T12:00:00Z");
const fresh = new Date(now.getTime() - 60 * 60 * 1000);
const stale = new Date(now.getTime() - STALE_AFTER_MS - 60 * 1000);

function row(source: string, role: AlignedObservation["role"], homeGoals: number, awayGoals: number, fetchedAt: Date = fresh): AlignedObservation {
  return {
    source,
    sourceKey: source,
    homeTeam: "Родина",
    awayTeam: "Оренбург",
    homeGoals,
    awayGoals,
    role,
    confidence: role === "verification" ? "medium" : "high",
    matchStatus: "finished",
    completeness: "complete",
    fetchedAt,
  };
}

describe("result confidence ranking", () => {
  const stored = { resultState: "open", actualHomeGoals: null, actualAwayGoals: null };

  it("verifies a high-confidence agreement and selects the strongest source", () => {
    const decision = resolveFixture(
      "rodina",
      [
        row("sport-ru", "primary", 2, 2),
        row("premierliga", "fallback", 2, 2),
        row("understat", "verification", 2, 2),
        row("footbolno", "verification", 2, 2),
      ],
      new Set(),
      { now },
    );
    expect(decision.resolution).toBe("verified");
    expect(decision.selectedSource).toBe("premierliga");
    expect(decision.homeGoals).toBe(2);
    expect(decision.candidates.filter((candidate) => candidate.standing === "agrees").map((candidate) => candidate.source).sort()).toEqual([
      "footbolno",
      "sport-ru",
      "understat",
    ]);
    expect(applyResultDecision(stored, decision)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultState: "verified",
      resultResolution: "verified",
      resultConflict: false,
    });
  });

  it("does not auto-finalize an official-strength disagreement, and downgrades a weaker dissent", () => {
    const clash = resolveFixture("rodina", [row("premierliga", "fallback", 2, 2), row("sport-ru", "primary", 3, 1)], new Set(), { now });
    expect(clash.resolution).toBe("conflict-review");
    expect(clash.selectedSource).toBeNull();
    expect(clash.homeGoals).toBeNull();
    expect(clash.note).toMatch(/disagree/);
    expect(clash.candidates.map((candidate) => candidate.standing).sort()).toEqual(["flagged", "flagged"]);
    expect(applyResultDecision({ resultState: "verified", actualHomeGoals: 2, actualAwayGoals: 2 }, clash)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultConflict: true,
      resultResolution: "conflict-review",
      changedGoals: false,
    });

    const weaker = resolveFixture("rodina", [row("premierliga", "fallback", 2, 2), row("footbolno", "verification", 1, 0)], new Set(), { now });
    expect(weaker.resolution).toBe("provisional");
    expect(weaker.selectedSource).toBe("premierliga");
    expect(weaker.candidates.find((candidate) => candidate.source === "footbolno")?.standing).toBe("downgraded");
    expect(applyResultDecision(stored, weaker)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultState: "confirmed",
      resultResolution: "provisional",
      resultConflict: false,
    });
  });

  it("leaves verification-only evidence as insufficient data", () => {
    const decision = resolveFixture(
      "rodina",
      [row("understat", "verification", 2, 2), row("footbolno", "verification", 2, 2)],
      new Set(),
      { now },
    );
    expect(decision.resolution).toBe("insufficient");
    expect(decision.outcome).toBe("none");
    expect(decision.note).toMatch(/Insufficient data/);
    expect(decision.candidates.every((candidate) => candidate.reason.includes("cannot accept a score alone"))).toBe(true);
    expect(applyResultDecision({ resultState: "open", actualHomeGoals: 4, actualAwayGoals: 0 }, decision)).toMatchObject({
      actualHomeGoals: 4,
      actualAwayGoals: 0,
      resultResolution: "insufficient",
      resultConflict: false,
      changedGoals: false,
    });
  });

  it("downgrades a stale source and ignores a failed source", () => {
    const staleDecision = resolveFixture(
      "rodina",
      [row("sport-ru", "primary", 1, 0, stale), row("premierliga", "fallback", 2, 2), row("football-data", "fallback", 2, 2)],
      new Set(),
      { now },
    );
    expect(staleDecision.resolution).toBe("verified");
    expect(staleDecision.selectedSource).toBe("premierliga");
    expect(staleDecision.homeGoals).toBe(2);
    expect(staleDecision.candidates.find((candidate) => candidate.source === "sport-ru")).toMatchObject({
      standing: "downgraded",
    });
    expect(staleDecision.candidates.find((candidate) => candidate.source === "sport-ru")?.reason).toMatch(/36 hours/);

    const failed = resolveFixture("rodina", [row("sport-ru", "primary", 9, 9), row("premierliga", "fallback", 2, 2)], new Set(["sport-ru"]), { now });
    expect(failed.resolution).toBe("provisional");
    expect(failed.selectedSource).toBe("premierliga");
    expect(failed.note).toMatch(/Preferred source is unavailable/);
    expect(failed.candidates.find((candidate) => candidate.source === "sport-ru")?.standing).toBe("excluded");
    expect(applyResultDecision(stored, failed)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultResolution: "provisional",
      resultConflict: false,
    });
  });
});
