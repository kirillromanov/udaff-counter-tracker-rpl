import { prisma } from "@/lib/db/prisma";
import { normalizeParticipantName } from "@/lib/domain/participants/identity";
import { matchCheckpointRows, parseStandingsCheckpoint } from "./parse-checkpoint";
import { syncRoundStandingRoles } from "./sync-round-roles";

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
  const owners = new Map<string, Set<string>>();
  for (const identity of identities) {
    const ids = owners.get(identity.normalized) ?? new Set<string>();
    ids.add(identity.participantId);
    owners.set(identity.normalized, ids);
  }
  const ambiguous = parsed.flatMap((row) => {
    const key = normalizeParticipantName(row.displayName);
    const ids = [...(owners.get(key) ?? [])];
    return ids.length > 1 ? [`${row.displayName} matches ${ids.join(", ")}`] : [];
  });
  if (ambiguous.length > 0) {
    throw new Error(`Baseline identity is ambiguous. Nothing was written. ${ambiguous.join("; ")}`);
  }

  const rows = matchCheckpointRows(parsed, identities);
  const unmatched = rows.filter((row) => !row.participantId).map((row) => row.displayName);
  const existing = await prisma.standingsCheckpoint.findFirst({
    where: { seasonId: input.seasonId, afterRoundNumber: input.afterRoundNumber, source: "manual" },
    select: { rawText: true, label: true },
  });
  if (existing?.rawText === input.rawText && existing.label === input.label) {
    await syncRoundStandingRoles(input.seasonId);
    return { matched: rows.length - unmatched.length, unmatched };
  }

  await prisma.$transaction([
    prisma.standingsCheckpoint.deleteMany({
      where: { seasonId: input.seasonId, afterRoundNumber: input.afterRoundNumber, source: "manual" },
    }),
    prisma.standingsCheckpoint.create({
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
    }),
  ]);

  await syncRoundStandingRoles(input.seasonId);
  return { matched: rows.length - unmatched.length, unmatched };
}
