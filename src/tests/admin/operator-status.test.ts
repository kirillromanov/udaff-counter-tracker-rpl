import { describe, expect, it } from "vitest";
import {
  aliasSuggestions,
  comparisonLabel,
  OPERATOR_LABEL,
  reviewQueueOf,
  roundLayerLabel,
  rowInReconciliationView,
  setInQueue,
  setLabels,
  unknownAuthorLabel,
  type ReviewSetFacts,
} from "@/lib/domain/review/operator-status";

const flagged: ReviewSetFacts = {
  participantName: "neofit",
  authorName: "neofit",
  status: "flagged",
  selected: false,
  manuallyEdited: false,
  selection: "auto",
  warnings: ["Malformed prediction line", "Duplicate prediction for ЦСКА — Балтика"],
  tone: "conflict",
};

const accepted: ReviewSetFacts = {
  participantName: "Йош!",
  authorName: "йош",
  status: "accepted",
  selected: true,
  manuallyEdited: false,
  selection: "auto",
  warnings: [],
  tone: "ok",
};

describe("operator review labels", () => {
  it("names the statuses an operator scans for", () => {
    expect(OPERATOR_LABEL.accepted).toBe("Accepted");
    expect(OPERATOR_LABEL.flagged).toBe("Flagged");
    expect(OPERATOR_LABEL.unmatched_participant).toBe("Unmatched participant");
    expect(OPERATOR_LABEL.alias_suggestion).toBe("Alias suggestion");
    expect(OPERATOR_LABEL.ignored_author).toBe("Ignored non-participant");
    expect(OPERATOR_LABEL.malformed_prediction).toBe("Malformed prediction");
    expect(OPERATOR_LABEL.manual_override).toBe("Manual override");
    expect(OPERATOR_LABEL.baseline_mismatch).toBe("Baseline mismatch");
    expect(OPERATOR_LABEL.scoring_mismatch).toBe("Scoring mismatch");
  });

  it("keeps accepted slips out of the default review queue", () => {
    expect(reviewQueueOf(undefined)).toBe("review");
    expect(setInQueue(flagged, "review", "")).toBe(true);
    expect(setInQueue(accepted, "review", "")).toBe(false);
    expect(setInQueue(accepted, "accepted", "йош")).toBe(true);
    expect(setInQueue(flagged, "all", "neofit")).toBe(true);
  });

  it("labels malformed lines and manual overrides without hiding the flag", () => {
    expect(setLabels(flagged)).toEqual(["flagged", "malformed_prediction"]);
    expect(setLabels({ ...flagged, warnings: ["Unrecognized score"] })).toContain("malformed_prediction");
    expect(setLabels({ ...accepted, manuallyEdited: true, selection: "manual" })).toEqual(["accepted", "manual_override"]);
  });

  it("suggests a longer registry name and does not link it", () => {
    expect(aliasSuggestions("Павел", ["Павел Абросимов", "Hordi Cruyff"])).toEqual(["Павел Абросимов"]);
    expect(aliasSuggestions("LAX", ["Павел Абросимов"])).toEqual([]);
    expect(unknownAuthorLabel(1)).toBe("alias_suggestion");
    expect(unknownAuthorLabel(0)).toBe("unmatched_participant");
  });

  it("separates a baseline gap from a scoring disagreement", () => {
    expect(comparisonLabel({ status: "missing", cause: "missing_round_data" })).toBe("baseline_mismatch");
    expect(comparisonLabel({ status: "mismatch", cause: "scoring_logic" })).toBe("scoring_mismatch");
    expect(comparisonLabel({ status: "unmatched_name", cause: "participant_matching" })).toBe("unmatched_participant");
    expect(comparisonLabel({ status: "exact", cause: null })).toBeNull();
    expect(rowInReconciliationView({ status: "exact", cause: null, displayName: "Hordi Cruyff" }, "open", "")).toBe(false);
    expect(rowInReconciliationView({ status: "mismatch", cause: "scoring_logic", displayName: "Hordi Cruyff" }, "scoring", "hordi")).toBe(true);
  });

  it("labels an imported round separately from a calculated one", () => {
    expect(roundLayerLabel("imported", 0)).toBe("Imported raw");
    expect(roundLayerLabel("scored", 12)).toBe("Computed");
    expect(roundLayerLabel("open", 0)).toBe("Draft");
  });
});
