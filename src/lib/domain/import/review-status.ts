import type { ParsedPredictionLine } from "@/lib/domain/parser/types";

export type ReviewTone = "ok" | "conflict" | "correction";

export interface PredictionToneInput {
  warning: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  ignored: boolean;
}

export interface SetToneInput {
  selected: boolean;
  warnings: string[];
  unmatched: number;
  predictions: PredictionToneInput[];
}

export function readWarnings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function readLines(value: string): ParsedPredictionLine[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ParsedPredictionLine[]) : [];
  } catch {
    return [];
  }
}

export function isConflictWarning(warning: string): boolean {
  const text = warning.toLowerCase();
  return text.includes("duplicate") || text.includes("ambiguous");
}

export function isCorrectionWarning(warning: string): boolean {
  const text = warning.toLowerCase();
  if (isConflictWarning(text) || text.startsWith("no prediction for")) {
    return false;
  }
  return (
    text.includes("swapped") ||
    text.includes("missing score") ||
    text.includes("unrecognized") ||
    text.includes("malformed") ||
    text.includes("could not match") ||
    text.includes("unmatched")
  );
}

export function predictionTone(prediction: PredictionToneInput): ReviewTone {
  if (prediction.ignored) {
    return "ok";
  }
  const warning = prediction.warning ?? "";
  if (isConflictWarning(warning)) {
    return "conflict";
  }
  if (prediction.homeGoals == null || prediction.awayGoals == null || isCorrectionWarning(warning)) {
    return "correction";
  }
  return "ok";
}

export function setTone(set: SetToneInput): ReviewTone {
  if (set.warnings.some(isConflictWarning) || set.predictions.some((prediction) => predictionTone(prediction) === "conflict")) {
    return "conflict";
  }
  const missingOnSelected =
    set.selected && set.warnings.some((warning) => warning.toLowerCase().startsWith("no prediction for"));
  if (
    set.unmatched > 0 ||
    missingOnSelected ||
    set.warnings.some(isCorrectionWarning) ||
    set.predictions.some((prediction) => predictionTone(prediction) === "correction")
  ) {
    return "correction";
  }
  return "ok";
}

export function summarizeSets(sets: SetToneInput[]): { conflicts: number; corrections: number; selected: number } {
  let conflicts = 0;
  let corrections = 0;
  let selected = 0;
  for (const set of sets) {
    if (set.selected) {
      selected += 1;
    }
    const tone = setTone(set);
    if (tone === "conflict") {
      conflicts += 1;
    } else if (tone === "correction") {
      corrections += 1;
    }
  }
  return { conflicts, corrections, selected };
}

export function toSetToneInput(set: {
  selected: boolean;
  warningsJson: string;
  parsedJson: string;
  predictions: PredictionToneInput[];
}): SetToneInput {
  return {
    selected: set.selected,
    warnings: readWarnings(set.warningsJson),
    unmatched: readLines(set.parsedJson).filter((line) => !line.fixtureId).length,
    predictions: set.predictions,
  };
}
