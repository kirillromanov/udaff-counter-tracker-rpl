import { prisma } from "@/lib/db/prisma";
import { matchCheckpointRows, parseStandingsCheckpoint } from "./parse-checkpoint";

export async function saveManualCheckpoint(input: {
  seasonId: string;
  afterRoundNumber: number;
  label: string;
  rawText: string;
}): Promise<{ matched: number; unmatched: string[] }> {
  const parsed = parseStandingsCheckpoint(input.rawText);
  const participants = await prisma.participant.findMany({ include: { aliases: true } });
  const identities = participants.flatMap((participant) => {
    const keys = [participant.normalizedName, ...participant.aliases.map((alias) => alias.normalized)].filter(
      (key): key is string => Boolean(key),
    );
    return keys.map((normalized) => ({ participantId: participant.id, normalized }));
  });
  const rows = matchCheckpointRows(parsed, identities);
  const unmatched = rows.filter((row) => !row.participantId).map((row) => row.displayName);

  await prisma.standingsCheckpoint.deleteMany({
    where: { seasonId: input.seasonId, afterRoundNumber: input.afterRoundNumber, source: "manual" },
  });
  await prisma.standingsCheckpoint.create({
    data: {
      seasonId: input.seasonId,
      afterRoundNumber: input.afterRoundNumber,
      source: "manual",
      label: input.label,
      rawText: input.rawText,
      rows: {
        create: rows.map((row) => ({
          participantId: row.participantId,
          rank: row.rank,
          movement: row.movement,
          movementDelta: row.movementDelta,
          previousRank: row.previousRank,
          displayName: row.displayName,
          totalPoints: row.totalPoints,
          markerCount: row.markerCount,
          rawLine: row.rawLine,
        })),
      },
    },
  });

  return { matched: rows.length - unmatched.length, unmatched };
}
