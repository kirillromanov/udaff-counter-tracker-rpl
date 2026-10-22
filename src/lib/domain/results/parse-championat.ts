import { normalizeTeamName } from "@/lib/domain/parser/normalize";
import { stripScripts, stripTags, type SourceMatch } from "./types";

const SOURCE = "championat";

/** Championat calendar blocks. An auth wall or a blocked page yields no matches. */
export function parseChampionat(html: string): SourceMatch[] {
  const body = stripScripts(html);
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  const blocks = body.split(/class="results-item"/i).slice(1);
  for (const block of blocks) {
    const tour = block.match(/(\d+)\s*(?:-|–)?\s*(?:й\s*)?тур/i);
    const names = [...block.matchAll(/results-item__name[^>]*>([^<]+)/gi)].map((match) => stripTags(match[1] ?? ""));
    const score = stripTags(block.match(/results-item__score[^>]*>([^<]+)/i)?.[1] ?? "");
    const goals = score.match(/^(\d+)\s*[:–-]\s*(\d+)$/);
    const roundNumber = tour ? Number(tour[1]) : null;
    const homeTeam = names[0] ?? "";
    const awayTeam = names[1] ?? "";
    if (!goals || !homeTeam || !awayTeam || roundNumber == null || !Number.isInteger(roundNumber)) {
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
