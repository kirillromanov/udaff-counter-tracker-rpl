import { prisma } from "@/lib/db/prisma";
import { parseStoredComments } from "@/lib/domain/import/persist-import";
import { ensureKnownIdentities } from "@/lib/domain/participants/registry";

async function main() {
  await ensureKnownIdentities();
  const rounds = await prisma.round.findMany({ orderBy: { number: "asc" }, select: { id: true, number: true } });
  for (const round of rounds) {
    const parsed = await parseStoredComments(round.id);
    console.log(`Round ${round.number}: reviewed ${parsed} comments`);
  }
  const [participants, ignored, aliases] = await Promise.all([
    prisma.participant.count(),
    prisma.ignoredForumAuthor.count(),
    prisma.participantAlias.count({ where: { isPrimary: false } }),
  ]);
  console.log(`Participants ${participants}, extra aliases ${aliases}, ignored authors ${ignored}`);
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
