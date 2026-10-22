import { prisma } from "@/lib/db/prisma";
import { standingRoleForRound } from "./round-role";

/** Mark every round covered by the latest manual checkpoint as archived reference data. */
export async function syncRoundStandingRoles(seasonId: string): Promise<void> {
  const [checkpoint, rounds] = await Promise.all([
    prisma.standingsCheckpoint.findFirst({
      where: { seasonId, source: "manual" },
      orderBy: { afterRoundNumber: "desc" },
      select: { afterRoundNumber: true },
    }),
    prisma.round.findMany({ where: { seasonId }, select: { id: true, number: true, standingRole: true } }),
  ]);
  const baselineAfterRound = checkpoint?.afterRoundNumber ?? null;
  for (const round of rounds) {
    const role = standingRoleForRound(round.number, baselineAfterRound);
    if (round.standingRole === role) {
      continue;
    }
    await prisma.round.update({ where: { id: round.id }, data: { standingRole: role } });
  }
}
