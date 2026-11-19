import { commentEditEvidence } from "@/lib/domain/forum/comment-edit";
import { fixtureDeadline } from "@/lib/domain/import/fixture-deadline";

export interface MergePrediction {
  matchId: string;
  home: number | null;
  away: number | null;
  ignored: boolean;
  warning: string | null;
}

export interface MergeFixture {
  id: string;
  kickoffAt: Date | null;
}

export interface MergeSet {
  id: string;
  /** Publication time. Never a fetch or import time. */
  postedAt: Date | null;
  /** Reliable edit time from comment metadata. Absent means the publication time stands. */
  editedAt?: Date | null;
  rawHtml?: string | null;
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

function authorityAt(set: MergeSet): Date | null {
  return set.editedAt ?? commentEditEvidence(set.rawHtml ?? "", set.postedAt).editedAt ?? set.postedAt;
}

/**
 * One cell per fixture.
 * A later eligible comment replaces only the fixtures it contains.
 * A comment at or after kickoff does not replace an earlier eligible prediction.
 * The same score stays on the earliest eligible comment.
 * Equal publication times that disagree stay in review.
 * A manual set is the whole slip.
 */
export function mergePredictionCells(fixtures: readonly MergeFixture[], sets: readonly MergeSet[]): MergedCell[] {
  const manual = sets.filter((set) => set.manual);
  const source = manual.length > 0 ? manual : sets;
  return fixtures.map((fixture) => {
    const hits = source.flatMap((set) => {
      const prediction = set.predictions.find((item) => item.matchId === fixture.id);
      return prediction && scored(prediction) ? [{ set, prediction, at: authorityAt(set) }] : [];
    });
    if (hits.length === 0) {
      return { matchId: fixture.id, state: "missing" as const };
    }
    if (manual.length > 0) {
      return manualCell(fixture.id, hits);
    }
    const eligible = hits.filter((hit) => fixtureDeadline(hit.at, fixture.kickoffAt) === "eligible");
    const unknown = hits.filter((hit) => fixtureDeadline(hit.at, fixture.kickoffAt) === "unknown");
    if (eligible.length === 0) {
      return unknown.length > 0
        ? { matchId: fixture.id, state: "review" as const, setIds: unknown.map((hit) => hit.set.id) }
        : { matchId: fixture.id, state: "missing" as const };
    }
    const sameScore = eligible.every(
      (hit) => hit.prediction.home === eligible[0]?.prediction.home && hit.prediction.away === eligible[0]?.prediction.away,
    );
    if (sameScore) {
      const earliest = [...eligible].sort((left, right) => {
        const leftTime = left.at?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = right.at?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.set.id.localeCompare(right.set.id);
      })[0] as (typeof eligible)[number];
      return chosenCell(fixture.id, earliest);
    }
    const latestTime = Math.max(...eligible.map((hit) => hit.at?.getTime() ?? 0));
    const latest = eligible.filter((hit) => hit.at?.getTime() === latestTime);
    const latestAgree = latest.every(
      (hit) => hit.prediction.home === latest[0]?.prediction.home && hit.prediction.away === latest[0]?.prediction.away,
    );
    if (!latestAgree) {
      return { matchId: fixture.id, state: "review" as const, setIds: latest.map((hit) => hit.set.id) };
    }
    const chosen = [...latest].sort((left, right) => left.set.id.localeCompare(right.set.id))[0] as (typeof latest)[number];
    return chosenCell(fixture.id, chosen);
  });
}

function chosenCell(
  matchId: string,
  hit: { set: MergeSet; prediction: MergePrediction & { home: number; away: number } },
): MergedCell {
  return { matchId, state: "selected", home: hit.prediction.home, away: hit.prediction.away, setId: hit.set.id };
}

function manualCell(
  matchId: string,
  hits: { set: MergeSet; prediction: MergePrediction & { home: number; away: number } }[],
): MergedCell {
  const same = hits.every((hit) => hit.prediction.home === hits[0]?.prediction.home && hit.prediction.away === hits[0]?.prediction.away);
  if (!same) {
    return { matchId, state: "review", setIds: hits.map((hit) => hit.set.id) };
  }
  const earliest = [...hits].sort((left, right) => {
    const leftTime = left.set.postedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightTime = right.set.postedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.set.id.localeCompare(right.set.id);
  })[0] as (typeof hits)[number];
  return chosenCell(matchId, earliest);
}

export function submissionLabel(cells: readonly MergedCell[], fixtureCount: number): string {
  const scoredCount = cells.filter((cell) => cell.state === "selected").length;
  return `${scoredCount}/${fixtureCount} predictions`;
}
