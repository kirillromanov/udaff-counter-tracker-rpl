import { prisma } from "@/lib/db/prisma";

/** Names, order, and Match of the Round. This write does not touch a score or a result status. */
export async function saveFixtureStructure(details: readonly {
  id: string;
  homeTeam: string;
  awayTeam: string;
  sortOrder: number;
  isMatchOfTheRound: boolean;
}[]): Promise<void> {
  for (const detail of details) {
    await prisma.match.update({
      where: { id: detail.id },
      data: {
        homeTeam: detail.homeTeam,
        awayTeam: detail.awayTeam,
        sortOrder: detail.sortOrder,
        isMatchOfTheRound: detail.isMatchOfTheRound,
      },
    });
  }
}
