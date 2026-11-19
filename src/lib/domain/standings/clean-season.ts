import { buildProductionStandings } from "@/lib/domain/scoring/production-standings";
import type { Movement } from "@/lib/domain/scoring/types";
import { rankMovement } from "@/lib/domain/scoring/movement";

export interface CleanBaselineRow {
  participantId: string | null;
  name: string;
  points: number;
  medals: number;
  rank: number;
  movement: string;
  previousRank: number | null;
}

export interface CleanRoundInput {
  roundId: string;
  order: number;
  scores: { participantId: string; points: number }[];
}

export interface CleanSeasonRow {
  participantId: string;
  name: string;
  rank: number;
  previousRank: number | null;
  movement: string;
  totalPoints: number;
  medals: number;
}

export interface CleanSeasonTable {
  cutoffRound: number | null;
  latestConfirmedRound: number | null;
  movementContext: "baseline-snapshot" | "operational-round";
  rows: CleanSeasonRow[];
  liveRows: CleanSeasonRow[] | null;
}

function dedupeRounds(rounds: readonly CleanRoundInput[], floor: number | null): CleanRoundInput[] {
  const seen = new Set<string>();
  const kept: CleanRoundInput[] = [];
  for (const round of [...rounds].sort((left, right) => left.order - right.order || left.roundId.localeCompare(right.roundId))) {
    if (floor != null && round.order <= floor) {
      continue;
    }
    if (seen.has(round.roundId)) {
      continue;
    }
    seen.add(round.roundId);
    kept.push(round);
  }
  return kept;
}

function snapshotMovement(baseline: readonly CleanBaselineRow[]): Map<string, { movement: string; previousRank: number | null }> {
  const stored = new Map<string, { movement: string; previousRank: number | null }>();
  for (const row of baseline) {
    if (!row.participantId) {
      continue;
    }
    stored.set(row.participantId, { movement: row.movement, previousRank: row.previousRank });
  }
  return stored;
}

/**
 * Confirmed season table: corrected baseline, plus each later finalized round once.
 * With no later round, movement stays the baseline snapshot and is not treated as a new result.
 * Live rounds are returned separately and are not added to the confirmed rows.
 */
export function buildCleanSeasonStandings(input: {
  baselineAfterRound: number | null;
  baseline: readonly CleanBaselineRow[];
  participants: readonly { id: string; name: string }[];
  confirmedRounds: readonly CleanRoundInput[];
  liveRounds?: readonly CleanRoundInput[];
}): CleanSeasonTable {
  const confirmedRounds = dedupeRounds(input.confirmedRounds, input.baselineAfterRound);
  const liveRounds = dedupeRounds(input.liveRounds ?? [], input.baselineAfterRound).filter(
    (round) => !confirmedRounds.some((confirmed) => confirmed.roundId === round.roundId),
  );
  const produced = buildProductionStandings({
    baseline: input.baseline.map((row) => ({
      participantId: row.participantId,
      name: row.name,
      points: row.points,
      medals: row.medals,
      rank: row.rank,
    })),
    participants: input.participants,
    rounds: confirmedRounds,
  });
  const storedMovement = snapshotMovement(input.baseline);
  const useSnapshot = confirmedRounds.length === 0;
  const rows: CleanSeasonRow[] = produced.map((row) => {
    const snapshot = useSnapshot ? storedMovement.get(row.participantId) : null;
    return {
      participantId: row.participantId,
      name: row.participantName,
      rank: row.rank,
      previousRank: snapshot ? snapshot.previousRank : row.previousRank,
      movement: snapshot ? snapshot.movement : row.movement,
      totalPoints: row.totalPoints,
      medals: row.roundWins,
    };
  });

  const liveExtra = new Map<string, number>();
  for (const round of liveRounds) {
    for (const score of round.scores) {
      liveExtra.set(score.participantId, (liveExtra.get(score.participantId) ?? 0) + score.points);
    }
  }
  const liveRows = liveExtra.size === 0 ? null : rankLive(rows, liveExtra);

  return {
    cutoffRound: input.baselineAfterRound,
    latestConfirmedRound: confirmedRounds.at(-1)?.order ?? null,
    movementContext: useSnapshot ? "baseline-snapshot" : "operational-round",
    rows,
    liveRows,
  };
}

function rankLive(confirmed: readonly CleanSeasonRow[], extra: ReadonlyMap<string, number>): CleanSeasonRow[] {
  const confirmedRank = new Map(confirmed.map((row) => [row.participantId, row.rank]));
  const draft = confirmed.map((row) => ({
    ...row,
    totalPoints: row.totalPoints + (extra.get(row.participantId) ?? 0),
  }));
  draft.sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    if (right.medals !== left.medals) {
      return right.medals - left.medals;
    }
    return left.rank - right.rank;
  });
  return draft.map((row, index) => {
    const rank = index + 1;
    const previousRank = confirmedRank.get(row.participantId) ?? null;
    const movement: Movement = rankMovement(rank, previousRank);
    return { ...row, rank, previousRank, movement };
  });
}

export function movementContextLabel(table: Pick<CleanSeasonTable, "movementContext" | "cutoffRound">): string {
  if (table.movementContext === "baseline-snapshot") {
    const round = table.cutoffRound ?? "—";
    return `Movement is the trusted baseline snapshot through round ${round}. The points correction is not a new round.`;
  }
  return "Movement compares this confirmed total with the standings before the latest included round. Both sides use the corrected baseline.";
}

export function confirmedCutoffLabel(table: Pick<CleanSeasonTable, "cutoffRound" | "movementContext" | "latestConfirmedRound">): string {
  if (table.movementContext === "operational-round" && table.latestConfirmedRound != null) {
    return `Confirmed through round ${table.latestConfirmedRound}. The baseline after round ${table.cutoffRound ?? "—"} is included once.`;
  }
  return `Confirmed through round ${table.cutoffRound ?? "—"}. Rounds through that baseline are not added again.`;
}
