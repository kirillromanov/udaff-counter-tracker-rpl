import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { parseStoredComments } from "@/lib/domain/import/persist-import";
import { recalculateRound } from "@/lib/domain/standings/recalculate-round";

try {
  loadEnvFile();
} catch {
  // DATABASE_URL may already be set.
}

async function main() {
  const season = await prisma.season.findFirst({ orderBy: { name: "asc" } });
  if (!season) {
    throw new Error("No season found.");
  }
  const rounds = await prisma.round.findMany({
    where: { seasonId: season.id, number: { gte: 1, lte: 13 } },
    orderBy: { number: "asc" },
    include: { _count: { select: { forumComments: true, matches: true } } },
  });
  for (const round of rounds) {
    if (round._count.forumComments === 0) {
      console.log(`Round ${round.number}: partial — no stored comments.`);
      continue;
    }
    const parsed = await parseStoredComments(round.id, { force: true });
    console.log(`Round ${round.number}: reparsed ${parsed} comments.`);
    if (round._count.matches === 0) {
      console.log(`Round ${round.number}: partial — no fixtures to score.`);
      continue;
    }
    try {
      const stored = (await recalculateRound(round.id)).participants;
      console.log(`Round ${round.number}: complete. scored ${stored} roster rows.`);
    } catch (error) {
      console.log(`Round ${round.number}: partial — ${error instanceof Error ? error.message : "not scored"}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
