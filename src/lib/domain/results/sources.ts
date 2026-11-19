import { parseChampionat } from "./parse-championat";
import { parseFootbolno } from "./parse-footbolno";
import { currentSeasonStart, parseFootballData } from "./parse-football-data";
import { parsePremierliga, PREMIERLIGA_TOURNAMENT_ID } from "./parse-premierliga";
import { parseSportbox } from "./parse-sportbox";
import { parseSportRu } from "./parse-sport-ru";
import { parseUnderstat } from "./parse-understat";
import { isAccessBlocked, type SourceAdapter, type SourceFetchResult, type SourceMatch } from "./types";

const API_BASE = "https://footballdata.io/api/v1";
const USER_AGENT = "udaff-counter-tracker/0.1";

function stamp(adapter: SourceAdapter, results: SourceMatch[]): SourceMatch[] {
  return results.map((result) => ({
    ...result,
    source: adapter.id,
    role: adapter.role,
    confidence: result.confidence,
  }));
}

/** Sport.ru is first because its results table is server-rendered. The others are attempted and may fail. */
export const RESULT_ADAPTERS: readonly SourceAdapter[] = [
  {
    id: "sport-ru",
    role: "primary",
    confidence: "high",
    url: "https://www.sport.ru/ks/php/football/rpl/results-rpl.html",
    parse: parseSportRu,
  },
  {
    id: "championat",
    role: "fallback",
    confidence: "medium",
    url: "https://www.championat.com/football/_russiapl/tournament/7096/calendar/",
    parse: parseChampionat,
  },
  {
    id: "sportbox",
    role: "fallback",
    confidence: "medium",
    url: "https://news.sportbox.ru/Vidy_sporta/Futbol/Russia/premier_league/stats/turnir_23915",
    parse: parseSportbox,
  },
  {
    id: "understat",
    role: "verification",
    confidence: "medium",
    format: "json",
    url: "https://understat.com/league/RFPL",
    parse: parseUnderstat,
    load: loadUnderstat,
  },
  {
    id: "football-data",
    role: "fallback",
    confidence: "high",
    format: "json",
    url: `${API_BASE}/leagues`,
    parse: (body) => parseFootballData(body),
    load: loadFootballData,
  },
  {
    id: "premierliga",
    role: "fallback",
    confidence: "high",
    format: "json",
    url: "https://premierliga.ru/matches/?tournament=724&stage=0&month=0&club=0&match=all",
    parse: parsePremierliga,
    load: loadPremierliga,
  },
  {
    id: "footbolno",
    role: "verification",
    confidence: "high",
    url: "https://footbolno.ru/turnirnaya-tablica-rossijskoj-futbolnoj-premer-ligi#rezultaty",
    parse: parseFootbolno,
  },
];

export function interpretSourcePage(adapter: SourceAdapter, httpOk: boolean, body: string, error: string | null): SourceFetchResult {
  if (!httpOk) {
    return { source: adapter.id, role: adapter.role, url: adapter.url, status: "failed", results: [], error: error ?? "Request failed" };
  }
  const results = stamp(adapter, adapter.parse(body));
  if (results.length === 0 && isAccessBlocked(body)) {
    return {
      source: adapter.id,
      role: adapter.role,
      url: adapter.url,
      status: "failed",
      results: [],
      error: error ?? "Source blocked the results page",
    };
  }
  const trimmed = body.trim();
  const jsonShape = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (adapter.format === "json" && results.length === 0 && !jsonShape) {
    return {
      source: adapter.id,
      role: adapter.role,
      url: adapter.url,
      status: "failed",
      results: [],
      error: error ?? "Source did not return match JSON",
    };
  }
  if (results.length === 0 && (isAccessBlocked(body) || error)) {
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

function failed(adapter: SourceAdapter, url: string, error: string): SourceFetchResult {
  return { source: adapter.id, role: adapter.role, url, status: "failed", results: [], error };
}

async function loadUnderstat(): Promise<SourceFetchResult> {
  const adapter = RESULT_ADAPTERS.find((item) => item.id === "understat");
  if (!adapter) {
    throw new Error("Understat adapter is missing");
  }
  try {
    const page = await fetch(adapter.url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await page.text();
    if (!page.ok) {
      return failed(adapter, adapter.url, `HTTP ${page.status}`);
    }
    const season = html.match(/<title>[^<]*?(\d{4})\/(\d{4})/i)?.[1] ?? String(currentSeasonStart());
    const dataUrl = `https://understat.com/getLeagueData/RFPL/${season}`;
    const response = await fetch(dataUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/json", "x-requested-with": "XMLHttpRequest" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    return interpretSourcePage({ ...adapter, url: dataUrl }, response.ok, body, response.ok ? null : `HTTP ${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return failed(adapter, adapter.url, message);
  }
}

export function footballDataApiKey(): string {
  return process.env.FOOTBALLDATA_API_KEY?.trim() ?? "";
}

function apiError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const body = payload as { success?: unknown; error?: { message?: unknown; code?: unknown } };
  if (body.success !== false) {
    return null;
  }
  const message = body.error?.message ?? body.error?.code;
  return typeof message === "string" && message.trim() ? message.trim() : "Request failed";
}

async function footballDataJson(path: string, key: string): Promise<{ ok: boolean; body: unknown; error: string | null }> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    return { ok: false, body: payload, error: apiError(payload) ?? `HTTP ${response.status}` };
  }
  const error = apiError(payload);
  if (error) {
    return { ok: false, body: payload, error };
  }
  return { ok: true, body: payload, error: null };
}

function matchList(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === "object" && Array.isArray((data as { matches?: unknown }).matches)) {
    return (data as { matches: unknown[] }).matches;
  }
  return [];
}

function russianPremierLeagueId(payload: unknown): { id: string | null; error: string | null } {
  const rows = Array.isArray((payload as { data?: unknown } | null)?.data) ? (payload as { data: unknown[] }).data : [];
  const matches = rows.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const league = row as { league_id?: unknown; league_name?: unknown; country?: unknown };
    const name = String(league.league_name ?? "");
    const country = String(league.country ?? "");
    if (!/russia/i.test(country) || !/premier|rfpl/i.test(name)) {
      return [];
    }
    return [String(league.league_id ?? "")];
  }).filter((id) => /^\d+$/.test(id));
  if (matches.length === 1) {
    return { id: matches[0] ?? null, error: null };
  }
  if (matches.length === 0) {
    return { id: null, error: "Russian Premier League was not in the footballdata.io league list" };
  }
  return { id: null, error: "Set FOOTBALLDATA_LEAGUE_ID. More than one Russian league matched." };
}

async function premierligaJson(path: string): Promise<{ ok: boolean; body: string; error: string | null }> {
  const response = await fetch(`https://api.premierliga.ru/api/${path}`, {
    method: "POST",
    headers: { "user-agent": USER_AGENT, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ tournament: PREMIERLIGA_TOURNAMENT_ID }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  return { ok: response.ok, body, error: response.ok ? null : `HTTP ${response.status}` };
}

async function loadPremierliga(): Promise<SourceFetchResult> {
  const adapter = RESULT_ADAPTERS.find((item) => item.id === "premierliga");
  if (!adapter) {
    throw new Error("premierliga adapter is missing");
  }
  try {
    const [clubs, stages, matches] = await Promise.all([
      premierligaJson("getClubs"),
      premierligaJson("getStages"),
      premierligaJson("getMatches"),
    ]);
    const failedCall = [clubs, stages, matches].find((call) => !call.ok);
    if (failedCall) {
      return failed(adapter, adapter.url, failedCall.error ?? "Request failed");
    }
    const body = JSON.stringify({
      clubs: JSON.parse(clubs.body),
      stages: JSON.parse(stages.body),
      matches: JSON.parse(matches.body),
    });
    return interpretSourcePage(adapter, true, body, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return failed(adapter, adapter.url, message);
  }
}

async function loadFootballData(): Promise<SourceFetchResult> {
  const adapter = RESULT_ADAPTERS.find((item) => item.id === "football-data");
  if (!adapter) {
    throw new Error("footballdata.io adapter is missing");
  }
  const key = footballDataApiKey();
  if (!key) {
    return failed(adapter, adapter.url, "FOOTBALLDATA_API_KEY is not set");
  }
  try {
    const configured = process.env.FOOTBALLDATA_LEAGUE_ID?.trim() ?? "";
    let leagueId = configured;
    if (leagueId && !/^\d+$/.test(leagueId)) {
      return failed(adapter, adapter.url, "FOOTBALLDATA_LEAGUE_ID must be a number");
    }
    if (!leagueId) {
      const leagues = await footballDataJson("/leagues?country=Russia&search=Premier", key);
      if (!leagues.ok) {
        return failed(adapter, `${API_BASE}/leagues`, leagues.error ?? "Request failed");
      }
      let found = russianPremierLeagueId(leagues.body);
      if (!found.id && found.error === "Russian Premier League was not in the footballdata.io league list") {
        const broader = await footballDataJson("/leagues?country=Russia", key);
        if (!broader.ok) {
          return failed(adapter, `${API_BASE}/leagues`, broader.error ?? "Request failed");
        }
        found = russianPremierLeagueId(broader.body);
      }
      if (!found.id) {
        return failed(adapter, `${API_BASE}/leagues`, found.error ?? "Russian Premier League was not found");
      }
      leagueId = found.id;
    }
    const seasonId = process.env.FOOTBALLDATA_SEASON_ID?.trim() ?? "";
    const seasonQuery = /^\d+$/.test(seasonId) ? `&season_id=${seasonId}` : "";
    const matches: unknown[] = [];
    let url = `${API_BASE}/leagues/${leagueId}/matches`;
    for (let page = 1; page <= 15; page += 1) {
      const path = `/leagues/${leagueId}/matches?status=complete&limit=100&page=${page}${seasonQuery}`;
      url = `${API_BASE}${path}`;
      const response = await footballDataJson(path, key);
      if (!response.ok) {
        return failed(adapter, url, response.error ?? "Request failed");
      }
      const rows = matchList(response.body);
      matches.push(...rows);
      if (rows.length < 100) {
        break;
      }
    }
    return interpretSourcePage({ ...adapter, url }, true, JSON.stringify({ success: true, data: { matches } }), null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return failed(adapter, adapter.url, message);
  }
}
