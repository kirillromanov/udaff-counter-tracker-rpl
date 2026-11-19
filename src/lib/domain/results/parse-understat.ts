import type { SourceMatch } from "./types";

const SOURCE = "understat";

function integerScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function titleOf(team: unknown): string {
  if (!team || typeof team !== "object") {
    return "";
  }
  return String((team as { title?: unknown }).title ?? "").trim();
}

/** Finished RFPL matches from Understat's getLeagueData JSON. Unplayed rows are skipped. */
export function parseUnderstat(body: string): SourceMatch[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { dates?: unknown }).dates)) {
    return [];
  }
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  for (const row of (payload as { dates: unknown[] }).dates) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const match = row as { id?: unknown; isResult?: unknown; h?: unknown; a?: unknown; goals?: unknown };
    if (match.isResult !== true) {
      continue;
    }
    const goals = match.goals;
    if (!goals || typeof goals !== "object") {
      continue;
    }
    const homeGoals = integerScore((goals as { h?: unknown }).h);
    const awayGoals = integerScore((goals as { a?: unknown }).a);
    const homeTeam = titleOf(match.h);
    const awayTeam = titleOf(match.a);
    const sourceKey = String(match.id ?? "").trim();
    if (!sourceKey || homeGoals == null || awayGoals == null || !homeTeam || !awayTeam || seen.has(sourceKey)) {
      continue;
    }
    seen.add(sourceKey);
    matches.push({
      source: SOURCE,
      sourceKey,
      roundNumber: null,
      homeTeam,
      awayTeam,
      homeGoals,
      awayGoals,
      role: "verification",
      confidence: "medium",
    });
  }
  return matches;
}
