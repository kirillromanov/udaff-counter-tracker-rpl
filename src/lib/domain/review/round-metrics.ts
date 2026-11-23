import { EDIT_AFTER_KICKOFF_NOTE, EDIT_TIME_UNKNOWN_NOTE } from "@/lib/domain/import/fixture-deadline";
import { MANUAL_PREDICTION_NOTE } from "@/lib/domain/import/incremental";
import { isConflictWarning, isCorrectionWarning, setTone, toSetToneInput, type ReviewTone } from "@/lib/domain/import/review-status";

export type RoundMetric = "comments" | "sets" | "selected" | "conflicts" | "corrections" | "scored" | "stored";

export const ROUND_METRICS: readonly RoundMetric[] = ["comments", "sets", "selected", "conflicts", "corrections", "scored", "stored"];

export function roundMetricOf(value: string | undefined): RoundMetric | null {
  return ROUND_METRICS.includes(value as RoundMetric) ? (value as RoundMetric) : null;
}

export interface MetricSet {
  id: string;
  status: string;
  selected: boolean;
  warningsJson: string;
  parsedJson: string;
  rawComment: string | null;
  predictions: { warning: string | null; homeGoals: number | null; awayGoals: number | null; ignored: boolean; rawLine?: string | null }[];
  reviewState?: string | null;
  reviewNote?: string | null;
  authorName?: string | null;
  externalId?: string | null;
}

export interface MetricComment {
  id: string;
  externalId: string | null;
  authorName: string;
  ingestionStatus: string;
  reviewState: string;
  reviewNote: string | null;
}

export interface MetricFixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  manuallyCorrected: boolean;
  resultProvenance: string;
  resultNote: string | null;
}

/** The row tone used by both screens. A flagged set or an unresolved-edit note is a correction. */
export function metricTone(set: MetricSet): ReviewTone {
  const reviewed = setTone(toSetToneInput(set));
  if (reviewed === "conflict") {
    return "conflict";
  }
  if (reviewed === "correction" || set.status === "flagged" || unresolvedNote(set.reviewNote) || set.reviewState === "flagged") {
    return "correction";
  }
  return "ok";
}

function unresolvedNote(note: string | null | undefined): boolean {
  return note === EDIT_TIME_UNKNOWN_NOTE || note === EDIT_AFTER_KICKOFF_NOTE || note === MANUAL_PREDICTION_NOTE;
}

export interface RoundCounters {
  comments: number;
  sets: number;
  selected: number;
  stored: number;
  conflicts: number;
  corrections: number;
  scored: number;
  fixtures: number;
}

export function roundCounters(input: {
  comments: readonly unknown[];
  sets: readonly MetricSet[];
  fixtures: readonly Pick<MetricFixture, "actualHomeGoals" | "actualAwayGoals">[];
}): RoundCounters {
  let selected = 0;
  let conflicts = 0;
  let corrections = 0;
  for (const set of input.sets) {
    if (set.selected) {
      selected += 1;
    }
    const tone = metricTone(set);
    if (tone === "conflict") {
      conflicts += 1;
    } else if (tone === "correction") {
      corrections += 1;
    }
  }
  return {
    comments: input.comments.length,
    sets: input.sets.length,
    stored: input.sets.length,
    selected,
    conflicts,
    corrections,
    scored: input.fixtures.filter((fixture) => fixture.actualHomeGoals != null && fixture.actualAwayGoals != null).length,
    fixtures: input.fixtures.length,
  };
}

export function setsForMetric(sets: readonly MetricSet[], metric: RoundMetric | null): MetricSet[] {
  if (metric === "selected") {
    return sets.filter((set) => set.selected);
  }
  if (metric === "conflicts") {
    return sets.filter((set) => metricTone(set) === "conflict");
  }
  if (metric === "corrections") {
    return sets.filter((set) => metricTone(set) === "correction");
  }
  if (metric === "sets" || metric === "stored" || metric == null) {
    return [...sets];
  }
  return [...sets];
}

export interface IssueExplanation {
  title: string;
  reason: string;
  evidence: string;
  decision: string;
  actions: string[];
}

export function explainSetIssue(set: MetricSet): IssueExplanation | null {
  const tone = metricTone(set);
  if (tone === "ok") {
    return null;
  }
  const warnings = toSetToneInput(set).warnings;
  const conflictWarning = warnings.find(isConflictWarning) ?? set.predictions.find((row) => row.warning && isConflictWarning(row.warning))?.warning ?? null;
  const correctionWarning = warnings.find(isCorrectionWarning) ?? set.predictions.find((row) => row.warning && isCorrectionWarning(row.warning))?.warning ?? null;
  const unmatched = set.predictions.filter((row) => !row.ignored && (row.homeGoals == null || row.awayGoals == null)).length;
  if (tone === "conflict") {
    return {
      title: `${set.authorName ?? "Comment"}${set.externalId ? ` ${set.externalId}` : ""}`,
      reason: conflictWarning ? "Parse conflict" : "Selection conflict",
      evidence: conflictWarning ?? "A stored warning marks this slip as a duplicate, an ambiguous fixture, or a second Match of the Round.",
      decision: "Choose which stored line counts. Nothing is cleared automatically.",
      actions: ["Use this set, if this slip should score", "Save one prediction line on this page"],
    };
  }
  const evidence = set.reviewNote
    ?? correctionWarning
    ?? (unmatched > 0 ? `${unmatched} stored prediction line has no score.` : "This slip is flagged and still needs a decision.");
  const reason = unresolvedNote(set.reviewNote)
    ? "Unresolved edit"
    : set.reviewState === "flagged"
      ? "Flagged comment"
      : correctionWarning
        ? "Needs correction"
        : "Missing score or fixture";
  return {
    title: `${set.authorName ?? "Comment"}${set.externalId ? ` ${set.externalId}` : ""}`,
    reason,
    evidence,
    decision: unresolvedNote(set.reviewNote)
      ? "Leave the stored slip in place, or edit one line by hand. The warning is not cleared automatically."
      : "Fill the missing score or attach the line to a fixture. There is no bulk fix.",
    actions: ["Save one prediction line on this page", "Use this set, if this slip should score"],
  };
}

export function explainResultIssue(fixture: MetricFixture): IssueExplanation | null {
  if (fixture.resultConflict) {
    return {
      title: `${fixture.homeTeam} — ${fixture.awayTeam}`,
      reason: "Result-source conflict",
      evidence: fixture.resultNote || "Stored sources do not share one full-time score. Both values stay on the fixture.",
      decision: "Keep the stored score, or enter the full-time score in one confirmed action.",
      actions: ["Verify or correct the score on the fixtures page", "Return a manual score to the stored sources"],
    };
  }
  if (fixture.manuallyCorrected) {
    return {
      title: `${fixture.homeTeam} — ${fixture.awayTeam}`,
      reason: "Manual correction in effect",
      evidence: `Stored score ${fixture.actualHomeGoals}-${fixture.actualAwayGoals}. Sources are kept and do not replace this score.`,
      decision: "Leave the manual score, or remove the marker so the stored sources decide again.",
      actions: ["Remove the manual marker on the fixtures page"],
    };
  }
  return null;
}

export interface ConsistencyReport {
  consistent: boolean;
  blocking: string[];
  notes: string[];
}

export function roundConsistency(input: {
  counters: RoundCounters;
  fixtures: readonly MetricFixture[];
  selectedCoversFixture: (fixtureId: string) => boolean;
}): ConsistencyReport {
  const blocking: string[] = [];
  const notes: string[] = [];
  if (input.counters.conflicts > 0) {
    blocking.push(`${input.counters.conflicts} parse ${input.counters.conflicts === 1 ? "conflict is" : "conflicts are"} unresolved.`);
  }
  if (input.counters.corrections > 0) {
    blocking.push(`${input.counters.corrections} ${input.counters.corrections === 1 ? "slip needs" : "slips need"} correction.`);
  }
  if (input.counters.selected > input.counters.stored) {
    blocking.push("Selected sets outnumber stored sets.");
  }
  const resultConflicts = input.fixtures.filter((fixture) => fixture.resultConflict);
  if (resultConflicts.length > 0) {
    blocking.push(`${resultConflicts.length} ${resultConflicts.length === 1 ? "fixture has" : "fixtures have"} a result conflict.`);
  }
  const scoredWithoutSelection = input.fixtures.filter(
    (fixture) => fixture.actualHomeGoals != null && fixture.actualAwayGoals != null && !input.selectedCoversFixture(fixture.id),
  );
  if (scoredWithoutSelection.length > 0) {
    blocking.push(`${scoredWithoutSelection.length} scored ${scoredWithoutSelection.length === 1 ? "fixture has" : "fixtures have"} no prediction on a selected set.`);
  }
  const unverified = input.fixtures.filter((fixture) => {
    const scored = fixture.actualHomeGoals != null && fixture.actualAwayGoals != null;
    const verified = !fixture.resultConflict && (fixture.resultState === "verified" || fixture.resultState === "manual" || fixture.resultResolution === "verified" || fixture.resultResolution === "manual");
    return scored && !verified;
  });
  if (unverified.length > 0) {
    blocking.push(`${unverified.length} scored ${unverified.length === 1 ? "fixture is" : "fixtures are"} not verified.`);
  }
  const missing = input.counters.fixtures - input.counters.scored;
  if (missing > 0) {
    notes.push(`${missing} ${missing === 1 ? "fixture has" : "fixtures have"} no full-time score yet.`);
  }
  const manual = input.fixtures.filter((fixture) => fixture.manuallyCorrected || fixture.resultState === "manual");
  if (manual.length > 0) {
    notes.push(`${manual.length} ${manual.length === 1 ? "fixture uses" : "fixtures use"} a manual score.`);
  }
  return { consistent: blocking.length === 0, blocking, notes };
}
