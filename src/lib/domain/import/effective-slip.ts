import { mergePredictionCells, submissionLabel, type MergedCell } from "./merge-predictions";

export interface SlipFixture {
  id: string;
  kickoffAt: Date | null;
}

export interface StoredSlipSet {
  id: string;
  participantId: string;
  selection: string;
  manuallyEdited: boolean;
  createdAt: Date;
  /** Publication time. A missing value is unknown; import time is not a substitute. */
  postedAt: Date | null;
  rawHtml?: string | null;
  predictions: {
    matchId: string;
    homeGoals: number | null;
    awayGoals: number | null;
    ignored: boolean;
    warning?: string | null;
  }[];
}

export interface EffectiveSlip {
  participantId: string;
  cells: MergedCell[];
  predictions: { matchId: string; home: number; away: number }[];
  unresolvedMatchIds: string[];
  label: string;
}

/** One effective slip per participant from every selected comment. */
export function slipsByParticipant(fixtures: readonly SlipFixture[], sets: readonly StoredSlipSet[]): EffectiveSlip[] {
  const groups = new Map<string, StoredSlipSet[]>();
  for (const set of sets) {
    const list = groups.get(set.participantId) ?? [];
    list.push(set);
    groups.set(set.participantId, list);
  }
  return [...groups.entries()].map(([participantId, group]) => {
    const cells = mergePredictionCells(
      fixtures.map((fixture) => ({ id: fixture.id, kickoffAt: fixture.kickoffAt })),
      group.map((set) => ({
        id: set.id,
        postedAt: set.postedAt,
        rawHtml: set.rawHtml,
        manual: set.selection === "manual" || set.manuallyEdited,
        predictions: set.predictions.map((prediction) => ({
          matchId: prediction.matchId,
          home: prediction.homeGoals,
          away: prediction.awayGoals,
          ignored: prediction.ignored,
          warning: prediction.warning ?? null,
        })),
      })),
    );
    return {
      participantId,
      cells,
      predictions: cells.flatMap((cell) => (cell.state === "selected" ? [{ matchId: cell.matchId, home: cell.home, away: cell.away }] : [])),
      unresolvedMatchIds: cells.flatMap((cell) => (cell.state === "review" ? [cell.matchId] : [])),
      label: submissionLabel(cells, fixtures.length),
    };
  });
}
