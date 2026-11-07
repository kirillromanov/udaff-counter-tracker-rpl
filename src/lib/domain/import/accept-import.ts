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
 * One clean scored fixture is enough. A comment that does not cover the
 * whole round is still acceptable. Chatter with no scores is not.
 */
export function isAcceptableImport(set: ImportSetShape): boolean {
  if (set.fixtureCount <= 0 || importNeedsReview(set)) {
    return false;
  }
  return scoredCount(set) > 0;
}

/**
 * Malformed lines, swapped clubs, ambiguous fixtures, and duplicate lines
 * stay in review. A missing fixture is not a review reason, and a comment
 * with no scores is not a review row.
 */
export function importNeedsReview(set: ImportSetShape): boolean {
  if (set.unmatchedLines > 0) {
    return true;
  }
  if (set.warnings.some((warning) => isConflictWarning(warning) || isCorrectionWarning(warning))) {
    return true;
  }
  return set.predictions.some((row) => rowNeedsReview(row.warning));
}
