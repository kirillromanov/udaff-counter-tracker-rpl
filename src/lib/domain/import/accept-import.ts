import { isConflictWarning, isCorrectionWarning } from "./review-status";

export interface ImportRow {
  ignored: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  warning: string | null;
}

export interface ImportSetShape {
  warnings: string[];
  unmatchedLines: number;
  fixtureCount: number;
  predictions: ImportRow[];
}

function scoredCount(set: ImportSetShape): number {
  return set.predictions.filter((row) => !row.ignored && row.homeGoals != null && row.awayGoals != null).length;
}

function rowNeedsReview(warning: string | null): boolean {
  if (!warning) {
    return false;
  }
  return isConflictWarning(warning) || isCorrectionWarning(warning);
}

/**
 * A clean slip covers every fixture with a score and has no parser warning
 * that needs a person to decide. Chatter with no scores is not acceptable
 * and is also not a review row.
 */
export function isAcceptableImport(set: ImportSetShape): boolean {
  if (set.fixtureCount <= 0 || importNeedsReview(set)) {
    return false;
  }
  return scoredCount(set) === set.fixtureCount;
}

/**
 * Incomplete scored slips, malformed lines, swapped clubs, ambiguous fixtures,
 * and duplicate lines stay in review. A comment with no scores does not.
 */
export function importNeedsReview(set: ImportSetShape): boolean {
  if (set.unmatchedLines > 0) {
    return true;
  }
  if (set.warnings.some((warning) => isConflictWarning(warning) || isCorrectionWarning(warning))) {
    return true;
  }
  if (set.predictions.some((row) => rowNeedsReview(row.warning))) {
    return true;
  }
  const scored = scoredCount(set);
  const missingFixture = set.warnings.some((warning) => warning.toLowerCase().startsWith("no prediction for"));
  return scored > 0 && (scored < set.fixtureCount || missingFixture);
}
