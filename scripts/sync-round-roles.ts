import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { syncRoundStandingRoles } from "@/lib/domain/standings/sync-round-roles";

try {
  loadEnvFile();
} catch {
  // The app loads .env itself.
}

async function main() {
  const seasons = await prisma.season.findMany({ select: { id: true, slug: true } });
  for (const season of seasons) {
    await syncRoundStandingRoles(season.id);
    const rounds = await prisma.round.findMany({
      where: { seasonId: season.id },
      orderBy: { number: "asc" },
      select: { number: true, standingRole: true },
    });
    console.log(season.slug, rounds.map((round) => `${round.number}:${round.standingRole}`).join(" "));
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
