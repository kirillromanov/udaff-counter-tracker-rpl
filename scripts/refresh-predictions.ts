import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { refreshDuePredictions } from "@/lib/domain/import/refresh-predictions";

try {
  loadEnvFile();
} catch {
  // Next.js loads .env for the app. The file is optional for this script.
}

async function main() {
  const report = await refreshDuePredictions();
  if (!report.checked) {
    console.log("No active round is due. Archived rounds and finalized rounds stay on a manual refresh.");
    return;
  }
  for (const round of report.rounds) {
    console.log(`Round ${round.number}: ${round.summary}`);
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
