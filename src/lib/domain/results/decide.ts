import { teamSimilarity } from "@/lib/domain/parser/match-fixture";
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
}

export interface ResultDecision {
  fixtureId: string;
  outcome: "none" | "confirmed" | "verified" | "conflict";
  homeGoals: number | null;
  awayGoals: number | null;
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
    });
    grouped.set(best.fixture.id, list);
  }
  return grouped;
}

function sameScore(left: AlignedObservation, right: AlignedObservation): boolean {
  return left.homeGoals === right.homeGoals && left.awayGoals === right.awayGoals;
}

function canWriteScore(observation: AlignedObservation): boolean {
  return observation.role !== "verification";
}

export function decideFixture(fixtureId: string, observations: readonly AlignedObservation[]): ResultDecision {
  if (observations.length === 0) {
    return { fixtureId, outcome: "none", homeGoals: null, awayGoals: null, note: "" };
  }
  const first = observations[0] as AlignedObservation;
  const agreed = observations.every((item) => sameScore(item, first));
  const listed = observations.map((item) => `${item.source} (${item.role}, ${item.confidence}) ${item.homeGoals}-${item.awayGoals}`).join(", ");
  if (!agreed) {
    return {
      fixtureId,
      outcome: "conflict",
      homeGoals: null,
      awayGoals: null,
      note: `Sources disagree: ${listed}. The stored score was left unchanged.`,
    };
  }
  const writers = observations.filter(canWriteScore);
  if (writers.length === 0) {
    return { fixtureId, outcome: "none", homeGoals: null, awayGoals: null, note: "" };
  }
  const names = observations.map((item) => item.source).join(" and ");
  if (observations.length >= 2) {
    return {
      fixtureId,
      outcome: "verified",
      homeGoals: first.homeGoals,
      awayGoals: first.awayGoals,
      note: `Verified by ${names}.`,
    };
  }
  return {
    fixtureId,
    outcome: "confirmed",
    homeGoals: first.homeGoals,
    awayGoals: first.awayGoals,
    note: `Confirmed by ${names}. No other source reported this match.`,
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
      resultNote: null,
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
      changedGoals: false,
    };
  }
  return {
    actualHomeGoals: decision.homeGoals,
    actualAwayGoals: decision.awayGoals,
    resultState: decision.outcome === "verified" ? "verified" : "confirmed",
    resultConflict: false,
    resultNote: decision.note,
    changedGoals: !same,
  };
}
