import { parseChampionat } from "./parse-championat";
import { parseSportbox } from "./parse-sportbox";
import { parseSportRu } from "./parse-sport-ru";
import { isAccessBlocked, type SourceAdapter, type SourceFetchResult } from "./types";

/** Sport.ru is first because its results table is server-rendered. The others are attempted and may fail. */
export const RESULT_ADAPTERS: readonly SourceAdapter[] = [
  {
    id: "sport-ru",
    role: "primary",
    url: "https://www.sport.ru/ks/php/football/rpl/results-rpl.html",
    parse: parseSportRu,
  },
  {
    id: "championat",
    role: "fallback",
    url: "https://www.championat.com/football/_russiapl/tournament/7096/calendar/",
    parse: parseChampionat,
  },
  {
    id: "sportbox",
    role: "fallback",
    url: "https://news.sportbox.ru/Vidy_sporta/Futbol/Russia/premier_league/stats/turnir_23915",
    parse: parseSportbox,
  },
];

export function interpretSourcePage(adapter: SourceAdapter, httpOk: boolean, html: string, error: string | null): SourceFetchResult {
  if (!httpOk) {
    return { source: adapter.id, role: adapter.role, url: adapter.url, status: "failed", results: [], error: error ?? "Request failed" };
  }
  const results = adapter.parse(html);
  if (results.length === 0 && (isAccessBlocked(html) || error)) {
    return {
      source: adapter.id,
      role: adapter.role,
      url: adapter.url,
      status: "failed",
      results: [],
      error: error ?? "Source blocked the results page",
    };
  }
  return { source: adapter.id, role: adapter.role, url: adapter.url, status: "ok", results, error: null };
}
