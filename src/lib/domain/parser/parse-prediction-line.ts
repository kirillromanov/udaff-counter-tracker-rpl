import { normalizeCommentText } from "./normalize";

export interface RawPredictionLine {
  rawLine: string;
  homeName: string | null;
  awayName: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  markedAsMt: boolean;
  warnings: string[];
}

const DATETIME_PREFIX = /^\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?(?:\s+\d{1,2}:\d{2})?\s*/;
const MT_MARKER = /\(\s*(?:мт|mt)\s*\)/i;
const SCORE = /(\d{1,2})\s*[-:]\s*(\d{1,2})/g;

function looksLikeTeamPair(home: string, away: string): boolean {
  const side = (value: string) => {
    const words = value.split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 4 && /^[\p{L}\p{N} .]+$/u.test(value);
  };
  return side(home) && side(away);
}

function splitTeams(value: string): { home: string; away: string } | null {
  const parts = value
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return {
    home: parts[0] ?? "",
    away: parts.slice(1).join(" - "),
  };
}

/**
 * Returns null for chatter. A line that looks like a prediction but cannot
 * be read is returned with a warning instead of being thrown away silently.
 */
export function parsePredictionLine(rawLine: string): RawPredictionLine | null {
  const original = rawLine.trim();
  if (!original) {
    return null;
  }

  let line = normalizeCommentText(original);
  const markedAsMt = MT_MARKER.test(line);
  line = line.replace(MT_MARKER, " ").replace(DATETIME_PREFIX, "").replace(/\s+/g, " ").trim();
  if (!line) {
    return null;
  }

  const scores = [...line.matchAll(SCORE)];
  const score = scores.at(-1);
  if (!score || score.index == null) {
    const teams = splitTeams(line);
    if (!teams || !looksLikeTeamPair(teams.home, teams.away)) {
      return null;
    }
    return {
      rawLine: original,
      homeName: teams.home,
      awayName: teams.away,
      homeGoals: null,
      awayGoals: null,
      markedAsMt,
      warnings: ["Missing score"],
    };
  }

  const before = line.slice(0, score.index).trim();
  const after = line.slice(score.index + score[0].length).trim();
  const teams = splitTeams(before) ?? (before && after ? { home: before, away: after } : null);
  const homeGoals = Number(score[1]);
  const awayGoals = Number(score[2]);

  if (!teams) {
    return {
      rawLine: original,
      homeName: null,
      awayName: null,
      homeGoals,
      awayGoals,
      markedAsMt,
      warnings: ["Malformed prediction line"],
    };
  }

  return {
    rawLine: original,
    homeName: teams.home,
    awayName: teams.away,
    homeGoals,
    awayGoals,
    markedAsMt,
    warnings: [],
  };
}
