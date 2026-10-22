import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { ingestSeasonResults } from "@/lib/domain/results/ingest";

try {
  loadEnvFile();
} catch {
  // Next.js loads .env for the app. The file is optional for this script.
}

async function main() {
  const seasons = await prisma.season.findMany({ orderBy: { name: "asc" } });
  if (seasons.length === 0) {
    throw new Error("No season found.");
  }
  for (const season of seasons) {
    const report = await ingestSeasonResults(season.id);
    console.log(`${season.name}: ${report.verified} verified, ${report.confirmed} confirmed, ${report.conflicts} conflicts`);
    for (const source of report.sources) {
      console.log(`  ${source.role} ${source.source}: ${source.status} (${source.matchCount})${source.error ? ` ${source.error}` : ""}`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
