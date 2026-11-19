import type { SourceMatch } from "./types";

const SOURCE = "football-data";
const FINISHED = new Set(["complete", "finished", "ft", "aet", "fulltime", "full-time"]);

function integerScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function teamName(team: unknown): string {
  if (!team || typeof team !== "object") {
    return "";
  }
  const row = team as { team_name?: unknown; name?: unknown; title?: unknown };
  return String(row.team_name ?? row.name ?? row.title ?? "").trim();
}

function roundNumber(match: Record<string, unknown>): number | null {
  for (const key of ["round", "game_week", "gameweek", "matchday"]) {
    const value = match[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      return Number(value.trim());
    }
  }
  return null;
}

/** RPL seasons start in July. 2026/2027 is season start 2026. */
export function currentSeasonStart(now = new Date()): number {
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function seasonMatches(year: unknown, seasonStart: number): boolean {
  if (year == null || year === "") {
    return true;
  }
  const text = String(year).trim();
  const start = String(seasonStart);
  const end = String(seasonStart + 1);
  return text === start || text === `${start}${end}` || text === `${start}/${end}` || text === `${start}-${end}` || text === `${start}/${end.slice(2)}`;
}

function matchRows(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const body = payload as { success?: unknown; data?: unknown; matches?: unknown };
  if (body.success === false) {
    return [];
  }
  const data = body.data ?? body;
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === "object" && Array.isArray((data as { matches?: unknown }).matches)) {
    return (data as { matches: unknown[] }).matches;
  }
  return [];
}

/**
 * Finished matches from a footballdata.io matches payload.
 * Live rows are skipped. A season year from another year is skipped when seasonStart is set.
 */
export function parseFootballData(body: string, seasonStart = currentSeasonStart()): SourceMatch[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  for (const row of matchRows(payload)) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const match = row as Record<string, unknown>;
    if (!FINISHED.has(String(match.status ?? "").trim().toLowerCase())) {
      continue;
    }
    const season = match.season;
    const year = season && typeof season === "object" ? (season as { year?: unknown }).year : null;
    if (!seasonMatches(year, seasonStart)) {
      continue;
    }
    const score = match.score;
    if (!score || typeof score !== "object") {
      continue;
    }
    const homeGoals = integerScore((score as { home?: unknown }).home);
    const awayGoals = integerScore((score as { away?: unknown }).away);
    const homeTeam = teamName(match.home_team);
    const awayTeam = teamName(match.away_team);
    const sourceKey = String(match.match_id ?? match.id ?? "").trim();
    if (!sourceKey || homeGoals == null || awayGoals == null || !homeTeam || !awayTeam || seen.has(sourceKey)) {
      continue;
    }
    seen.add(sourceKey);
    matches.push({
      source: SOURCE,
      sourceKey,
      roundNumber: roundNumber(match),
      homeTeam,
      awayTeam,
      homeGoals,
      awayGoals,
      role: "fallback",
      confidence: "high",
    });
  }
  return matches;
}
