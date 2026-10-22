export interface SourceMatch {
  source: string;
  sourceKey: string;
  roundNumber: number | null;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

export interface SourceAdapter {
  id: string;
  role: "primary" | "fallback";
  url: string;
  parse: (html: string) => SourceMatch[];
}

export interface SourceFetchResult {
  source: string;
  role: "primary" | "fallback";
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
