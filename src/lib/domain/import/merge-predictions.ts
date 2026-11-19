export interface MergePrediction {
  matchId: string;
  home: number | null;
  away: number | null;
  ignored: boolean;
  warning: string | null;
}

export interface MergeSet {
  id: string;
  postedAt: Date | null;
  manual: boolean;
  predictions: readonly MergePrediction[];
}

export type MergedCell =
  | { matchId: string; state: "selected"; home: number; away: number; setId: string }
  | { matchId: string; state: "review"; setIds: string[] }
  | { matchId: string; state: "missing" };

function scored(prediction: MergePrediction): prediction is MergePrediction & { home: number; away: number } {
  return !prediction.ignored && prediction.home != null && prediction.away != null;
}

/**
 * Combine comments for one participant.
 * The same score from several comments is one cell.
 * Different scores for one fixture stay in review and do not block the other fixtures.
 * A manual set is the whole effective slip and is not filled from later imports.
 */
export function mergePredictionCells(fixtureIds: readonly string[], sets: readonly MergeSet[]): MergedCell[] {
  const manual = sets.filter((set) => set.manual);
  const source = manual.length > 0 ? manual : sets;
  return fixtureIds.map((matchId) => {
    const hits = source.flatMap((set) => {
      const prediction = set.predictions.find((item) => item.matchId === matchId);
      return prediction && scored(prediction) ? [{ set, prediction }] : [];
    });
    if (hits.length === 0) {
      return { matchId, state: "missing" as const };
    }
    const same = hits.every((hit) => hit.prediction.home === hits[0]?.prediction.home && hit.prediction.away === hits[0]?.prediction.away);
    if (!same) {
      return { matchId, state: "review" as const, setIds: hits.map((hit) => hit.set.id) };
    }
    const earliest = [...hits].sort((left, right) => {
      const leftTime = left.set.postedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.set.postedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.set.id.localeCompare(right.set.id);
    })[0] as (typeof hits)[number];
    return {
      matchId,
      state: "selected" as const,
      home: earliest.prediction.home,
      away: earliest.prediction.away,
      setId: earliest.set.id,
    };
  });
}

export function submissionLabel(cells: readonly MergedCell[], fixtureCount: number): string {
  const scoredCount = cells.filter((cell) => cell.state === "selected").length;
  return `${scoredCount}/${fixtureCount} predictions`;
}
