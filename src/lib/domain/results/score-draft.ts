/** Draft comparison for the review score block. No database access. */

import type { RankableObservation } from "./ranking";
import {
  LABEL_OLDER_MANUAL,
  displayedResultLabel,
  sourceAgreement,
} from "./result-label";

export interface ScoreDraftRow {
  id: string;
  name: string;
  storedHome: number | null;
  storedAway: number | null;
  /** The stored score already counts in standings, so a different number needs confirmation. */
  verifiedForStandings: boolean;
  draftFixed: boolean;
  draftHome: number | null;
  draftAway: number | null;
  /** Score the stored sources would use if the lock is removed. */
  automaticHome: number | null;
  automaticAway: number | null;
}

export interface AuthoritativeScoreChange {
  id: string;
  name: string;
  previousHome: number | null;
  previousAway: number | null;
  nextHome: number | null;
  nextAway: number | null;
  needsStandingConfirm: boolean;
}

function sameScore(leftHome: number | null, leftAway: number | null, rightHome: number | null, rightAway: number | null): boolean {
  return leftHome === rightHome && leftAway === rightAway;
}

/** Score-number changes the shared save would make authoritative. A lock with the same number is not included. */
export function authoritativeScoreChanges(rows: readonly ScoreDraftRow[]): AuthoritativeScoreChange[] {
  const changes: AuthoritativeScoreChange[] = [];
  for (const row of rows) {
    const nextHome = row.draftFixed ? row.draftHome : row.automaticHome;
    const nextAway = row.draftFixed ? row.draftAway : row.automaticAway;
    if (sameScore(row.storedHome, row.storedAway, nextHome, nextAway)) {
      continue;
    }
    changes.push({
      id: row.id,
      name: row.name,
      previousHome: row.storedHome,
      previousAway: row.storedAway,
      nextHome,
      nextAway,
      needsStandingConfirm: row.verifiedForStandings,
    });
  }
  return changes;
}

export function formatDraftScore(home: number | null, away: number | null): string {
  if (home == null || away == null) {
    return "none";
  }
  return `${home}-${away}`;
}

/** Label shown while a switch is off and the row is previewing the stored sources. */
export function automaticResultLabel(result: {
  resultProvenance: string;
  resultState: string;
  resultConflict: boolean;
}, fallback: string): string {
  if (result.resultProvenance === "two-source") {
    return result.resultConflict ? "Result conflict. Verified, two sources." : "Verified, two sources";
  }
  if (result.resultState === "confirmed" || result.resultProvenance === "one-source") {
    return result.resultConflict ? "Result conflict. Provisional." : "Provisional";
  }
  if (result.resultConflict) {
    return "Source conflict";
  }
  return fallback;
}

/** Label for a draft that is switched on. An untouched legacy row keeps its stored label. */
export function draftLockLabel(
  home: number | null,
  away: number | null,
  observations: readonly RankableObservation[],
  legacyUnchanged: boolean,
): string {
  if (legacyUnchanged) {
    return LABEL_OLDER_MANUAL;
  }
  const agreement = home == null || away == null ? "other" : sourceAgreement(home, away, observations);
  return displayedResultLabel({
    resultProvenance: "manual",
    manuallyCorrected: true,
    resultConflict: agreement === "other",
    resultState: "verified",
  }, "", agreement);
}
