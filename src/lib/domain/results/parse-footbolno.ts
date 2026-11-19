import { normalizeTeamName } from "@/lib/domain/parser/normalize";
import { stripScripts, stripTags, type Completeness, type ConfidenceLevel, type MatchStatus, type SourceMatch } from "./types";

const SOURCE = "footbolno";

function finishedStatus(label: string): { matchStatus: MatchStatus; completeness: Completeness; confidence: ConfidenceLevel } | null {
  const status = normalizeTeamName(label);
  if (status === "завершен" || status === "окончен") {
    return { matchStatus: "finished", completeness: "complete", confidence: "high" };
  }
  if (status.startsWith("ид") || status.includes("live") || status.includes("онлайн")) {
    return { matchStatus: "live", completeness: "partial", confidence: "low" };
  }
  if (status.startsWith("не нача") || status.includes("перенес")) {
    return { matchStatus: "scheduled", completeness: "partial", confidence: "low" };
  }
  if (!status) {
    return { matchStatus: "unknown", completeness: "partial", confidence: "low" };
  }
  return { matchStatus: "unknown", completeness: "partial", confidence: "low" };
}

function resultsSection(html: string): string {
  const start = html.search(/id=["']rezultaty["']/i);
  if (start < 0) {
    return "";
  }
  const rest = html.slice(start);
  const end = rest.search(/<section\b/i);
  return end > 0 ? rest.slice(0, end) : rest;
}

/**
 * Recent finished cards from the footbolno results section.
 * The upcoming-tour section is ignored. A card without a score is ignored.
 * A card that is not marked finished is stored as partial evidence.
 */
export function parseFootbolno(html: string): SourceMatch[] {
  const section = resultsSection(stripScripts(html));
  if (!section) {
    return [];
  }
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  for (const card of section.split(/<div class="fbst-mc">/i).slice(1)) {
    const heading = card.match(/class="fbst-mc-d">([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const [dateHtml, statusHtml] = heading.split(/<br\s*\/?>/i);
    const dateLabel = stripTags(dateHtml ?? "");
    const statusLabel = stripTags(statusHtml ?? "");
    const teams = [...card.matchAll(/<a[^>]*>([^<]+)<\/a>/gi)].map((match) => stripTags(match[1] ?? "")).filter(Boolean);
    const score = stripTags(card.match(/class="fbst-mc-s">([^<]*)/i)?.[1] ?? "");
    const goals = score.match(/^(\d+)\s*[:–-]\s*(\d+)$/);
    const homeTeam = teams[0] ?? "";
    const awayTeam = teams[1] ?? "";
    const parsed = finishedStatus(statusLabel);
    if (!goals || !homeTeam || !awayTeam || !parsed) {
      continue;
    }
    const sourceKey = `${normalizeTeamName(dateLabel)}:${normalizeTeamName(homeTeam)}:${normalizeTeamName(awayTeam)}`;
    if (!sourceKey || seen.has(sourceKey)) {
      continue;
    }
    seen.add(sourceKey);
    matches.push({
      source: SOURCE,
      sourceKey,
      roundNumber: null,
      homeTeam,
      awayTeam,
      homeGoals: Number(goals[1]),
      awayGoals: Number(goals[2]),
      role: "verification",
      confidence: parsed.confidence,
      matchStatus: parsed.matchStatus,
      completeness: parsed.completeness,
    });
  }
  return matches;
}
