import type { ResultDecision, AlignedObservation } from "./decide";
import { decideFixture, isDecisiveEvidence } from "./decide";
import type { SourceAdapter, SourceFetchResult, SourceRole } from "./types";

/** Three consecutive failures mark a source degraded until the next success. */
export const DEGRADED_AFTER_FAILURES = 3;

export const SOURCE_POLICY = {
  preferred: ["sport-ru"],
  fallback: ["championat", "sportbox", "football-data", "premierliga"],
  verification: ["understat", "footbolno"],
} as const;

export interface SourceHealth {
  source: string;
  role: SourceRole;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  degraded: boolean;
  lastError: string | null;
}

export function nextSourceHealth(
  previous: SourceHealth | null,
  attempt: { source: string; role: SourceRole; status: "ok" | "failed"; error: string | null; at: Date },
): SourceHealth {
  if (attempt.status === "ok") {
    return {
      source: attempt.source,
      role: attempt.role,
      lastSuccessAt: attempt.at,
      lastFailureAt: previous?.lastFailureAt ?? null,
      consecutiveFailures: 0,
      degraded: false,
      lastError: null,
    };
  }
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
  return {
    source: attempt.source,
    role: attempt.role,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    lastFailureAt: attempt.at,
    consecutiveFailures,
    degraded: consecutiveFailures >= DEGRADED_AFTER_FAILURES,
    lastError: attempt.error,
  };
}

/** A source that failed this run, or is still degraded, must not decide a fixture. */
export function unavailableSources(
  attempts: readonly { source: string; status: "ok" | "failed" }[],
  health: readonly Pick<SourceHealth, "source" | "degraded">[],
): Set<string> {
  const unavailable = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.status === "failed") {
      unavailable.add(attempt.source);
    }
  }
  for (const row of health) {
    if (row.degraded) {
      unavailable.add(row.source);
    }
  }
  return unavailable;
}

/**
 * Preferred source wins when it reported a valid score.
 * A missing or failed preferred source falls through to fallbacks.
 * Disagreement among the sources that are available stays a conflict.
 */
export function resolveFixture(
  fixtureId: string,
  observations: readonly AlignedObservation[],
  unavailable: ReadonlySet<string>,
): ResultDecision {
  const available = observations.filter((item) => !unavailable.has(item.source) && isDecisiveEvidence(item));
  const decision = decideFixture(fixtureId, available);
  const preferredDown = SOURCE_POLICY.preferred.some((source) => unavailable.has(source));
  const preferredReported = available.some((item) => item.role === "primary");
  if (preferredReported || decision.outcome === "none") {
    return decision;
  }
  const why = preferredDown ? "Preferred source is unavailable." : "Preferred source did not report this match.";
  return { ...decision, note: `${why} ${decision.note}` };
}

/** One source throwing must not reject the rest of the round. */
export async function collectSourceFetches(
  adapters: readonly SourceAdapter[],
  read: (adapter: SourceAdapter) => Promise<SourceFetchResult>,
): Promise<SourceFetchResult[]> {
  return Promise.all(
    adapters.map(async (adapter) => {
      try {
        return await read(adapter);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Request failed";
        return { source: adapter.id, role: adapter.role, url: adapter.url, status: "failed", results: [], error: message };
      }
    }),
  );
}
