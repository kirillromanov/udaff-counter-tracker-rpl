import { prisma } from "@/lib/db/prisma";
import { recalculateRound } from "./recalculate-round";
import { computedRebuildBlocker } from "./reconcile";

/**
 * Scores archived rounds through the trusted baseline for a reference comparison.
 * Does not publish production standings and does not change the checkpoint.
 * Does nothing when any of those rounds is incomplete.
 */
export async function rebuildComputedStandings(seasonId: string, afterRoundNumber: number): Promise<number> {
  const rounds = await prisma.round.findMany({
    where: { seasonId, number: { lte: afterRoundNumber } },
    orderBy: { number: "asc" },
    include: {
      matches: true,
      predictionSets: { where: { selected: true }, select: { id: true } },
    },
  });
  const blocker = computedRebuildBlocker(
    rounds.map((round) => ({
      number: round.number,
      fixtureCount: round.matches.length,
      scoredFixtureCount: round.matches.filter((match) => match.actualHomeGoals != null && match.actualAwayGoals != null)
        .length,
      selectedCount: round.predictionSets.length,
    })),
  );
  if (blocker) {
    throw new Error(blocker);
  }
  let scored = 0;
  for (const round of rounds) {
    scored += await recalculateRound(round.id);
  }
  return scored;
}
