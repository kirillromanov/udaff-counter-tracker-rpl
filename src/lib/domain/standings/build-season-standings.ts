import { prisma } from "@/lib/db/prisma";
import { buildSeasonStandings } from "@/lib/domain/scoring/score-season";

export function latestSeasonSnapshot(seasonId: string) {
  return prisma.round.findFirst({
    where: { seasonId, standingSnapshots: { some: {} } },
    orderBy: { number: "desc" },
    include: {
      standingSnapshots: {
        include: { participant: true },
        orderBy: { rank: "asc" },
      },
    },
  });
}

/**
 * Rebuild stored snapshots from round scores.
 * Includes this round and every later round that already has scores,
 * so a recalculation keeps later movement markers honest.
 */
export async function rebuildSeasonSnapshots(seasonId: string, throughRoundNumber: number): Promise<void> {
  const [memberships, rounds] = await Promise.all([
    prisma.seasonParticipant.findMany({
      where: { seasonId },
      include: { participant: true },
    }),
    prisma.round.findMany({
      where: { seasonId },
      orderBy: { number: "asc" },
      include: { roundScores: true },
    }),
  ]);

  const names = new Map(memberships.map((membership) => [membership.participantId, membership.participant.name]));
  const scoredIds = [...new Set(rounds.flatMap((round) => round.roundScores.map((score) => score.participantId)))];
  const missingIds = scoredIds.filter((id) => !names.has(id));
  if (missingIds.length > 0) {
    const extras = await prisma.participant.findMany({ where: { id: { in: missingIds } } });
    for (const participant of extras) {
      names.set(participant.id, participant.name);
    }
  }

  const scoredRounds = rounds.filter((round) => round.roundScores.length > 0);
  const affected = scoredRounds.filter((round) => round.number >= throughRoundNumber);

  for (const round of affected) {
    const history = scoredRounds.filter((candidate) => candidate.number <= round.number);
    const participantIds = [
      ...new Set(history.flatMap((candidate) => candidate.roundScores.map((score) => score.participantId))),
    ];
    const standings = buildSeasonStandings({
      participants: participantIds.map((id) => ({ id, name: names.get(id) ?? id })),
      rounds: history.map((candidate) => ({
        roundId: candidate.id,
        order: candidate.number,
        scores: candidate.roundScores.map((score) => ({
          participantId: score.participantId,
          points: score.totalPoints,
        })),
      })),
    });

    await prisma.standingSnapshot.deleteMany({ where: { roundId: round.id } });
    if (standings.length > 0) {
      await prisma.standingSnapshot.createMany({
        data: standings.map((row) => ({
          seasonId,
          roundId: round.id,
          participantId: row.participantId,
          rank: row.rank,
          previousRank: row.previousRank,
          movement: row.movement,
          totalPoints: row.totalPoints,
          roundWins: row.roundWins,
        })),
      });
    }
  }
}
