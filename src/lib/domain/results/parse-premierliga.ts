import type { Completeness, ConfidenceLevel, MatchStatus, SourceMatch } from "./types";

const SOURCE = "premierliga";

/** Public tournament id from the official 2026/27 matches page. Not a secret. */
export const PREMIERLIGA_TOURNAMENT_ID = 724;

/**
 * Status 4 is the value the official matches page labels "Завершен".
 * Status 0 is a match that has not started. Any other code is kept as evidence only.
 */
const FINISHED_STATUS = 4;

interface PremierligaClub {
  id?: unknown;
  name?: unknown;
}

interface PremierligaStage {
  id?: unknown;
  name?: unknown;
}

interface PremierligaMatch {
  id?: unknown;
  clubH?: unknown;
  clubA?: unknown;
  goalH?: unknown;
  goalA?: unknown;
  status?: unknown;
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function evidence(status: number | null, homeGoals: number | null, awayGoals: number | null): {
  matchStatus: MatchStatus;
  completeness: Completeness;
  confidence: ConfidenceLevel;
} | null {
  if (homeGoals == null || awayGoals == null) {
    return null;
  }
  if (status === FINISHED_STATUS) {
    return { matchStatus: "finished", completeness: "complete", confidence: "high" };
  }
  if (status === 0) {
    return { matchStatus: "scheduled", completeness: "partial", confidence: "low" };
  }
  return { matchStatus: "unknown", completeness: "partial", confidence: "low" };
}

/**
 * Official RPL matches payload: clubs, stages, and the getMatches stages.
 * A captcha page or any body that is not this JSON yields no matches.
 */
export function parsePremierliga(body: string): SourceMatch[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const document = payload as { clubs?: unknown; stages?: unknown; matches?: unknown };
  const clubs = new Map<number, string>();
  for (const row of asArray(document.clubs)) {
    const club = row as PremierligaClub;
    const id = integer(club.id);
    const name = String(club.name ?? "").trim();
    if (id != null && name) {
      clubs.set(id, name);
    }
  }
  const rounds = new Map<number, number>();
  for (const row of asArray(document.stages)) {
    const stage = row as PremierligaStage;
    const id = integer(stage.id);
    const roundNumber = Number(String(stage.name ?? "").match(/тур\s*(\d+)/i)?.[1] ?? "");
    if (id != null && Number.isInteger(roundNumber) && roundNumber > 0) {
      rounds.set(id, roundNumber);
    }
  }
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  for (const group of asArray(document.matches)) {
    const stage = group as { stage?: unknown; matches?: unknown };
    const stageId = integer(stage.stage);
    const roundNumber = stageId == null ? null : rounds.get(stageId) ?? null;
    for (const row of asArray(stage.matches)) {
      const match = row as PremierligaMatch;
      const id = integer(match.id);
      const homeTeam = clubs.get(integer(match.clubH) ?? -1) ?? "";
      const awayTeam = clubs.get(integer(match.clubA) ?? -1) ?? "";
      const parsed = evidence(integer(match.status), integer(match.goalH), integer(match.goalA));
      if (id == null || !homeTeam || !awayTeam || !parsed) {
        continue;
      }
      const sourceKey = String(id);
      if (seen.has(sourceKey)) {
        continue;
      }
      seen.add(sourceKey);
      matches.push({
        source: SOURCE,
        sourceKey,
        roundNumber,
        homeTeam,
        awayTeam,
        homeGoals: integer(match.goalH) as number,
        awayGoals: integer(match.goalA) as number,
        role: "fallback",
        confidence: parsed.confidence,
        matchStatus: parsed.matchStatus,
        completeness: parsed.completeness,
      });
    }
  }
  return matches;
}
