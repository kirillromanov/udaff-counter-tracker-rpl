import { describe, expect, it } from "vitest";
import { applyResultDecision } from "@/lib/domain/results/decide";
import { collectSourceFetches, DEGRADED_AFTER_FAILURES, nextSourceHealth, resolveFixture, SOURCE_POLICY, unavailableSources } from "@/lib/domain/results/policy";
import { RESULT_ADAPTERS } from "@/lib/domain/results/sources";
import type { SourceAdapter, SourceFetchResult } from "@/lib/domain/results/types";

const at = new Date("2026-10-22T12:00:00Z");

function observation(source: string, role: "primary" | "fallback" | "verification", homeGoals: number, awayGoals: number) {
  return {
    source,
    sourceKey: source,
    homeTeam: "Родина",
    awayTeam: "Оренбург",
    homeGoals,
    awayGoals,
    role,
    confidence: role === "verification" ? "medium" as const : "high" as const,
  };
}

describe("source health", () => {
  it("marks a source degraded after consecutive failures and clears it on success", () => {
    let health = nextSourceHealth(null, { source: "sport-ru", role: "primary", status: "failed", error: "HTTP 503", at });
    expect(health.degraded).toBe(false);
    expect(health.consecutiveFailures).toBe(1);
    expect(health.lastFailureAt).toEqual(at);
    for (let count = 2; count < DEGRADED_AFTER_FAILURES; count += 1) {
      health = nextSourceHealth(health, { source: "sport-ru", role: "primary", status: "failed", error: "HTTP 503", at });
    }
    expect(health.degraded).toBe(false);
    health = nextSourceHealth(health, { source: "sport-ru", role: "primary", status: "failed", error: "HTTP 503", at });
    expect(health.consecutiveFailures).toBe(DEGRADED_AFTER_FAILURES);
    expect(health.degraded).toBe(true);
    expect(health.lastSuccessAt).toBeNull();

    const recovered = nextSourceHealth(health, { source: "sport-ru", role: "primary", status: "ok", error: null, at });
    expect(recovered.degraded).toBe(false);
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.lastError).toBeNull();
    expect(recovered.lastSuccessAt).toEqual(at);
    expect(recovered.lastFailureAt).toEqual(at);
  });
});

describe("source failover", () => {
  const stored = { resultState: "confirmed", actualHomeGoals: 2, actualAwayGoals: 2 };

  it("uses the preferred source when it is available", () => {
    const decision = resolveFixture("rodina", [observation("sport-ru", "primary", 2, 2), observation("football-data", "fallback", 2, 2)], new Set());
    expect(decision.outcome).toBe("verified");
    expect(decision.homeGoals).toBe(2);
  });

  it("falls back when the preferred source failed and does not let that failure veto the score", () => {
    const unavailable = unavailableSources(
      [
        { source: "sport-ru", status: "failed" },
        { source: "football-data", status: "ok" },
      ],
      [{ source: "sport-ru", degraded: false }],
    );
    const decision = resolveFixture(
      "rodina",
      [observation("sport-ru", "primary", 1, 0), observation("football-data", "fallback", 2, 2)],
      unavailable,
    );
    expect(decision.outcome).toBe("confirmed");
    expect(decision.homeGoals).toBe(2);
    expect(decision.note).toMatch(/Preferred source is unavailable/);
    expect(applyResultDecision(stored, decision)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultState: "confirmed",
      resultConflict: false,
    });
  });

  it("keeps the stored score when every writer is unavailable", () => {
    const unavailable = unavailableSources(
      [{ source: "sport-ru", status: "failed" }, { source: "football-data", status: "failed" }],
      [],
    );
    const decision = resolveFixture("rodina", [observation("sport-ru", "primary", 2, 2), observation("understat", "verification", 2, 2)], unavailable);
    expect(decision.outcome).toBe("none");
    expect(applyResultDecision(stored, decision)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      changedGoals: false,
    });
  });

  it("still reports a conflict when healthy sources disagree", () => {
    const decision = resolveFixture(
      "rodina",
      [observation("sport-ru", "primary", 2, 2), observation("football-data", "fallback", 1, 0)],
      new Set(),
    );
    expect(decision.outcome).toBe("conflict");
    expect(applyResultDecision(stored, decision)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultConflict: true,
      changedGoals: false,
    });
  });

  it("ignores a degraded source so its old score cannot hide a fallback", () => {
    const unavailable = unavailableSources([{ source: "football-data", status: "ok" }], [{ source: "sport-ru", degraded: true }]);
    const decision = resolveFixture(
      "rodina",
      [observation("sport-ru", "primary", 9, 9), observation("football-data", "fallback", 2, 2)],
      unavailable,
    );
    expect(decision.outcome).toBe("confirmed");
    expect(decision.homeGoals).toBe(2);
    expect(decision.note).toMatch(/Preferred source is unavailable/);
  });

  it("keeps going when one source call throws", async () => {
    const adapters: SourceAdapter[] = [
      { id: "sport-ru", role: "primary", confidence: "high", url: "https://sport.example", parse: () => [] },
      { id: "football-data", role: "fallback", confidence: "high", url: "https://fd.example", parse: () => [] },
    ];
    const results = await collectSourceFetches(adapters, async (adapter) => {
      if (adapter.id === "sport-ru") {
        throw new Error("socket hang up");
      }
      const ok: SourceFetchResult = {
        source: adapter.id,
        role: adapter.role,
        url: adapter.url,
        status: "ok",
        results: [],
        error: null,
      };
      return ok;
    });
    expect(results.map((result) => [result.source, result.status, result.error])).toEqual([
      ["sport-ru", "failed", "socket hang up"],
      ["football-data", "ok", null],
    ]);
  });

  it("keeps adapter roles aligned with the published policy", () => {
    expect(RESULT_ADAPTERS.filter((adapter) => adapter.role === "primary").map((adapter) => adapter.id)).toEqual([...SOURCE_POLICY.preferred]);
    expect(RESULT_ADAPTERS.filter((adapter) => adapter.role === "fallback").map((adapter) => adapter.id)).toEqual([...SOURCE_POLICY.fallback]);
    expect(RESULT_ADAPTERS.filter((adapter) => adapter.role === "verification").map((adapter) => adapter.id)).toEqual([...SOURCE_POLICY.verification]);
  });
});
