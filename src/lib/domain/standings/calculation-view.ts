import type { StoredBreakdown } from "@/lib/domain/export/export-audit";
import { ARCHIVED_ROUND } from "./round-role";

export type CalculationView = "saved-calculation" | "live-selection";

export interface SavedMatchPresentation {
  inCalculation: boolean;
  missing: boolean;
  home: number | null;
  away: number | null;
  points: number | null;
}

export interface LiveMatchPresentation {
  state: "selected" | "review" | "missing";
  home?: number;
  away?: number;
  reason?: "disagreement" | "uncertain-time";
}

/**
 * Archived, closed, and fully scored rounds present the saved calculation.
 * An open or partial production round keeps live selection, including fixtures
 * that were not part of a stored partial score.
 */
export function calculationView(round: {
  standingRole: string;
  closedAt: Date | null;
  status: string;
}): CalculationView {
  if (round.standingRole === ARCHIVED_ROUND || round.closedAt != null || round.status === "scored") {
    return "saved-calculation";
  }
  return "live-selection";
}

export function presentSavedMatch(breakdown: StoredBreakdown | null, label: string): SavedMatchPresentation {
  const match = breakdown?.matches.find((item) => item.label === label);
  if (!match) {
    return { inCalculation: false, missing: false, home: null, away: null, points: null };
  }
  const score = /^(\d+)-(\d+)$/.exec(match.predicted);
  if (!score) {
    return { inCalculation: true, missing: true, home: null, away: null, points: match.finalMatchPoints };
  }
  return {
    inCalculation: true,
    missing: false,
    home: Number(score[1]),
    away: Number(score[2]),
    points: match.finalMatchPoints,
  };
}

export function officialFixture(input: {
  view: CalculationView;
  saved: SavedMatchPresentation;
  live: LiveMatchPresentation | null;
}): { source: "saved" | "live"; home: number | null; away: number | null; missing: boolean; uncertain: boolean; points: number | null; inCalculation: boolean } {
  if (input.view === "saved-calculation") {
    return {
      source: "saved",
      home: input.saved.home,
      away: input.saved.away,
      missing: input.saved.missing,
      uncertain: false,
      points: input.saved.points,
      inCalculation: input.saved.inCalculation,
    };
  }
  if (input.live?.state === "selected") {
    return { source: "live", home: input.live.home ?? null, away: input.live.away ?? null, missing: false, uncertain: false, points: null, inCalculation: false };
  }
  return {
    source: "live",
    home: null,
    away: null,
    missing: input.live?.state !== "review",
    uncertain: input.live?.state === "review",
    points: null,
    inCalculation: false,
  };
}
