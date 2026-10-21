import { participantKey } from "@/lib/domain/import/participant-key";
import { isConflictWarning, isCorrectionWarning } from "@/lib/domain/import/review-status";
import {
  compareCheckpointToComputed,
  movementDeltaOf,
  type ComputedStandingRow,
  type MatchedCheckpointRow,
} from "./parse-checkpoint";

export type ReconciliationCause =
  | "parser_extraction"
  | "participant_matching"
  | "scoring_logic"
  | "missing_round_data"
  | "source_content";

export type ReconciliationDecisionAction = "accept_computed" | "keep_manual" | "alias" | "manual_correction";

export interface ReconciliationRoundInput {
  number: number;
  name: string | null;
  forumUrl: string | null;
  openingText: string | null;
  importNotes: string | null;
  fixtureCount: number;
  scoredFixtureCount: number;
  acceptedParticipantIds: string[];
  flagged: FlaggedSlip[];
  unknownAuthors: UnknownAuthor[];
}

export interface FlaggedSlip {
  participantId: string;
  participantName: string;
  selected: boolean;
  warnings: string[];
}

export interface UnknownAuthor {
  name: string;
  commentCount: number;
}

export interface ReconciliationCheckpointRow {
  participantId: string | null;
  displayName: string;
  rank: number;
  totalPoints: number;
  movement: string;
  movementDelta: number;
  previousRank: number | null;
  markerCount: number;
}

export interface RegistryPerson {
  participantId: string;
  name: string;
}

export interface StoredAlias {
  participantId: string;
  participantName: string;
  alias: string;
  primary: boolean;
}

export interface StoredDecision {
  subjectName: string;
  action: ReconciliationDecisionAction;
  note: string | null;
  participantId: string | null;
}

export interface ReconciliationRequest {
  afterRoundNumber: number;
  checkpoint: ReconciliationCheckpointRow[];
  /** Snapshot exactly after `afterRoundNumber`. Null when that round was not calculated. */
  computed: ComputedStandingRow[] | null;
  /** Latest round that already has a calculated snapshot, if any. */
  latestScoredRound: number | null;
  rounds: ReconciliationRoundInput[];
  registry: RegistryPerson[];
  aliases: StoredAlias[];
  decisions: StoredDecision[];
}

export interface ComparisonRow {
  participantId: string | null;
  displayName: string;
  status: "exact" | "missing" | "unmatched_name" | "mismatch";
  fields: string[];
  cause: ReconciliationCause | null;
  causeDetail: string;
  checkpoint: {
    rank: number;
    totalPoints: number;
    movement: string;
    movementDelta: number;
    markerCount: number;
  };
  computed: {
    rank: number;
    totalPoints: number;
    movement: string;
    movementDelta: number;
    roundWins: number;
  } | null;
  acceptedRounds: number[];
  missingRounds: number[];
  decision: StoredDecision | null;
}

export interface ParserCase {
  roundNumber: number;
  participantId: string;
  participantName: string;
  selected: boolean;
  kind: "ambiguity" | "extraction";
  warnings: string[];
}

export interface AliasIssue {
  name: string;
  commentCount: number;
  cause: "participant_matching";
  detail: string;
  suspects: RegistryPerson[];
}

export interface SourceIssue {
  roundNumbers: number[];
  cause: "source_content";
  detail: string;
}

export interface ReconciliationReport {
  afterRoundNumber: number;
  computedAvailable: boolean;
  trustworthy: boolean;
  summary: string;
  highlights: string[];
  exactMatches: ComparisonRow[];
  missingParticipants: ComparisonRow[];
  extraComputedIds: string[];
  pointMismatches: ComparisonRow[];
  rankMismatches: ComparisonRow[];
  movementMismatches: ComparisonRow[];
  markerMismatches: ComparisonRow[];
  rows: ComparisonRow[];
  parserAmbiguities: ParserCase[];
  parserExtractions: ParserCase[];
  aliasIssues: AliasIssue[];
  linkedAliases: StoredAlias[];
  sourceIssues: SourceIssue[];
  rounds: ReconciliationRoundInput[];
  roundsMissingActuals: number[];
}

export function normalizeSourceText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * Refuses to calculate when any round through the checkpoint is incomplete.
 * A partial table would look like a season result.
 */
export function computedRebuildBlocker(
  rounds: { number: number; fixtureCount: number; scoredFixtureCount: number; selectedCount: number }[],
): string | null {
  if (rounds.length === 0) {
    return "No rounds are available to calculate. The manual baseline was left unchanged.";
  }
  const problems: string[] = [];
  for (const round of [...rounds].sort((left, right) => left.number - right.number)) {
    if (round.fixtureCount === 0) {
      problems.push(`round ${round.number} has no fixtures`);
    } else if (round.scoredFixtureCount < round.fixtureCount) {
      const missing = round.fixtureCount - round.scoredFixtureCount;
      problems.push(`round ${round.number} is missing actual scores on ${missing} ${missing === 1 ? "fixture" : "fixtures"}`);
    }
    if (round.selectedCount === 0) {
      problems.push(`round ${round.number} has no selected prediction set`);
    }
  }
  if (problems.length === 0) {
    return null;
  }
  const sentence = problems.map((problem) => problem.charAt(0).toUpperCase() + problem.slice(1)).join(". ");
  return `Computed standings were not written, and the manual baseline was left unchanged. ${sentence}.`;
}

function decisionFor(decisions: StoredDecision[], subjectName: string): StoredDecision | null {
  return decisions.find((decision) => decision.subjectName === subjectName) ?? null;
}

function acceptedRoundsFor(rounds: ReconciliationRoundInput[], participantId: string, through: number): number[] {
  return rounds
    .filter((round) => round.number <= through && round.acceptedParticipantIds.includes(participantId))
    .map((round) => round.number);
}

function flaggedRoundsFor(rounds: ReconciliationRoundInput[], participantId: string, through: number): number[] {
  return rounds
    .filter(
      (round) =>
        round.number <= through && round.flagged.some((slip) => slip.participantId === participantId),
    )
    .map((round) => round.number);
}

function coverageCause(accepted: number[], flagged: number[], missing: number[]): {
  cause: ReconciliationCause;
  detail: string;
} {
  if (missing.length === 0) {
    return {
      cause: "scoring_logic",
      detail: "Accepted slips cover every round, and the calculated table still disagrees with the checkpoint.",
    };
  }
  const flaggedGaps = missing.filter((number) => flagged.includes(number));
  if (flaggedGaps.length === missing.length) {
    return {
      cause: "parser_extraction",
      detail: `No accepted slip in ${listRounds(missing)}. Those rounds only have a flagged parse.`,
    };
  }
  if (accepted.length === 0 && flagged.length === 0) {
    return {
      cause: "missing_round_data",
      detail: "No prediction from this participant was accepted.",
    };
  }
  return {
    cause: "missing_round_data",
    detail: `No accepted slip in ${listRounds(missing)}.`,
  };
}

function listRounds(numbers: number[]): string {
  return numbers.map((number) => `round ${number}`).join(", ");
}

function classifyComputedGap(
  computedAvailable: boolean,
  roundsMissingActuals: number[],
  accepted: number[],
  flagged: number[],
  missing: number[],
): { cause: ReconciliationCause; detail: string } {
  if (!computedAvailable) {
    const coverage =
      accepted.length === 0
        ? "No accepted slip is stored for this participant."
        : `Accepted slips exist for ${accepted.length} ${accepted.length === 1 ? "round" : "rounds"}.`;
    const blocker =
      roundsMissingActuals.length === 0
        ? "Actual scores are stored, but standings after this checkpoint have not been calculated."
        : `Actual scores are missing for ${listRounds(roundsMissingActuals)}.`;
    return {
      cause: "missing_round_data",
      detail: `Calculated standings after this checkpoint do not exist. ${blocker} ${coverage} The manual baseline was left unchanged.`,
    };
  }
  return coverageCause(accepted, flagged, missing);
}

function parserKind(warnings: string[]): "ambiguity" | "extraction" | null {
  if (warnings.some((warning) => isConflictWarning(warning))) {
    return "ambiguity";
  }
  if (
    warnings.some(
      (warning) => isCorrectionWarning(warning) || warning.toLowerCase().startsWith("no prediction for"),
    )
  ) {
    return "extraction";
  }
  if (warnings.length > 0) {
    return "extraction";
  }
  return null;
}

function sourceIssuesOf(rounds: ReconciliationRoundInput[]): SourceIssue[] {
  const issues: SourceIssue[] = [];
  const seen = new Map<string, number>();
  for (const round of [...rounds].sort((left, right) => left.number - right.number)) {
    const key = normalizeSourceText(round.openingText);
    if (!key) {
      continue;
    }
    const previous = seen.get(key);
    if (previous != null) {
      issues.push({
        roundNumbers: [previous, round.number],
        cause: "source_content",
        detail: `Opening post text matches round ${previous}. The threads were compared by fetched text, not by URL.`,
      });
    } else {
      seen.set(key, round.number);
    }
    const note = round.importNotes?.trim();
    if (note) {
      issues.push({
        roundNumbers: [round.number],
        cause: "source_content",
        detail: note,
      });
    }
  }
  return issues;
}

function aliasIssuesOf(
  rounds: ReconciliationRoundInput[],
  registry: RegistryPerson[],
  aliases: StoredAlias[],
): AliasIssue[] {
  const aliasKeys = new Set(aliases.map((alias) => participantKey(alias.alias)));
  const totals = new Map<string, { name: string; commentCount: number }>();
  for (const round of rounds) {
    for (const author of round.unknownAuthors) {
      const key = participantKey(author.name);
      if (!key || aliasKeys.has(key)) {
        continue;
      }
      const current = totals.get(key);
      if (current) {
        current.commentCount += author.commentCount;
      } else {
        totals.set(key, { name: author.name, commentCount: author.commentCount });
      }
    }
  }
  return [...totals.values()]
    .sort((left, right) => right.commentCount - left.commentCount || left.name.localeCompare(right.name, "ru"))
    .map(({ name, commentCount }) => {
      const key = participantKey(name);
      const suspects =
        key.length < 3
          ? []
          : registry.filter((person) => participantKey(person.name).startsWith(`${key} `));
      const detail =
        suspects.length === 1
          ? `Not in the registry. The name is a shorter form of ${suspects[0]?.name ?? "a roster name"}, and it was not linked.`
          : suspects.length > 1
            ? `Not in the registry. Several roster names start with this name, so it was not linked.`
            : "Not in the registry, and no roster name starts with it. No participant was created.";
      return { name, commentCount, cause: "participant_matching" as const, detail, suspects };
    });
}

function rowCause(
  status: ComparisonRow["status"],
  fields: string[],
  computedAvailable: boolean,
  roundsMissingActuals: number[],
  accepted: number[],
  flagged: number[],
  missing: number[],
): { cause: ReconciliationCause | null; detail: string } {
  if (status === "exact") {
    return {
      cause: null,
      detail:
        accepted.length === 0
          ? "Rank, points, movement, and round wins match."
          : `Rank, points, movement, and round wins match. Accepted slips cover ${listRounds(accepted)}.`,
    };
  }
  if (status === "unmatched_name") {
    return {
      cause: "participant_matching",
      detail: "This checkpoint name is not in the registry, so it was not paired with a calculated row.",
    };
  }
  if (status === "missing" || fields.includes("missing from calculated standings")) {
    return classifyComputedGap(computedAvailable, roundsMissingActuals, accepted, flagged, missing);
  }
  const coverage = coverageCause(accepted, flagged, missing);
  if (fields.some((field) => field.startsWith("points "))) {
    return coverage;
  }
  if (fields.some((field) => field.startsWith("movement ") || field.startsWith("markers "))) {
    return coverage.cause === "scoring_logic"
      ? {
          cause: "scoring_logic",
          detail: "Points match, but movement or round wins do not. That comes from the calculated round history.",
        }
      : coverage;
  }
  return coverage.cause === "scoring_logic"
    ? {
        cause: "scoring_logic",
        detail: "Points match, but the rank does not. Check round wins and the name tie-break.",
      }
    : coverage;
}

export function buildReconciliationReport(input: ReconciliationRequest): ReconciliationReport {
  const through = input.rounds.filter((round) => round.number <= input.afterRoundNumber);
  const roundsMissingActuals = through
    .filter((round) => round.fixtureCount === 0 || round.scoredFixtureCount < round.fixtureCount)
    .map((round) => round.number);
  const computed = input.computed ?? [];
  const computedAvailable = input.computed != null && computed.length > 0 && roundsMissingActuals.length === 0;
  const matched: MatchedCheckpointRow[] = input.checkpoint.map((row) => ({
    rank: row.rank,
    movement: row.movement === "up" || row.movement === "down" || row.movement === "same" ? row.movement : "same",
    movementDelta: row.movementDelta,
    previousRank: row.previousRank ?? row.rank,
    displayName: row.displayName,
    totalPoints: row.totalPoints,
    markerCount: row.markerCount,
    rawLine: "",
    participantId: row.participantId,
  }));
  const comparison = compareCheckpointToComputed(matched, computedAvailable ? computed : []);
  const differenceById = new Map(comparison.differences.map((difference) => [difference.participantId, difference.fields]));
  const computedById = new Map(computed.map((row) => [row.participantId, row]));

  const rows: ComparisonRow[] = input.checkpoint.map((row) => {
    const accepted = row.participantId ? acceptedRoundsFor(through, row.participantId, input.afterRoundNumber) : [];
    const flagged = row.participantId ? flaggedRoundsFor(through, row.participantId, input.afterRoundNumber) : [];
    const expected = through.map((round) => round.number);
    const missing = expected.filter((number) => !accepted.includes(number));
    const fields = row.participantId ? (differenceById.get(row.participantId) ?? []) : [];
    const unmatched = !row.participantId || comparison.unmatchedNames.includes(row.displayName);
    const actual = row.participantId && computedAvailable ? (computedById.get(row.participantId) ?? null) : null;
    const status: ComparisonRow["status"] = unmatched
      ? "unmatched_name"
      : !computedAvailable || !actual
        ? "missing"
        : fields.length === 0
          ? "exact"
          : "mismatch";
    const classified = rowCause(status, fields, computedAvailable, roundsMissingActuals, accepted, flagged, missing);
    return {
      participantId: row.participantId,
      displayName: row.displayName,
      status,
      fields: status === "missing" ? ["missing from calculated standings"] : status === "unmatched_name" ? [] : fields,
      cause: classified.cause,
      causeDetail: classified.detail,
      checkpoint: {
        rank: row.rank,
        totalPoints: row.totalPoints,
        movement: row.movement,
        movementDelta: row.movementDelta,
        markerCount: row.markerCount,
      },
      computed: actual
        ? {
            rank: actual.rank,
            totalPoints: actual.totalPoints,
            movement: actual.movement,
            movementDelta: movementDeltaOf(actual.movement, actual.rank, actual.previousRank),
            roundWins: actual.roundWins,
          }
        : null,
      acceptedRounds: accepted,
      missingRounds: missing,
      decision: decisionFor(input.decisions, row.displayName),
    };
  });

  const parserAmbiguities: ParserCase[] = [];
  const parserExtractions: ParserCase[] = [];
  for (const round of through) {
    for (const slip of round.flagged) {
      const kind = parserKind(slip.warnings);
      if (!kind) {
        continue;
      }
      const parserCase: ParserCase = {
        roundNumber: round.number,
        participantId: slip.participantId,
        participantName: slip.participantName,
        selected: slip.selected,
        kind,
        warnings: slip.warnings,
      };
      if (kind === "ambiguity") {
        parserAmbiguities.push(parserCase);
      } else {
        parserExtractions.push(parserCase);
      }
    }
  }

  const aliasIssues = aliasIssuesOf(through, input.registry, input.aliases);
  const sourceIssues = sourceIssuesOf(through);
  const exactMatches = rows.filter((row) => row.status === "exact");
  const missingParticipants = rows.filter((row) => row.status === "missing" || row.status === "unmatched_name");
  const mismatches = rows.filter((row) => row.status === "mismatch");
  const pointMismatches = mismatches.filter((row) => row.fields.some((field) => field.startsWith("points ")));
  const rankMismatches = mismatches.filter((row) => row.fields.some((field) => field.startsWith("rank ")));
  const movementMismatches = mismatches.filter((row) => row.fields.some((field) => field.startsWith("movement ")));
  const markerMismatches = mismatches.filter((row) => row.fields.some((field) => field.startsWith("markers ")));
  const seenCheckpoint = new Set(rows.map((row) => row.participantId).filter((id): id is string => Boolean(id)));
  const extraComputedIds = computedAvailable
    ? computed.map((row) => row.participantId).filter((id) => !seenCheckpoint.has(id))
    : [];

  const selectedFlagged = parserAmbiguities.some((item) => item.selected) || parserExtractions.some((item) => item.selected);
  const trustworthy =
    computedAvailable &&
    rows.length > 0 &&
    exactMatches.length === rows.length &&
    extraComputedIds.length === 0 &&
    !selectedFlagged &&
    sourceIssues.length === 0;

  const summary = summarize({
    afterRoundNumber: input.afterRoundNumber,
    computedAvailable,
    latestScoredRound: input.latestScoredRound,
    roundsMissingActuals,
    trustworthy,
    exactCount: exactMatches.length,
    rowCount: rows.length,
    pointCount: pointMismatches.length,
    ambiguityCount: parserAmbiguities.length,
    aliasCount: aliasIssues.length,
  });

  return {
    afterRoundNumber: input.afterRoundNumber,
    computedAvailable,
    trustworthy,
    summary,
    highlights: highlights({
      afterRoundNumber: input.afterRoundNumber,
      through,
      roundsMissingActuals,
      rows,
      parserAmbiguities,
      parserExtractions,
      aliasIssues,
      sourceIssues,
      pointMismatches,
      extraComputedIds,
      computedAvailable,
    }),
    exactMatches,
    missingParticipants,
    extraComputedIds,
    pointMismatches,
    rankMismatches,
    movementMismatches,
    markerMismatches,
    rows,
    parserAmbiguities,
    parserExtractions,
    aliasIssues,
    linkedAliases: input.aliases.filter((alias) => !alias.primary),
    sourceIssues,
    rounds: through,
    roundsMissingActuals,
  };
}

function summarize(input: {
  afterRoundNumber: number;
  computedAvailable: boolean;
  latestScoredRound: number | null;
  roundsMissingActuals: number[];
  trustworthy: boolean;
  exactCount: number;
  rowCount: number;
  pointCount: number;
  ambiguityCount: number;
  aliasCount: number;
}): string {
  if (!input.computedAvailable) {
    const scored =
      input.latestScoredRound == null
        ? "No round has been calculated."
        : `The latest calculation stops at round ${input.latestScoredRound}.`;
    return `The scoring algorithm has not been checked against the manual table after round ${input.afterRoundNumber}. ${scored} Actual scores are still missing for ${listRounds(input.roundsMissingActuals)}.`;
  }
  if (input.trustworthy) {
    return `All ${input.rowCount} checkpoint rows match the calculated table after round ${input.afterRoundNumber}.`;
  }
  if (input.exactCount === input.rowCount) {
    return `All ${input.rowCount} checkpoint rows match the calculated table after round ${input.afterRoundNumber}, but import review is still open, so the result is not treated as verified.`;
  }
  return `${input.exactCount} of ${input.rowCount} checkpoint rows match. ${input.pointCount} differ on points, ${input.ambiguityCount} slips are ambiguous, and ${input.aliasCount} author names are still unmatched.`;
}

function highlights(input: {
  afterRoundNumber: number;
  through: ReconciliationRoundInput[];
  roundsMissingActuals: number[];
  rows: ComparisonRow[];
  parserAmbiguities: ParserCase[];
  parserExtractions: ParserCase[];
  aliasIssues: AliasIssue[];
  sourceIssues: SourceIssue[];
  pointMismatches: ComparisonRow[];
  extraComputedIds: string[];
  computedAvailable: boolean;
}): string[] {
  const lines: string[] = [];
  if (input.roundsMissingActuals.length > 0) {
    const fixtures = input.through
      .filter((round) => input.roundsMissingActuals.includes(round.number))
      .reduce((total, round) => total + Math.max(0, round.fixtureCount - round.scoredFixtureCount), 0);
    lines.push(
      `${fixtures} fixtures in ${listRounds(input.roundsMissingActuals)} have no actual score, so standings after round ${input.afterRoundNumber} were not calculated.`,
    );
  }
  const uncovered = input.rows.filter((row) => row.participantId && row.acceptedRounds.length === 0);
  if (uncovered.length > 0) {
    lines.push(
      `${uncovered.length} checkpoint ${uncovered.length === 1 ? "participant has" : "participants have"} no accepted slip: ${uncovered
        .map((row) => row.displayName)
        .join(", ")}.`,
    );
  }
  if (input.pointMismatches.length > 0) {
    lines.push(
      `Point mismatches: ${input.pointMismatches
        .map((row) => `${row.displayName} (${row.fields.find((field) => field.startsWith("points ")) ?? "points"})`)
        .join("; ")}.`,
    );
  }
  if (input.parserAmbiguities.length > 0) {
    lines.push(`${input.parserAmbiguities.length} slips have duplicate or ambiguous lines and stayed in review.`);
  }
  if (input.parserExtractions.length > 0) {
    lines.push(`${input.parserExtractions.length} slips have incomplete, swapped, or malformed lines and stayed in review.`);
  }
  if (input.aliasIssues.length > 0) {
    lines.push(
      `Unmatched authors: ${input.aliasIssues.map((issue) => `${issue.name} (${issue.commentCount})`).join(", ")}.`,
    );
  }
  if (input.extraComputedIds.length > 0) {
    lines.push(`${input.extraComputedIds.length} calculated participants are absent from the manual baseline.`);
  }
  const duplicated = input.sourceIssues.filter((issue) => issue.detail.startsWith("Opening post text matches"));
  if (duplicated.length > 0) {
    lines.push(duplicated.map((issue) => issue.detail).join(" "));
  } else if (!input.computedAvailable) {
    lines.push("Rounds 6 and 7 were not treated as a URL conflict. An issue is raised only when the fetched opening posts are the same text.");
  }
  for (const issue of input.sourceIssues) {
    if (issue.detail.startsWith("Opening post text matches")) {
      continue;
    }
    lines.push(`Round ${issue.roundNumbers.join(", ")}: ${issue.detail}`);
  }
  return lines;
}
