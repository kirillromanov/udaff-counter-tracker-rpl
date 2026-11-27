import { teamSimilarity } from "@/lib/domain/parser/match-fixture";
import { teamKey } from "@/lib/domain/parser/normalize";
import { rankFixtureResult, type RankedCandidate, type ResolutionClass } from "./ranking";
import { canonicalTeamName } from "./team-names";
import type { ConfidenceLevel, SourceMatch, SourceRole } from "./types";

const MIN_SIDE = 0.8;

export interface FixtureSide {
  id: string;
  homeTeam: string;
  awayTeam: string;
  /** Saved TeamNameAlias spellings for the stored home club. Matching stays inside this round. */
  homeAliases?: readonly string[];
  awayAliases?: readonly string[];
}

export type NameMatch = "team-key" | "alias" | "similarity";

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
  nameMatch?: NameMatch;
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
  resultResolution?: string;
  resultProvenance?: string;
  resultNote?: string | null;
  manuallyCorrected?: boolean;
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

function labelKeys(labels: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const label of labels) {
    const raw = teamKey(label);
    const canonical = teamKey(canonicalTeamName(label));
    if (raw) {
      keys.add(raw);
    }
    if (canonical) {
      keys.add(canonical);
    }
  }
  return keys;
}

/** Exact teamKey of the source name, or of its English canonical form. No letter folding. */
function sourceKeys(name: string): Set<string> {
  return labelKeys([name]);
}

function dynamoClub(key: string): "moscow" | "makhachkala" | null {
  if (key.includes("махачкала") || key.includes("мх") || key.includes("мx")) {
    return "makhachkala";
  }
  if (key === "динамо" || key === "динамо м" || key === "динамо москва") {
    return "moscow";
  }
  return null;
}

/** Bare Dynamo Moscow and Dynamo Makhachkala do not similarity-match each other. */
function dynamoCross(left: string, right: string): boolean {
  const a = dynamoClub(teamKey(canonicalTeamName(left)));
  const b = dynamoClub(teamKey(canonicalTeamName(right)));
  return (a === "moscow" && b === "makhachkala") || (a === "makhachkala" && b === "moscow");
}

function exactSide(sourceName: string, fixtureName: string, aliases: readonly string[]): "team-key" | "alias" | null {
  const wanted = sourceKeys(sourceName);
  const stored = labelKeys([fixtureName]);
  for (const key of wanted) {
    if (stored.has(key)) {
      return "team-key";
    }
  }
  const saved = labelKeys(aliases);
  for (const key of wanted) {
    if (saved.has(key)) {
      return "alias";
    }
  }
  return null;
}

function combineMatch(home: "team-key" | "alias", away: "team-key" | "alias"): NameMatch {
  return home === "alias" || away === "alias" ? "alias" : "team-key";
}

function sideScore(result: Pick<SourceMatch, "homeTeam" | "awayTeam">, fixture: FixtureSide, swapped: boolean): number {
  const home = canonicalTeamName(swapped ? result.awayTeam : result.homeTeam);
  const away = canonicalTeamName(swapped ? result.homeTeam : result.awayTeam);
  if (dynamoCross(home, fixture.homeTeam) || dynamoCross(away, fixture.awayTeam)) {
    return 0;
  }
  return Math.min(teamSimilarity(home, fixture.homeTeam), teamSimilarity(away, fixture.awayTeam));
}

export function alignToFixture(
  fixture: FixtureSide,
  result: Pick<SourceMatch, "homeTeam" | "awayTeam" | "homeGoals" | "awayGoals">,
): { homeGoals: number; awayGoals: number; score: number; nameMatch: NameMatch } | null {
  const directHome = exactSide(result.homeTeam, fixture.homeTeam, fixture.homeAliases ?? []);
  const directAway = exactSide(result.awayTeam, fixture.awayTeam, fixture.awayAliases ?? []);
  const swapHome = exactSide(result.awayTeam, fixture.homeTeam, fixture.homeAliases ?? []);
  const swapAway = exactSide(result.homeTeam, fixture.awayTeam, fixture.awayAliases ?? []);
  const direct = directHome && directAway ? combineMatch(directHome, directAway) : null;
  const swapped = swapHome && swapAway ? combineMatch(swapHome, swapAway) : null;
  if (direct && !swapped) {
    return { homeGoals: result.homeGoals, awayGoals: result.awayGoals, score: 1, nameMatch: direct };
  }
  if (swapped && !direct) {
    return { homeGoals: result.awayGoals, awayGoals: result.homeGoals, score: 1, nameMatch: swapped };
  }
  if (direct && swapped) {
    return null;
  }
  const directScore = sideScore(result, fixture, false);
  const swappedScore = sideScore(result, fixture, true);
  if (directScore < MIN_SIDE && swappedScore < MIN_SIDE) {
    return null;
  }
  if (directScore >= swappedScore) {
    return { homeGoals: result.homeGoals, awayGoals: result.awayGoals, score: directScore, nameMatch: "similarity" };
  }
  return { homeGoals: result.awayGoals, awayGoals: result.homeGoals, score: swappedScore, nameMatch: "similarity" };
}

export interface AttachmentPartition {
  attached: Map<string, AlignedObservation[]>;
  /** Source rows that hit more than one fixture. They are not assigned. */
  ambiguous: SourceMatch[];
}

/**
 * Attach each source row to at most one fixture in this list.
 * Exact teamKey and saved spellings win. Similarity is the fallback when no
 * spelling hits. An ambiguous pair is flagged and not guessed.
 */
export function partitionResultAttachments(
  fixtures: readonly FixtureSide[],
  results: readonly SourceMatch[],
): AttachmentPartition {
  const grouped = new Map<string, AlignedObservation[]>();
  const ambiguous: SourceMatch[] = [];
  for (const result of results) {
    const ranked = fixtures
      .map((fixture) => {
        const aligned = alignToFixture(fixture, result);
        return aligned ? { fixture, aligned } : null;
      })
      .filter((item): item is { fixture: FixtureSide; aligned: NonNullable<ReturnType<typeof alignToFixture>> } => item != null)
      .sort((left, right) => right.aligned.score - left.aligned.score);
    const exact = ranked.filter((item) => item.aligned.nameMatch !== "similarity");
    const pool = exact.length > 0 ? exact : ranked;
    const best = pool[0];
    const next = pool[1];
    if (!best || (next && best.aligned.score - next.aligned.score < 0.05)) {
      if (best && next && best.aligned.score - next.aligned.score < 0.05) {
        ambiguous.push(result);
      }
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
      nameMatch: best.aligned.nameMatch,
    });
    grouped.set(best.fixture.id, list);
  }
  return { attached: grouped, ambiguous };
}

/** Attach each source row to at most one fixture. An ambiguous pair is left unmatched. */
export function attachResults(fixtures: readonly FixtureSide[], results: readonly SourceMatch[]): Map<string, AlignedObservation[]> {
  return partitionResultAttachments(fixtures, results).attached;
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
    const held = stored.manuallyCorrected || stored.resultState === "verified" || stored.resultResolution === "verified" || stored.resultState === "manual";
    return {
      actualHomeGoals: stored.actualHomeGoals,
      actualAwayGoals: stored.actualAwayGoals,
      resultState: stored.resultState === "manual" || stored.resultState === "confirmed" || stored.resultState === "verified" ? stored.resultState : "conflict",
      resultConflict: true,
      resultNote: held && stored.actualHomeGoals != null ? `Stored score ${stored.actualHomeGoals}-${stored.actualAwayGoals} was kept. ${decision.note}` : decision.note,
      resultResolution: "conflict-review",
      changedGoals: false,
    };
  }
  const same = stored.actualHomeGoals === decision.homeGoals && stored.actualAwayGoals === decision.awayGoals;
  const autoVerified = stored.resultState === "verified" || stored.resultResolution === "verified";
  const fixed = stored.manuallyCorrected
    || stored.resultProvenance === "manual"
    || stored.resultProvenance === "operator-confirmed"
    || stored.resultState === "manual";
  if (fixed) {
    const clash = !same;
    return {
      actualHomeGoals: stored.actualHomeGoals,
      actualAwayGoals: stored.actualAwayGoals,
      resultState: stored.resultState === "manual" ? "manual" : stored.resultState === "confirmed" ? "confirmed" : "verified",
      resultConflict: clash,
      resultNote: clash
        ? `Fixed score ${stored.actualHomeGoals}-${stored.actualAwayGoals} was kept. ${decision.note}`
        : (stored.resultNote ?? "Fixed score matches the sources."),
      resultResolution: clash ? "conflict-review" : (stored.resultResolution || "verified"),
      changedGoals: false,
    };
  }
  if (autoVerified) {
    const clash = !same;
    return {
      actualHomeGoals: stored.actualHomeGoals,
      actualAwayGoals: stored.actualAwayGoals,
      resultState: "verified",
      resultConflict: clash,
      resultNote: clash ? `Verified score kept. ${decision.note}` : (stored.resultNote ?? decision.note),
      resultResolution: clash ? "conflict-review" : "verified",
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
