import { rankMovement } from "./movement";
import type { Movement, SeasonStanding } from "./types";

export interface ProductionBaselineRow {
  participantId: string | null;
  name: string;
  points: number;
  medals: number;
  rank: number;
}

export interface ProductionRoundInput {
  roundId: string;
  order: number;
  scores: { participantId: string; points: number }[];
}

interface Accumulated {
  participantId: string;
  name: string;
  totalPoints: number;
  roundWins: number;
  baselineRank: number | null;
}

function compare(left: Accumulated, right: Accumulated): number {
  if (right.totalPoints !== left.totalPoints) {
    return right.totalPoints - left.totalPoints;
  }
  if (right.roundWins !== left.roundWins) {
    return right.roundWins - left.roundWins;
  }
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) {
    return byName;
  }
  return left.participantId.localeCompare(right.participantId);
}

function accumulate(
  baseline: readonly ProductionBaselineRow[],
  participants: readonly { id: string; name: string }[],
  rounds: readonly ProductionRoundInput[],
): Accumulated[] {
  const rows = new Map<string, Accumulated>();
  for (const row of baseline) {
    if (!row.participantId) {
      continue;
    }
    rows.set(row.participantId, {
      participantId: row.participantId,
      name: row.name,
      totalPoints: row.points,
      roundWins: row.medals,
      baselineRank: row.rank,
    });
  }
  for (const participant of participants) {
    const current = rows.get(participant.id);
    if (current) {
      current.name = participant.name;
      continue;
    }
    rows.set(participant.id, {
      participantId: participant.id,
      name: participant.name,
      totalPoints: 0,
      roundWins: 0,
      baselineRank: null,
    });
  }
  for (const round of rounds) {
    if (round.scores.length === 0) {
      continue;
    }
    const max = Math.max(...round.scores.map((score) => score.points));
    for (const score of round.scores) {
      const current = rows.get(score.participantId) ?? {
        participantId: score.participantId,
        name: score.participantId,
        totalPoints: 0,
        roundWins: 0,
        baselineRank: null,
      };
      current.totalPoints += score.points;
      if (score.points === max) {
        current.roundWins += 1;
      }
      rows.set(score.participantId, current);
    }
  }
  return [...rows.values()];
}

function rankRows(rows: readonly Accumulated[]): { participantId: string; rank: number; totalPoints: number; roundWins: number; name: string }[] {
  return [...rows].sort(compare).map((row, index) => ({
    participantId: row.participantId,
    name: row.name,
    totalPoints: row.totalPoints,
    roundWins: row.roundWins,
    rank: index + 1,
  }));
}

/**
 * Production total is the trusted baseline plus finalized operational rounds.
 * The first operational round moves from the baseline's stored rank.
 * Later rounds move from the previous production table.
 */
export function buildProductionStandings(input: {
  baseline: readonly ProductionBaselineRow[];
  participants: readonly { id: string; name: string }[];
  rounds: readonly ProductionRoundInput[];
}): SeasonStanding[] {
  const ordered = [...input.rounds].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.roundId.localeCompare(right.roundId);
  });
  const currentRows = accumulate(input.baseline, input.participants, ordered);
  const current = rankRows(currentRows);
  const baselineRank = new Map(currentRows.map((row) => [row.participantId, row.baselineRank]));
  const previousRanks = new Map<string, number>();
  if (ordered.length > 1) {
    for (const row of rankRows(accumulate(input.baseline, input.participants, ordered.slice(0, -1)))) {
      previousRanks.set(row.participantId, row.rank);
    }
  }

  return current.map((row) => {
    const previousRank = ordered.length > 1 ? (previousRanks.get(row.participantId) ?? null) : (baselineRank.get(row.participantId) ?? null);
    const movement: Movement = rankMovement(row.rank, previousRank);
    return {
      participantId: row.participantId,
      participantName: row.name,
      totalPoints: row.totalPoints,
      roundWins: row.roundWins,
      rank: row.rank,
      previousRank,
      movement,
    };
  });
}
