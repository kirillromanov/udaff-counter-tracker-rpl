import path from "node:path";
import { isAcceptableImport, type ImportSetShape } from "@/lib/domain/import/accept-import";
import { resolveSelections, type SelectableSet } from "@/lib/domain/import/select-sets";
import { parseComment, rowsForStorage } from "@/lib/domain/parser/parse-comment";
import { resolveAuthor, type IdentityCatalog } from "@/lib/domain/participants/resolve-author";
import { defaultScoringConfig, type ScoringConfig } from "@/lib/config/scoring";
import { scoreRound } from "@/lib/domain/scoring/score-round";
import type { FixtureRef } from "@/lib/domain/parser/types";

export const DIAGNOSTIC_ELIGIBILITY_NOTE =
  "No contest deadline is implemented. Every parsed slip is treated as eligible regardless of kickoff. Comment timestamps are stored as UTC.";

export interface DiagnosticFixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  isMatchOfTheRound: boolean;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultConflict: boolean;
  provenance: string | null;
}

export interface DiagnosticComment {
  id: string;
  authorName: string;
  postedAt: Date | null;
  rawText: string;
}

export interface DiagnosticRoundInput {
  number: number;
  sourceUrl: string | null;
  fetchStatus: "fetched" | "failed" | "missing-url";
  fetchError: string | null;
  pagesFetched: number;
  pageErrors: string[];
  comments: DiagnosticComment[];
  fixtures: DiagnosticFixture[];
  scheduleFixtures: FixtureRef[];
}

export interface DiagnosticBaselineRow {
  participantId: string;
  name: string;
  rank: number;
  totalPoints: number;
}

export interface DiagnosticParticipantTotal {
  participantId: string;
  name: string;
  computedPoints: number;
  baselinePoints: number | null;
  baselineRank: number | null;
  delta: number | null;
  scoredRounds: number[];
}

export interface DiagnosticRoundReport {
  number: number;
  sourceUrl: string | null;
  fetchStatus: DiagnosticRoundInput["fetchStatus"];
  fetchError: string | null;
  pagesFetched: number;
  pageErrors: string[];
  commentsFetched: number;
  predictionLinesRecognized: number;
  acceptableSlips: number;
  reviewSlips: number;
  ignoredAuthors: { name: string; comments: number }[];
  unresolvedAuthors: { name: string; kind: string; comments: number }[];
  unmatchedFixtures: string[];
  parsingErrors: { warning: string; rawLine: string }[];
  scored: boolean;
  scoreBlocker: string | null;
  missingOrDisputedResults: { fixture: string; reason: string; provenance: string | null }[];
}

export interface DiagnosticReport {
  eligibility: string;
  comparison: "complete" | "partial";
  rounds: DiagnosticRoundReport[];
  participants: DiagnosticParticipantTotal[];
}

function usableActual(fixture: DiagnosticFixture): { ok: true } | { ok: false; reason: string } {
  if (fixture.resultConflict) {
    return { ok: false, reason: "disputed result" };
  }
  if (fixture.actualHomeGoals == null || fixture.actualAwayGoals == null) {
    return { ok: false, reason: "missing actual result" };
  }
  if (fixture.resultState !== "verified" && fixture.resultState !== "manual" && fixture.resultState !== "confirmed") {
    return { ok: false, reason: `result is ${fixture.resultState || "unverified"}` };
  }
  return { ok: true };
}

function fixtureRefs(round: DiagnosticRoundInput): FixtureRef[] {
  if (round.fixtures.length > 0) {
    return round.fixtures.map((fixture) => ({
      id: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
    }));
  }
  return round.scheduleFixtures;
}

function importShape(fixtureCount: number, warnings: string[], unmatchedLines: number, predictions: ImportSetShape["predictions"]): ImportSetShape {
  return { fixtureCount, warnings, unmatchedLines, predictions };
}

/**
 * Score fetched comments with the production parser and scoring engine.
 * Baseline points are reported beside the computed total and are never used as a score.
 * This function does not read or write a database.
 */
export function buildDiagnosticReport(input: {
  catalog: IdentityCatalog;
  baseline: readonly DiagnosticBaselineRow[];
  rounds: readonly DiagnosticRoundInput[];
  config?: ScoringConfig;
}): DiagnosticReport {
  const config = input.config ?? defaultScoringConfig;
  const computed = new Map<string, { name: string; points: number; rounds: number[] }>();
  const rounds: DiagnosticRoundReport[] = [];

  for (const round of input.rounds) {
    const ignored = new Map<string, number>();
    const unresolved = new Map<string, { kind: string; comments: number }>();
    const unmatched = new Set<string>();
    const parsingErrors: { warning: string; rawLine: string }[] = [];
    let recognized = 0;
    const sets: (SelectableSet & { points: number | null })[] = [];
    const refs = fixtureRefs(round);
    const resultIssues = round.fixtures.flatMap((fixture) => {
      const actual = usableActual(fixture);
      if (actual.ok) {
        return [];
      }
      return [{
        fixture: `${fixture.homeTeam} - ${fixture.awayTeam}`,
        reason: actual.reason,
        provenance: fixture.provenance,
      }];
    });
    const scored = round.fetchStatus === "fetched" && round.fixtures.length > 0 && resultIssues.length === 0;
    const scoreBlocker = round.fetchStatus !== "fetched"
      ? round.fetchError ?? "Source was not fetched"
      : round.fixtures.length === 0
        ? "No stored fixtures with recorded results"
        : resultIssues.length > 0
          ? "One or more actual results are missing or disputed"
          : null;

    for (const comment of round.comments) {
      const author = resolveAuthor(comment.authorName, input.catalog);
      if (author.kind === "ignored") {
        ignored.set(comment.authorName, (ignored.get(comment.authorName) ?? 0) + 1);
        continue;
      }
      if (author.kind === "unknown" || author.kind === "uncertain" || !author.participantId) {
        const current = unresolved.get(comment.authorName);
        unresolved.set(comment.authorName, {
          kind: author.kind,
          comments: (current?.comments ?? 0) + 1,
        });
        continue;
      }
      const parsed = parseComment(comment.rawText, refs);
      for (const line of parsed.lines) {
        if (line.fixtureId && line.homeGoals != null && line.awayGoals != null) {
          recognized += 1;
        }
        for (const warning of line.warnings) {
          if (parsingErrors.length < 8) {
            parsingErrors.push({ warning, rawLine: line.rawLine });
          }
          if (warning.startsWith("Could not match fixture")) {
            unmatched.add(warning);
          }
        }
      }
      const stored = rowsForStorage(parsed);
      const shape = importShape(
        refs.length,
        parsed.warnings,
        parsed.lines.filter((line) => !line.fixtureId).length,
        stored.map((line) => ({
          ignored: false,
          homeGoals: line.homeGoals,
          awayGoals: line.awayGoals,
          warning: line.warnings[0] ?? null,
        })),
      );
      const valid = isAcceptableImport(shape);
      let points: number | null = null;
      if (valid && scored) {
        const byFixture = new Map(stored.map((line) => [line.fixtureId, line]));
        points = scoreRound(
          {
            roundId: `diagnostic-${round.number}`,
            participantId: author.participantId,
            matches: round.fixtures.map((fixture) => {
              const line = byFixture.get(fixture.id);
              return {
                matchId: fixture.id,
                actual: { home: fixture.actualHomeGoals ?? 0, away: fixture.actualAwayGoals ?? 0 },
                predicted: line && line.homeGoals != null && line.awayGoals != null
                  ? { home: line.homeGoals, away: line.awayGoals }
                  : null,
                isMatchOfTheRound: fixture.isMatchOfTheRound,
              };
            }),
          },
          config,
        ).roundTotal;
      }
      sets.push({
        id: comment.id,
        participantId: author.participantId,
        postedAt: comment.postedAt,
        valid,
        selection: "auto",
        selected: false,
        points,
      });
    }

    if (scored) {
      const chosen = new Set(resolveSelections(sets));
      for (const set of sets) {
        if (!chosen.has(set.id) || set.points == null) {
          continue;
        }
        const name = input.catalog.participants.find((person) => person.id === set.participantId)?.name ?? set.participantId;
        const current = computed.get(set.participantId) ?? { name, points: 0, rounds: [] };
        current.points += set.points;
        current.rounds.push(round.number);
        computed.set(set.participantId, current);
      }
    }

    rounds.push({
      number: round.number,
      sourceUrl: round.sourceUrl,
      fetchStatus: round.fetchStatus,
      fetchError: round.fetchError,
      pagesFetched: round.pagesFetched,
      pageErrors: round.pageErrors,
      commentsFetched: round.comments.length,
      predictionLinesRecognized: recognized,
      acceptableSlips: sets.filter((set) => set.valid).length,
      reviewSlips: sets.filter((set) => !set.valid).length,
      ignoredAuthors: [...ignored.entries()].map(([name, comments]) => ({ name, comments })),
      unresolvedAuthors: [...unresolved.entries()].map(([name, value]) => ({ name, kind: value.kind, comments: value.comments })),
      unmatchedFixtures: [...unmatched],
      parsingErrors,
      scored,
      scoreBlocker,
      missingOrDisputedResults: resultIssues,
    });
  }

  const seen = new Set<string>();
  const participants: DiagnosticParticipantTotal[] = [];
  for (const row of [...input.baseline].sort((left, right) => left.rank - right.rank)) {
    seen.add(row.participantId);
    const score = computed.get(row.participantId);
    const computedPoints = score?.points ?? 0;
    participants.push({
      participantId: row.participantId,
      name: row.name,
      computedPoints,
      baselinePoints: row.totalPoints,
      baselineRank: row.rank,
      delta: computedPoints - row.totalPoints,
      scoredRounds: score?.rounds ?? [],
    });
  }
  for (const [participantId, score] of computed) {
    if (seen.has(participantId)) {
      continue;
    }
    participants.push({
      participantId,
      name: score.name,
      computedPoints: score.points,
      baselinePoints: null,
      baselineRank: null,
      delta: null,
      scoredRounds: score.rounds,
    });
  }

  const comparison = rounds.every((round) => round.fetchStatus === "fetched" && round.pageErrors.length === 0 && round.scored)
    ? "complete"
    : "partial";

  return {
    eligibility: DIAGNOSTIC_ELIGIBILITY_NOTE,
    comparison,
    rounds,
    participants,
  };
}

/** Open the production SQLite file without permission to write it. */
export function readonlyDatabaseUrl(databaseUrl: string, schemaDirectory: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Diagnostic replay only supports a SQLite file database.");
  }
  const raw = databaseUrl.slice("file:".length).split("?")[0];
  if (!raw || raw === ":memory:") {
    throw new Error("Diagnostic replay needs the production database file.");
  }
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(schemaDirectory, raw.replace(/^\.\//, ""));
  return `file:${absolute}?mode=readonly`;
}
