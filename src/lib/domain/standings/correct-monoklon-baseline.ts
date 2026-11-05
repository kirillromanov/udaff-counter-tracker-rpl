import { normalizeParticipantName } from "@/lib/domain/participants/identity";
import { parseStandingsCheckpoint, type ParsedCheckpointRow } from "./parse-checkpoint";

export const MONOKLON_CANONICAL_NAME = "моноклон";
export const MONOKLON_ALIAS = "monoklon";
export const MONOKLON_BASELINE_FROM = 162;
export const MONOKLON_BASELINE_TO = 189;

const MONOKLON_KEYS = new Set([
  normalizeParticipantName(MONOKLON_CANONICAL_NAME),
  normalizeParticipantName(MONOKLON_ALIAS),
]);

export type BaselineCorrectionResult =
  | { status: "unchanged"; rawText: string }
  | { status: "refused"; current: number | null; reason: string }
  | { status: "corrected"; rawText: string; previous: number; next: number; note: string };

export function isMonoklonName(name: string): boolean {
  return MONOKLON_KEYS.has(normalizeParticipantName(name));
}

function rewriteLine(rawLine: string, rank: number, points: number): string {
  return rawLine.trim().replace(/^\d+/u, String(rank)).replace(/\s+\d+\s*$/u, ` ${points}`);
}

/**
 * One-time baseline correction. 162 becomes 189. 189 stays 189.
 * Any other current total is left untouched.
 * Movement symbols stay on the line. Only the rank numbers and this one total change.
 */
export function applyMonoklonBaselineCorrection(rawText: string, correctedAt: string): BaselineCorrectionResult {
  let parsed: ParsedCheckpointRow[];
  try {
    parsed = parseStandingsCheckpoint(rawText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not read the baseline";
    return { status: "refused", current: null, reason };
  }
  const matches = parsed.filter((row) => isMonoklonName(row.displayName));
  if (matches.length !== 1) {
    return {
      status: "refused",
      current: null,
      reason: matches.length === 0 ? "моноклон is not on this baseline." : "моноклон matches more than one baseline row.",
    };
  }
  const current = matches[0];
  if (!current) {
    return { status: "refused", current: null, reason: "моноклон is not on this baseline." };
  }
  if (current.totalPoints === MONOKLON_BASELINE_TO) {
    return { status: "unchanged", rawText };
  }
  if (current.totalPoints !== MONOKLON_BASELINE_FROM) {
    return {
      status: "refused",
      current: current.totalPoints,
      reason: `моноклон baseline is ${current.totalPoints}, not ${MONOKLON_BASELINE_FROM} or ${MONOKLON_BASELINE_TO}.`,
    };
  }

  const updated = parsed.map((row) => (row.rawLine === current.rawLine ? { ...row, totalPoints: MONOKLON_BASELINE_TO } : row));
  const ordered = [...updated].sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    return left.rank - right.rank;
  });
  const rewritten = new Map(ordered.map((row, index) => [row.rawLine, rewriteLine(row.rawLine, index + 1, row.totalPoints)]));
  const note = `note: моноклон: corrected baseline points from 162 to 189 at ${correctedAt}. One archived round had been counted as -9; the parsed round was +18. This is not a recurring adjustment.`;
  const lines = rawText.split("\n").map((line) => rewritten.get(line.trim()) ?? line);
  if (!lines.some((line) => line.includes("corrected baseline points from 162 to 189"))) {
    lines.push(note);
  }
  return {
    status: "corrected",
    rawText: lines.join("\n"),
    previous: MONOKLON_BASELINE_FROM,
    next: MONOKLON_BASELINE_TO,
    note,
  };
}
