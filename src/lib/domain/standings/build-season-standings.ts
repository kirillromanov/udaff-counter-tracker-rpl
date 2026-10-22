import { prisma } from "@/lib/db/prisma";
import { buildProductionStandings } from "@/lib/domain/scoring/production-standings";
import { buildSeasonStandings } from "@/lib/domain/scoring/score-season";
import type { SeasonStanding } from "@/lib/domain/scoring/types";
import { ARCHIVED_ROUND, OPERATIONAL_ROUND } from "./round-role";

/** Latest stored production table. Archived reference snapshots are left out. */
export function latestSeasonSnapshot(seasonId: string) {
  return prisma.round.findFirst({
    where: { seasonId, standingRole: OPERATIONAL_ROUND, standingSnapshots: { some: {} } },
    orderBy: { number: "desc" },
    include: {
      standingSnapshots: {
        include: { participant: true },
        orderBy: { rank: "asc" },
      },
    },
  });
}

async function participantNames(seasonId: string, scoredIds: string[]): Promise<Map<string, string>> {
  const memberships = await prisma.seasonParticipant.findMany({
    where: { seasonId },
    include: { participant: true },
  });
  const names = new Map(memberships.map((membership) => [membership.participantId, membership.participant.name]));
  const missingIds = scoredIds.filter((id) => !names.has(id));
  if (missingIds.length > 0) {
    const extras = await prisma.participant.findMany({ where: { id: { in: missingIds } } });
    for (const participant of extras) {
      names.set(participant.id, participant.name);
    }
  }
  return names;
}

async function writeSnapshots(seasonId: string, roundId: string, standings: SeasonStanding[]): Promise<void> {
  await prisma.standingSnapshot.deleteMany({ where: { roundId } });
  if (standings.length === 0) {
    return;
  }
  await prisma.standingSnapshot.createMany({
    data: standings.map((row) => ({
      seasonId,
      roundId,
      participantId: row.participantId,
      rank: row.rank,
      previousRank: row.previousRank,
      movement: row.movement,
      totalPoints: row.totalPoints,
      roundWins: row.roundWins,
    })),
  });
}

/**
 * Rebuild stored snapshots from this round forward.
 * An archived round stores a diagnostic total of archived rounds only, for reconciliation.
 * An operational round stores the trusted baseline plus operational rounds, and does not rewrite archived snapshots.
 */
export async function rebuildSeasonSnapshots(seasonId: string, throughRoundNumber: number): Promise<void> {
  const rounds = await prisma.round.findMany({
    where: { seasonId },
    orderBy: { number: "asc" },
    include: { roundScores: true },
  });
  const origin = rounds.find((round) => round.number === throughRoundNumber);
  if (!origin) {
    return;
  }
  const scoredIds = [...new Set(rounds.flatMap((round) => round.roundScores.map((score) => score.participantId)))];
  const names = await participantNames(seasonId, scoredIds);

  if (origin.standingRole === ARCHIVED_ROUND) {
    const archived = rounds.filter((round) => round.standingRole === ARCHIVED_ROUND && round.roundScores.length > 0);
    const affected = archived.filter((round) => round.number >= throughRoundNumber);
    for (const round of affected) {
      const history = archived.filter((candidate) => candidate.number <= round.number);
      const participantIds = [...new Set(history.flatMap((candidate) => candidate.roundScores.map((score) => score.participantId)))];
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
      await writeSnapshots(seasonId, round.id, standings);
    }
    return;
  }

  const checkpoint = await prisma.standingsCheckpoint.findFirst({
    where: { seasonId, source: "manual" },
    orderBy: { afterRoundNumber: "desc" },
    include: { rows: true },
  });
  const operational = rounds.filter((round) => round.standingRole === OPERATIONAL_ROUND && round.roundScores.length > 0);
  const affected = operational.filter((round) => round.number >= throughRoundNumber);
  const participants = [...names.entries()].map(([id, name]) => ({ id, name }));
  for (const round of affected) {
    const history = operational.filter((candidate) => candidate.number <= round.number);
    const standings = buildProductionStandings({
      baseline: (checkpoint?.rows ?? []).map((row) => ({
        participantId: row.participantId,
        name: row.participantId ? (names.get(row.participantId) ?? row.displayName) : row.displayName,
        points: row.totalPoints,
        medals: row.markerCount,
        rank: row.rank,
      })),
      participants,
      rounds: history.map((candidate) => ({
        roundId: candidate.id,
        order: candidate.number,
        scores: candidate.roundScores.map((score) => ({
          participantId: score.participantId,
          points: score.totalPoints,
        })),
      })),
    });
    await writeSnapshots(seasonId, round.id, standings);
  }
}
