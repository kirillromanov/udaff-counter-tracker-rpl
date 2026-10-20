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

const DATETIME_PREFIX =
  /^\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?(?:\s+(?:at|в))?(?:\s+\d{1,2}:\d{2})?\s*/i;
const MT_MARKER = /\(\s*(?:мт|mt)\s*\)|\*\s*2(?!\d)/i;
const SCORE = /(?<!\d)(\d{1,2})(?!\d)\s*([-:])\s*(?<!\d)(\d{1,2})(?!\d)(?![.,]\d)/g;
const UNRECOGNIZED_SCORE = /^(.*?)\s+-\d+\s*\*+\s*$/;
const MAX_GOALS = 12;

const PROSE_WORDS = new Set([
  "это",
  "как",
  "так",
  "то",
  "что",
  "не",
  "на",
  "по",
  "мне",
  "для",
  "или",
  "про",
  "все",
  "всё",
  "вот",
  "там",
  "его",
  "она",
  "они",
  "уже",
  "ещё",
  "еще",
  "если",
  "когда",
  "просто",
  "можно",
  "надо",
  "только",
  "этот",
  "эта",
  "эти",
]);

function looksLikeTeamPair(home: string, away: string): boolean {
  const side = (value: string) => {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 4) {
      return false;
    }
    if (!/^[\p{L}\p{N} ]+$/u.test(value)) {
      return false;
    }
    if (!words.some((word) => word.length >= 4)) {
      return false;
    }
    return !words.some((word) => PROSE_WORDS.has(word.toLocaleLowerCase("ru")));
  };
  return side(home) && side(away);
}

function splitTeams(value: string): { home: string; away: string } | null {
  const spaced = value
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (spaced.length >= 2) {
    return {
      home: spaced[0] ?? "",
      away: spaced.slice(1).join(" - "),
    };
  }

  // "Зенит-Ахмат" has no spaces around the dash. Only accept that when both
  // sides still look like club names, so "где-то" and "900-1000" stay prose.
  const tight = value
    .split(/\s*-\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (tight.length === 2 && looksLikeTeamPair(tight[0] ?? "", tight[1] ?? "")) {
    return { home: tight[0] ?? "", away: tight[1] ?? "" };
  }
  return null;
}

function plausibleScore(left: string, separator: string, right: string): boolean {
  const homeGoals = Number(left);
  const awayGoals = Number(right);
  if (homeGoals > MAX_GOALS || awayGoals > MAX_GOALS) {
    return false;
  }
  // "22:20" and "14:00" are clocks. A football score written with a colon
  // uses a single digit on each side ("2:1"), never a zero-padded minute.
  if (separator === ":" && (left.length > 1 || right.length > 1)) {
    return false;
  }
  return true;
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

  const scores = [...line.matchAll(SCORE)].filter((match) =>
    plausibleScore(match[1] ?? "", match[2] ?? "", match[3] ?? ""),
  );
  const score = scores.at(-1);
  if (!score || score.index == null) {
    const unrecognized = UNRECOGNIZED_SCORE.exec(line);
    const teamLine = unrecognized?.[1]?.trim() || line;
    const teams = splitTeams(teamLine);
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
      warnings: [unrecognized ? "Unrecognized score" : "Missing score"],
    };
  }

  const before = line.slice(0, score.index).trim();
  const after = line.slice(score.index + score[0].length).trim();
  const teams = splitTeams(before) ?? (before && after ? { home: before, away: after } : null);
  const homeGoals = Number(score[1]);
  const awayGoals = Number(score[3]);

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
