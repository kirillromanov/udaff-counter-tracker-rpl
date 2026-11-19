import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { pollDueRounds } from "@/lib/domain/results/poll-run";

try {
  loadEnvFile();
} catch {
  // Next.js loads .env for the app. The file is optional for this script.
}

async function main() {
  const report = await pollDueRounds();
  if (!report.checked) {
    console.log("No round is due. Finalized rounds are recorded as stopped, and no sources were fetched.");
    return;
  }
  for (const season of report.seasons) {
    const { report: result } = season;
    console.log(
      `${result.verified} verified, ${result.confirmed} provisional, ${result.conflicts} need review, ${result.insufficient} insufficient`,
    );
    for (const source of result.sources) {
      console.log(`  ${source.role} ${source.source}: ${source.status} (${source.matchCount})${source.error ? ` ${source.error}` : ""}`);
    }
  }
  const rounds = await prisma.round.findMany({
    where: { id: { in: report.roundIds } },
    orderBy: { number: "asc" },
    select: { number: true, pollStatus: true, nextPollAt: true, lastSuccessfulSource: true },
  });
  for (const round of rounds) {
    console.log(
      `Round ${round.number}: ${round.pollStatus}, next ${round.nextPollAt ? round.nextPollAt.toISOString() : "stopped"}, last success ${round.lastSuccessfulSource ?? "none"}`,
    );
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
