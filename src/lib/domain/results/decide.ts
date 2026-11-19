import { teamSimilarity } from "@/lib/domain/parser/match-fixture";
import { rankFixtureResult, type RankedCandidate, type ResolutionClass } from "./ranking";
import { canonicalTeamName } from "./team-names";
import type { ConfidenceLevel, SourceMatch, SourceRole } from "./types";

const MIN_SIDE = 0.8;

export interface FixtureSide {
  id: string;
  homeTeam: string;
  awayTeam: string;
}

export interface AlignedObservation {
  source: string;
  sourceKey: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  role: SourceRole;
  confidence: ConfidenceLevel;
  matchStatus?: string | null;
  completeness?: string | null;
  fetchedAt?: Date | null;
}

export interface ResultDecision {
  fixtureId: string;
  outcome: "none" | "confirmed" | "verified" | "conflict";
  /** verified, provisional, conflict-review, or insufficient. */
  resolution: ResolutionClass;
  homeGoals: number | null;
  awayGoals: number | null;
  selectedSource: string | null;
  candidates: RankedCandidate[];
  note: string;
}

export interface StoredResult {
  resultState: string;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
}

export interface ResultWrite {
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultConflict: boolean;
  resultNote: string | null;
  resultResolution: string;
  changedGoals: boolean;
}

function sideScore(result: Pick<SourceMatch, "homeTeam" | "awayTeam">, fixture: FixtureSide, swapped: boolean): number {
  const home = canonicalTeamName(swapped ? result.awayTeam : result.homeTeam);
  const away = canonicalTeamName(swapped ? result.homeTeam : result.awayTeam);
  return Math.min(teamSimilarity(home, fixture.homeTeam), teamSimilarity(away, fixture.awayTeam));
}

export function alignToFixture(
  fixture: FixtureSide,
  result: Pick<SourceMatch, "homeTeam" | "awayTeam" | "homeGoals" | "awayGoals">,
): { homeGoals: number; awayGoals: number; score: number } | null {
  const direct = sideScore(result, fixture, false);
  const swapped = sideScore(result, fixture, true);
  if (direct < MIN_SIDE && swapped < MIN_SIDE) {
    return null;
  }
  if (direct >= swapped) {
    return { homeGoals: result.homeGoals, awayGoals: result.awayGoals, score: direct };
  }
  return { homeGoals: result.awayGoals, awayGoals: result.homeGoals, score: swapped };
}

/** Attach each source row to at most one fixture. An ambiguous pair is left unmatched. */
export function attachResults(fixtures: readonly FixtureSide[], results: readonly SourceMatch[]): Map<string, AlignedObservation[]> {
  const grouped = new Map<string, AlignedObservation[]>();
  for (const result of results) {
    const ranked = fixtures
      .map((fixture) => {
        const aligned = alignToFixture(fixture, result);
        return aligned ? { fixture, aligned } : null;
      })
      .filter((item): item is { fixture: FixtureSide; aligned: { homeGoals: number; awayGoals: number; score: number } } => item != null)
      .sort((left, right) => right.aligned.score - left.aligned.score);
    const best = ranked[0];
    const next = ranked[1];
    if (!best || (next && best.aligned.score - next.aligned.score < 0.05)) {
      continue;
    }
    const list = grouped.get(best.fixture.id) ?? [];
    list.push({
      source: result.source,
      sourceKey: result.sourceKey,
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      homeGoals: best.aligned.homeGoals,
      awayGoals: best.aligned.awayGoals,
      role: result.role,
      confidence: result.confidence,
      matchStatus: result.matchStatus ?? "finished",
      completeness: result.completeness ?? "complete",
    });
    grouped.set(best.fixture.id, list);
  }
  return grouped;
}

/** A partial parse, or a match that is not finished, stays visible and does not decide the score. */
export function isDecisiveEvidence(observation: Pick<AlignedObservation, "matchStatus" | "completeness">): boolean {
  if (observation.completeness === "partial") {
    return false;
  }
  return (observation.matchStatus ?? "finished") === "finished";
}

export function decideFixture(
  fixtureId: string,
  observations: readonly AlignedObservation[],
  options?: { now?: Date; unavailable?: ReadonlySet<string> },
): ResultDecision {
  const ranking = rankFixtureResult(observations, options);
  const outcome =
    ranking.classification === "verified" ? "verified" : ranking.classification === "provisional" ? "confirmed" : ranking.classification === "conflict-review" ? "conflict" : "none";
  return {
    fixtureId,
    outcome,
    resolution: ranking.classification,
    homeGoals: outcome === "verified" || outcome === "confirmed" ? ranking.homeGoals : null,
    awayGoals: outcome === "verified" || outcome === "confirmed" ? ranking.awayGoals : null,
    selectedSource: ranking.selectedSource,
    candidates: ranking.candidates,
    note: ranking.note,
  };
}

/** Write a confirmed score. A conflict or a manual score never replaces the goals already stored. */
export function applyResultDecision(stored: StoredResult, decision: ResultDecision): ResultWrite {
  if (decision.outcome === "none") {
    return {
      actualHomeGoals: stored.actualHomeGoals,
      actualAwayGoals: stored.actualAwayGoals,
      resultState: stored.resultState,
      resultConflict: false,
      resultNote: decision.note || null,
      resultResolution: decision.note ? "insufficient" : "",
      changedGoals: false,
    };
  }
  if (decision.outcome === "conflict" || decision.homeGoals == null || decision.awayGoals == null) {
    return {
      actualHomeGoals: stored.actualHomeGoals,
      actualAwayGoals: stored.actualAwayGoals,
      resultState: stored.resultState === "manual" || stored.resultState === "confirmed" || stored.resultState === "verified" ? stored.resultState : "conflict",
      resultConflict: true,
      resultNote: decision.note,
      resultResolution: "conflict-review",
      changedGoals: false,
    };
  }
  const same = stored.actualHomeGoals === decision.homeGoals && stored.actualAwayGoals === decision.awayGoals;
  if (stored.resultState === "manual") {
    return {
      actualHomeGoals: stored.actualHomeGoals,
      actualAwayGoals: stored.actualAwayGoals,
      resultState: "manual",
      resultConflict: stored.actualHomeGoals != null && !same,
      resultNote:
        stored.actualHomeGoals != null && !same
          ? `Manual score ${stored.actualHomeGoals}-${stored.actualAwayGoals} was kept. ${decision.note}`
          : "Manual score matches the sources.",
      resultResolution: stored.actualHomeGoals != null && !same ? "conflict-review" : "manual",
      changedGoals: false,
    };
  }
  return {
    actualHomeGoals: decision.homeGoals,
    actualAwayGoals: decision.awayGoals,
    resultState: decision.outcome === "verified" ? "verified" : "confirmed",
    resultConflict: false,
    resultNote: decision.note,
    resultResolution: decision.resolution === "verified" ? "verified" : "provisional",
    changedGoals: !same,
  };
}
