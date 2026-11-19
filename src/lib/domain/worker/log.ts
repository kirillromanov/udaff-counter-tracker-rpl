/** One plain status line. Callers must not pass secrets or comment text. */
export function formatWorkerLine(event: string, fields: Record<string, string | number | boolean | null>): string {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}=${value ?? ""}`)
    .join(" ");
  return `${new Date().toISOString()} worker ${event}${body ? ` ${body}` : ""}`;
}
