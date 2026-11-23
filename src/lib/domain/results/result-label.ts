import { rankFixtureResult, type RankableObservation } from "./ranking";

export const LABEL_MANUAL_NOT_VERIFIED = "manual corrected, not source verified";
export const LABEL_VERIFIED_FIXED = "verified, fixed manually";
export const LABEL_FIXED_ONE_SOURCE = "fixed manually. Only one source agrees.";
export const LABEL_OLDER_MANUAL = "older manual score";
export const LABEL_FIXED = "fixed manually";

export type SourceAgreement = "verified" | "provisional" | "other";

export function scoreIsFixed(match: {
  manuallyCorrected: boolean;
  resultProvenance: string;
  resultState?: string;
}): boolean {
  const state = match.resultState ?? "";
  return match.manuallyCorrected
    || match.resultProvenance === "manual"
    || match.resultProvenance === "operator-confirmed"
    || (state === "manual" && match.resultProvenance === "");
}

export function isLegacyManualScore(match: {
  manuallyCorrected: boolean;
  resultProvenance: string;
  resultState?: string;
}): boolean {
  return (match.resultState ?? "") === "manual" && match.resultProvenance === "" && !match.manuallyCorrected;
}

/** How the stored source rows relate to the score on screen. Stale or unfinished rows do not confirm it. */
export function sourceAgreement(
  home: number | null,
  away: number | null,
  observations: readonly RankableObservation[],
): SourceAgreement {
  const ranking = rankFixtureResult(observations);
  if (ranking.homeGoals == null || ranking.homeGoals !== home || ranking.awayGoals !== away) {
    return "other";
  }
  if (ranking.classification === "verified") {
    return "verified";
  }
  if (ranking.classification === "provisional") {
    return "provisional";
  }
  return "other";
}

/** Legacy rows have an empty provenance and keep their existing label. A fixed score uses the source comparison. */
export function displayedResultLabel(match: {
  resultProvenance: string;
  manuallyCorrected: boolean;
  resultConflict: boolean;
  resultState?: string;
}, legacy: string, agreement?: SourceAgreement | null): string {
  if (isLegacyManualScore(match)) {
    return LABEL_OLDER_MANUAL;
  }
  if (scoreIsFixed(match)) {
    if (agreement === "verified") {
      return LABEL_VERIFIED_FIXED;
    }
    if (agreement === "provisional") {
      return LABEL_FIXED_ONE_SOURCE;
    }
    if (agreement === "other") {
      return LABEL_MANUAL_NOT_VERIFIED;
    }
    return LABEL_FIXED;
  }
  if (match.resultProvenance === "two-source") {
    return match.resultConflict ? "Result conflict. Verified, two sources." : "Verified, two sources";
  }
  if (match.resultProvenance === "one-source") {
    return match.resultConflict ? "Result conflict. Provisional." : "Provisional";
  }
  return legacy;
}
