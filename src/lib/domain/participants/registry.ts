import { prisma } from "@/lib/db/prisma";
import { applyRosterAction, canPermanentlyDelete, type MembershipState } from "./roster";
import { normalizeParticipantName } from "./identity";

function displayName(value: string): string {
  const name = value.trim();
  if (!name || !normalizeParticipantName(name)) {
    throw new Error("Participant name is required");
  }
  return name;
}

export async function findParticipantByName(value: string) {
  const key = normalizeParticipantName(value);
  if (!key) {
    return null;
  }
  const direct = await prisma.participant.findUnique({ where: { normalizedName: key } });
  if (direct) {
    return direct;
  }
  const alias = await prisma.participantAlias.findUnique({
    where: { normalized: key },
    include: { participant: true },
  });
  return alias?.participant ?? null;
}

export async function ensureAlias(participantName: string, alias: string): Promise<void> {
  const owner = await findParticipantByName(participantName);
  const key = normalizeParticipantName(alias);
  if (!owner || !key || key === owner.normalizedName) {
    return;
  }
  const taken = await findParticipantByName(alias);
  if (taken) {
    return;
  }
  await prisma.participantAlias.create({
    data: { participantId: owner.id, alias: alias.trim(), normalized: key, isPrimary: false },
  });
}

export async function createParticipant(value: string) {
  const name = displayName(value);
  const key = normalizeParticipantName(name);
  const existing = await findParticipantByName(name);
  if (existing) {
    throw new Error("A participant with that name already exists");
  }
  return prisma.participant.create({
    data: {
      name,
      forumNick: name,
      normalizedName: key,
      aliases: { create: { alias: name, normalized: key, isPrimary: true } },
    },
  });
}

export async function updateParticipantName(participantId: string, value: string): Promise<void> {
  const name = displayName(value);
  const key = normalizeParticipantName(name);
  const current = await prisma.participant.findUniqueOrThrow({
    where: { id: participantId },
    include: { aliases: true },
  });
  const owner = await findParticipantByName(name);
  if (owner && owner.id !== current.id) {
    throw new Error("Another participant already uses that name");
  }

  const blocking = current.aliases.find((alias) => alias.normalized === key && !alias.isPrimary);
  if (blocking) {
    await prisma.participantAlias.delete({ where: { id: blocking.id } });
  }

  const nickWasName = normalizeParticipantName(current.forumNick ?? "") === current.normalizedName;
  await prisma.participant.update({
    where: { id: current.id },
    data: {
      name,
      normalizedName: key,
      forumNick: nickWasName ? name : current.forumNick,
    },
  });

  const primary = current.aliases.find((alias) => alias.isPrimary);
  if (primary) {
    await prisma.participantAlias.update({
      where: { id: primary.id },
      data: { alias: name, normalized: key, isPrimary: true },
    });
  } else {
    await prisma.participantAlias.create({
      data: { participantId: current.id, alias: name, normalized: key, isPrimary: true },
    });
  }
}

export async function addParticipantAlias(participantId: string, value: string): Promise<void> {
  const alias = displayName(value);
  const key = normalizeParticipantName(alias);
  await prisma.participant.findUniqueOrThrow({ where: { id: participantId } });
  const owner = await findParticipantByName(alias);
  if (owner?.id === participantId) {
    throw new Error("That alias is already on this participant");
  }
  if (owner) {
    throw new Error("That name already belongs to another participant");
  }
  await prisma.participantAlias.create({
    data: { participantId, alias, normalized: key, isPrimary: false },
  });
}

export async function removeParticipantAlias(aliasId: string): Promise<void> {
  const alias = await prisma.participantAlias.findUniqueOrThrow({ where: { id: aliasId } });
  if (alias.isPrimary) {
    throw new Error("The primary name stays on the participant. Edit the name instead");
  }
  await prisma.participantAlias.delete({ where: { id: alias.id } });
}

function membershipState(status: string | null): MembershipState {
  if (status === "included" || status === "excluded") {
    return status;
  }
  return "absent";
}

export async function setRosterStatus(
  participantId: string,
  seasonId: string,
  action: "include" | "exclude",
): Promise<void> {
  const participant = await prisma.participant.findUniqueOrThrow({ where: { id: participantId } });
  const existing = await prisma.seasonParticipant.findUnique({
    where: { seasonId_participantId: { seasonId, participantId } },
  });
  const decision = applyRosterAction({
    archived: participant.archivedAt != null,
    membership: membershipState(existing?.status ?? null),
    action,
  });
  if (decision.error) {
    throw new Error(decision.error);
  }
  if (decision.membership === "included") {
    await prisma.seasonParticipant.upsert({
      where: { seasonId_participantId: { seasonId, participantId } },
      create: { seasonId, participantId, status: "included" },
      update: { status: "included", excludedAt: null },
    });
    return;
  }
  if (decision.membership === "excluded" && existing) {
    await prisma.seasonParticipant.update({
      where: { id: existing.id },
      data: { status: "excluded", excludedAt: new Date() },
    });
  }
}

export async function archiveParticipant(participantId: string): Promise<void> {
  await prisma.participant.update({
    where: { id: participantId },
    data: { archivedAt: new Date() },
  });
  await prisma.seasonParticipant.updateMany({
    where: { participantId, status: "included" },
    data: { status: "excluded", excludedAt: new Date() },
  });
}

export async function restoreParticipant(participantId: string): Promise<void> {
  await prisma.participant.update({
    where: { id: participantId },
    data: { archivedAt: null },
  });
}

export async function deleteParticipantPermanently(participantId: string): Promise<void> {
  const [predictionSets, roundScores, snapshots] = await Promise.all([
    prisma.predictionSet.count({ where: { participantId } }),
    prisma.roundScore.count({ where: { participantId } }),
    prisma.standingSnapshot.count({ where: { participantId } }),
  ]);
  if (!canPermanentlyDelete({ predictionSets, roundScores, snapshots })) {
    throw new Error("This participant has predictions or standings. Archive them instead");
  }
  await prisma.participant.delete({ where: { id: participantId } });
}

/** Move nickname keys onto the surviving participant before the source row is removed. */
export async function transferIdentity(sourceId: string, targetId: string): Promise<void> {
  const [source, target] = await Promise.all([
    prisma.participant.findUniqueOrThrow({ where: { id: sourceId }, include: { aliases: true } }),
    prisma.participant.findUniqueOrThrow({ where: { id: targetId }, include: { aliases: true } }),
  ]);
  const taken = new Set<string>(
    [target.normalizedName, ...target.aliases.map((alias) => alias.normalized)].filter((key): key is string => Boolean(key)),
  );
  for (const alias of source.aliases) {
    if (taken.has(alias.normalized)) {
      await prisma.participantAlias.delete({ where: { id: alias.id } });
      continue;
    }
    await prisma.participantAlias.update({
      where: { id: alias.id },
      data: { participantId: targetId, isPrimary: false },
    });
    taken.add(alias.normalized);
  }
  if (source.normalizedName && !taken.has(source.normalizedName)) {
    await prisma.participantAlias.create({
      data: {
        participantId: targetId,
        alias: source.name,
        normalized: source.normalizedName,
        isPrimary: false,
      },
    });
  }
}
