import { prisma } from "../src/lib/db/prisma";
import { importRounds } from "../src/lib/domain/import/batch-import";

async function main() {
  const season = await prisma.season.findFirst({ orderBy: { name: "asc" } });
  if (!season) {
    throw new Error("No season found. Run npm run db:seed first.");
  }
  const reports = await importRounds({ seasonId: season.id });
  for (const report of reports) {
    if (report.error) {
      console.log(`Round ${report.number}: FAILED ${report.error}`);
      continue;
    }
    console.log(
      `Round ${report.number} ${report.name}: ${report.comments} comments, ${report.fixtures} fixtures, ${report.accepted} accepted, ${report.flaggedSets} flagged sets, ${report.unmatchedAuthors} unknown authors`,
    );
    for (const note of report.notes) {
      console.log(`  ${note}`);
    }
  }
  const failed = reports.filter((report) => report.error).length;
  if (failed > 0) {
    throw new Error(`${failed} rounds failed`);
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
