import { writeSync } from "node:fs";

/** One plain status line. Callers must not pass secrets or comment text. */
export function formatWorkerLine(event: string, fields: Record<string, string | number | boolean | null>): string {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}=${value ?? ""}`)
    .join(" ");
  return `${new Date().toISOString()} worker ${event}${body ? ` ${body}` : ""}`;
}

/** Write one line immediately. A piped launchd log does not flush console.log. */
export function emitWorkerLine(line: string, write: (text: string) => void = (text) => writeSync(1, text)): void {
  write(line.endsWith("\n") ? line : `${line}\n`);
}
