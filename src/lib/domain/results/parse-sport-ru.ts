import { normalizeTeamName } from "@/lib/domain/parser/normalize";
import { stripScripts, stripTags, type SourceMatch } from "./types";

const SOURCE = "sport-ru";

function cellsOf(row: string): string[] {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripTags(match[1] ?? ""));
}

/** Finished scores from the Sport.ru RPL table. Live and unplayed rows are skipped. */
export function parseSportRu(html: string): SourceMatch[] {
  const body = stripScripts(html);
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  for (const row of body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const attrs = row[1] ?? "";
    if (/\blive\b/i.test(attrs)) {
      continue;
    }
    const cells = cellsOf(row[2] ?? "");
    if (cells.length < 7) {
      continue;
    }
    const roundNumber = /^\d+$/.test(cells[1] ?? "") ? Number(cells[1]) : Number.NaN;
    const homeGoals = /^\d+$/.test(cells[3] ?? "") ? Number(cells[3]) : Number.NaN;
    const awayGoals = /^\d+$/.test(cells[5] ?? "") ? Number(cells[5]) : Number.NaN;
    const homeTeam = cells[2] ?? "";
    const awayTeam = cells[6] ?? "";
    if (!Number.isInteger(roundNumber) || !Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) {
      continue;
    }
    if (!homeTeam || !awayTeam || homeGoals < 0 || awayGoals < 0) {
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
      homeGoals,
      awayGoals,
    });
  }
  return matches;
}
