import { normalizeTeamName } from "@/lib/domain/parser/normalize";
import { stripScripts, stripTags, type SourceMatch } from "./types";

const SOURCE = "sportbox";

/** Sportbox result rows. A 403 page or any page without those rows yields no matches. */
export function parseSportbox(html: string): SourceMatch[] {
  const body = stripScripts(html);
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const htmlRow = row[1] ?? "";
    const tour = stripTags(htmlRow.match(/class="tour"[^>]*>([^<]+)/i)?.[1] ?? "");
    const homeTeam = stripTags(htmlRow.match(/class="team1"[^>]*>([^<]+)/i)?.[1] ?? "");
    const awayTeam = stripTags(htmlRow.match(/class="team2"[^>]*>([^<]+)/i)?.[1] ?? "");
    const score = stripTags(htmlRow.match(/class="score"[^>]*>([^<]+)/i)?.[1] ?? "");
    const goals = score.match(/^(\d+)\s*[:–-]\s*(\d+)$/);
    const roundNumber = Number(tour);
    if (!goals || !homeTeam || !awayTeam || !Number.isInteger(roundNumber)) {
      continue;
    }
    const sourceKey = `r${roundNumber}:${normalizeTeamName(homeTeam)}:${normalizeTeamName(awayTeam)}`;
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
      homeGoals: Number(goals[1]),
      awayGoals: Number(goals[2]),
      role: "fallback",
      confidence: "medium",
    });
  }
  return matches;
}
