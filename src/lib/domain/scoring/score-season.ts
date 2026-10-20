import { rankMovement } from "./movement";
import type {
  SeasonRoundInput,
  SeasonStanding,
  SeasonStandingInput,
} from "./types";

function totalPoints(participantId: string, rounds: SeasonRoundInput[]): number {
  return rounds.reduce((total, round) => {
    const score = round.scores.find((entry) => entry.participantId === participantId);
    return total + (score?.points ?? 0);
  }, 0);
}

/**
 * A round win is a submitted score equal to that round's maximum.
 * Ties share the win. A participant with no score does not win the round,
 * even when their implicit 0 would beat the recorded scores.
 */
function roundWins(participantId: string, rounds: SeasonRoundInput[]): number {
  let wins = 0;

  for (const round of rounds) {
    const score = round.scores.find((entry) => entry.participantId === participantId);
    if (!score || round.scores.length === 0) {
      continue;
    }
    const max = Math.max(...round.scores.map((entry) => entry.points));
    if (score.points === max) {
      wins += 1;
    }
  }

  return wins;
}

function compareStandings(a: SeasonStanding, b: SeasonStanding): number {
  if (b.totalPoints !== a.totalPoints) {
    return b.totalPoints - a.totalPoints;
  }
  if (b.roundWins !== a.roundWins) {
    return b.roundWins - a.roundWins;
  }
  const byName = a.participantName.localeCompare(b.participantName);
  if (byName !== 0) {
    return byName;
  }
  return a.participantId.localeCompare(b.participantId);
}

function rankRows(
  input: SeasonStandingInput,
  rounds: SeasonRoundInput[],
): SeasonStanding[] {
  const rows: SeasonStanding[] = input.participants.map((participant) => ({
    participantId: participant.id,
    participantName: participant.name,
    totalPoints: totalPoints(participant.id, rounds),
    roundWins: roundWins(participant.id, rounds),
    rank: 0,
    previousRank: null,
    movement: "new",
  }));

  rows.sort(compareStandings);
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return rows;
}

export function buildSeasonStandings(input: SeasonStandingInput): SeasonStanding[] {
  const rounds = [...input.rounds].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.roundId.localeCompare(b.roundId);
  });

  const current = rankRows(input, rounds);
  const hasPrevious = rounds.length > 1;
  const previousRanks = new Map<string, number>();

  if (hasPrevious) {
    for (const row of rankRows(input, rounds.slice(0, -1))) {
      previousRanks.set(row.participantId, row.rank);
    }
  }

  return current.map((row) => {
    const previousRank = hasPrevious
      ? (previousRanks.get(row.participantId) ?? null)
      : null;

    return {
      ...row,
      previousRank,
      movement: rankMovement(row.rank, previousRank),
    };
  });
}
