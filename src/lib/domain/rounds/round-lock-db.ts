import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { OPERATIONAL_ROUND } from "@/lib/domain/standings/round-role";
import { RoundClosedError, planClose, planReopen } from "./round-lock";

/** Shared guard for every round-data mutation. Closing and reopening do not use this. */
export async function assertRoundMutable(roundId: string): Promise<void> {
  const round = await prisma.round.findUnique({ where: { id: roundId }, select: { closedAt: true } });
  if (!round) {
    throw new Error("Round not found");
  }
  if (round.closedAt) {
    throw new RoundClosedError();
  }
}

export async function assertRoundsMutable(roundIds: readonly string[]): Promise<void> {
  const ids = [...new Set(roundIds)];
  if (ids.length === 0) {
    return;
  }
  const closed = await prisma.round.findFirst({
    where: { id: { in: ids }, closedAt: { not: null } },
    select: { id: true },
  });
  if (closed) {
    throw new RoundClosedError();
  }
}

/** Read the lock inside the write transaction so a close that committed first wins. */
export async function assertRoundMutableTx(tx: Prisma.TransactionClient, roundId: string): Promise<void> {
  const round = await tx.round.findUnique({ where: { id: roundId }, select: { closedAt: true } });
  if (!round) {
    throw new Error("Round not found");
  }
  if (round.closedAt) {
    throw new RoundClosedError();
  }
}

export async function closedRoundIdSet(roundIds: readonly string[]): Promise<Set<string>> {
  if (roundIds.length === 0) {
    return new Set();
  }
  const rows = await prisma.round.findMany({
    where: { id: { in: [...roundIds] }, closedAt: { not: null } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

export async function closeProductionRound(roundId: string, at = new Date()): Promise<{ changed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const round = await tx.round.findUniqueOrThrow({
      where: { id: roundId },
      select: { standingRole: true, closedAt: true, closureLog: true },
    });
    const next = planClose(
      { standingRole: round.standingRole, closedAt: round.closedAt, closureLog: round.closureLog },
      at,
    );
    if (!next.changed) {
      return { changed: false };
    }
    await tx.round.update({
      where: { id: roundId },
      data: { closedAt: next.closedAt, closureLog: next.closureLog },
    });
    return { changed: true };
  });
}

export async function reopenProductionRound(roundId: string, at = new Date()): Promise<{ changed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const round = await tx.round.findUniqueOrThrow({
      where: { id: roundId },
      select: { standingRole: true, closedAt: true, closureLog: true },
    });
    if (round.standingRole !== OPERATIONAL_ROUND) {
      throw new Error("Only a production round can be reopened.");
    }
    const next = planReopen(
      { standingRole: round.standingRole, closedAt: round.closedAt, closureLog: round.closureLog },
      at,
    );
    if (!next.changed) {
      return { changed: false };
    }
    await tx.round.update({
      where: { id: roundId },
      data: { closedAt: null, closureLog: next.closureLog },
    });
    return { changed: true };
  });
}
