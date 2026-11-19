export interface CellScore {
  home: number;
  away: number;
}

export interface CorrectionEntry {
  at: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export function parseCellScore(value: string): CellScore | null {
  const text = value.trim();
  if (!text || text === "—" || text === "-") {
    return null;
  }
  const match = /^(\d{1,2})\s*[-:]\s*(\d{1,2})$/.exec(text);
  if (!match) {
    throw new Error(`A prediction must look like 2-1. “${text}” was not saved.`);
  }
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home > 12 || away > 12) {
    throw new Error("Goals must be 12 or fewer.");
  }
  return { home, away };
}

export function formatCellScore(home: number | null, away: number | null, ignored: boolean): string {
  if (ignored || home == null || away == null) {
    return "";
  }
  return `${home}-${away}`;
}

export function revisionToken(updatedAt: Date | null): string {
  return updatedAt ? String(updatedAt.getTime()) : "new";
}

export function revisionsMatch(stored: string, submitted: string): boolean {
  return stored === submitted;
}

export function appendCorrection(logJson: string, entry: CorrectionEntry): string {
  let current: CorrectionEntry[] = [];
  try {
    const parsed = JSON.parse(logJson) as unknown;
    if (Array.isArray(parsed)) {
      current = parsed.filter((item): item is CorrectionEntry => {
        return Boolean(item && typeof item === "object" && "field" in item);
      });
    }
  } catch {
    current = [];
  }
  return JSON.stringify([...current, entry].slice(-40));
}

export function scoreLabel(home: number | null, away: number | null): string {
  if (home == null || away == null) {
    return "missing";
  }
  return `${home}-${away}`;
}
