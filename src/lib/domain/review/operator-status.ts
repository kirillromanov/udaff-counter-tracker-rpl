import { participantKey } from "@/lib/domain/import/participant-key";
import type { ReviewTone } from "@/lib/domain/import/review-status";

/** Labels an operator can scan without opening the raw warning text. */
export type OperatorStatus =
  | "accepted"
  | "flagged"
  | "unmatched_participant"
  | "alias_suggestion"
  | "ignored_author"
  | "malformed_prediction"
  | "manual_override"
  | "baseline_mismatch"
  | "scoring_mismatch";

export const OPERATOR_LABEL: Record<OperatorStatus, string> = {
  accepted: "Accepted",
  flagged: "Flagged",
  unmatched_participant: "Unknown author",
  alias_suggestion: "Alias",
  ignored_author: "Ignored user",
  malformed_prediction: "Malformed prediction",
  manual_override: "Manual override",
  baseline_mismatch: "Baseline mismatch",
  scoring_mismatch: "Scoring mismatch",
};

export type OperatorTone = "success" | "warning" | "danger" | "info" | "neutral";

export function operatorTone(status: OperatorStatus): OperatorTone {
  if (status === "accepted") {
    return "success";
  }
  if (status === "malformed_prediction" || status === "scoring_mismatch") {
    return "danger";
  }
  if (status === "manual_override" || status === "alias_suggestion") {
    return "info";
  }
  if (status === "flagged" || status === "unmatched_participant" || status === "baseline_mismatch") {
    return "warning";
  }
  return "neutral";
}

export interface ReviewSetFacts {
  participantName: string;
  authorName: string;
  status: string;
  selected: boolean;
  manuallyEdited: boolean;
  selection: string;
  warnings: string[];
  tone: ReviewTone;
}

export type ReviewQueue = "review" | "accepted" | "all";

export function reviewQueueOf(value: string | undefined): ReviewQueue {
  if (value === "accepted" || value === "all") {
    return value;
  }
  return "review";
}

export function matchesQuery(value: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("ru");
  if (!needle) {
    return true;
  }
  return value.toLocaleLowerCase("ru").includes(needle);
}

export function setNeedsReview(set: Pick<ReviewSetFacts, "status" | "tone">): boolean {
  return set.status === "flagged" || set.tone === "conflict" || set.tone === "correction";
}

export function setInQueue(set: ReviewSetFacts, queue: ReviewQueue, query: string): boolean {
  if (!matchesQuery(`${set.participantName} ${set.authorName}`, query)) {
    return false;
  }
  if (queue === "all") {
    return true;
  }
  if (queue === "accepted") {
    return set.selected && set.status === "accepted";
  }
  return setNeedsReview(set);
}

export function setLabels(set: Pick<ReviewSetFacts, "status" | "selected" | "manuallyEdited" | "selection" | "warnings" | "tone">): OperatorStatus[] {
  const labels: OperatorStatus[] = [];
  if (set.selected && set.status === "accepted") {
    labels.push("accepted");
  }
  if (setNeedsReview(set)) {
    labels.push("flagged");
  }
  if (set.warnings.some((warning) => /malformed|unrecognized/i.test(warning))) {
    labels.push("malformed_prediction");
  }
  if (set.manuallyEdited || set.selection === "manual") {
    labels.push("manual_override");
  }
  return labels;
}

/** Registry names that start with this forum nick. A suggestion is not a link. */
export function aliasSuggestions(name: string, registryNames: readonly string[]): string[] {
  const key = participantKey(name);
  if (key.length < 3) {
    return [];
  }
  return registryNames.filter((candidate) => {
    const other = participantKey(candidate);
    return other.startsWith(`${key} `);
  });
}

export function unknownAuthorLabel(suggestionCount: number): "alias_suggestion" | "unmatched_participant" {
  return suggestionCount > 0 ? "alias_suggestion" : "unmatched_participant";
}

export function comparisonLabel(row: { status: string; cause: string | null }): OperatorStatus | null {
  if (row.status === "exact") {
    return null;
  }
  if (row.status === "unmatched_name" || row.cause === "participant_matching") {
    return "unmatched_participant";
  }
  if (row.cause === "scoring_logic") {
    return "scoring_mismatch";
  }
  return "baseline_mismatch";
}

export type ReconciliationView = "open" | "baseline" | "scoring" | "exact" | "all";

export function reconciliationViewOf(value: string | undefined): ReconciliationView {
  if (value === "baseline" || value === "scoring" || value === "exact" || value === "all") {
    return value;
  }
  return "open";
}

export function rowInReconciliationView(
  row: { status: string; cause: string | null; displayName: string },
  view: ReconciliationView,
  query: string,
): boolean {
  if (!matchesQuery(row.displayName, query)) {
    return false;
  }
  const label = comparisonLabel(row);
  if (view === "all") {
    return true;
  }
  if (view === "exact") {
    return row.status === "exact";
  }
  if (view === "baseline") {
    return label === "baseline_mismatch" || label === "unmatched_participant";
  }
  if (view === "scoring") {
    return label === "scoring_mismatch";
  }
  return row.status !== "exact";
}

export function roundLayerLabel(
  status: string,
  scoredParticipants: number,
  standingRole?: string,
): "Reference total" | "Confirmed round" | "Imported raw" | "Draft" | "Archived round" {
  const scored = status === "scored" || scoredParticipants > 0;
  if (standingRole === "archived") {
    if (scored) {
      return "Reference total";
    }
    if (status === "imported") {
      return "Imported raw";
    }
    return "Archived round";
  }
  if (scored) {
    return "Confirmed round";
  }
  if (status === "imported") {
    return "Imported raw";
  }
  return "Draft";
}
