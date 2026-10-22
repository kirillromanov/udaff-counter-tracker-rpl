export type SourceRole = "primary" | "fallback" | "verification";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface SourceMatch {
  source: string;
  sourceKey: string;
  roundNumber: number | null;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  role: SourceRole;
  confidence: ConfidenceLevel;
}

export interface SourceAdapter {
  id: string;
  role: SourceRole;
  /** How much this source is trusted before it is compared with the others. */
  confidence: ConfidenceLevel;
  url: string;
  /** html pages are scraped. json bodies are parsed as an API or data payload. */
  format?: "html" | "json";
  parse: (body: string) => SourceMatch[];
  load?: () => Promise<SourceFetchResult>;
}

export interface SourceFetchResult {
  source: string;
  role: SourceRole;
  url: string;
  status: "ok" | "failed";
  results: SourceMatch[];
  error: string | null;
}

export function isAccessBlocked(html: string): boolean {
  return /доступ запрещен|sberid|выполняется перенаправление/i.test(html);
}

export function stripTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}
