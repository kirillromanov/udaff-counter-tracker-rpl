import { PrismaClient } from "@prisma/client";
import { prisma as scoringDb } from "../src/lib/db/prisma";
import { KNOWN_PARTICIPANTS } from "../src/lib/domain/participants/known-participants";
import { createParticipant, ensureKnownIdentities, setRosterStatus } from "../src/lib/domain/participants/registry";
import { ROUND_11_CHECKPOINT } from "../src/lib/domain/standings/round-11-checkpoint";
import { saveManualCheckpoint } from "../src/lib/domain/standings/save-checkpoint";

const prisma = new PrismaClient();

async function main() {
  await prisma.season.deleteMany();
  await prisma.participant.deleteMany();

  const season = await prisma.season.create({
    data: {
      name: "RPL Demo 2026",
      slug: "rpl-demo-2026",
      startsAt: new Date("2026-03-01T00:00:00.000Z"),
      endsAt: new Date("2026-05-31T00:00:00.000Z"),
      scoringConfig: {
        create: {},
      },
    },
  });

  for (const name of KNOWN_PARTICIPANTS) {
    const participant = await createParticipant(name);
    await setRosterStatus(participant.id, season.id, "include");
  }
  await ensureKnownIdentities();

  await prisma.round.create({
    data: {
      seasonId: season.id,
      number: 11,
      name: "11th tour",
      status: "open",
      standingRole: "archived",
      forumUrl: "https://canadaru.net/udaff_afterlife/sport/football/rpl/2633/",
      matches: {
        create: [
          { sortOrder: 1, homeTeam: "Крылья Советов", awayTeam: "Факел", kickoffAt: new Date("2026-10-17T14:00:00.000Z") },
          { sortOrder: 2, homeTeam: "Динамо Махачкала", awayTeam: "Акрон", kickoffAt: new Date("2026-10-17T16:30:00.000Z") },
          { sortOrder: 3, homeTeam: "Локомотив", awayTeam: "Краснодар", kickoffAt: new Date("2026-10-17T19:30:00.000Z") },
          { sortOrder: 4, homeTeam: "Зенит", awayTeam: "Ахмат", kickoffAt: new Date("2026-10-18T14:00:00.000Z") },
          { sortOrder: 5, homeTeam: "Динамо", awayTeam: "ЦСКА", isMatchOfTheRound: true, kickoffAt: new Date("2026-10-18T16:15:00.000Z") },
          { sortOrder: 6, homeTeam: "Спартак", awayTeam: "Рубин", kickoffAt: new Date("2026-10-18T18:30:00.000Z") },
          { sortOrder: 7, homeTeam: "Балтика", awayTeam: "Ростов", kickoffAt: new Date("2026-10-18T20:45:00.000Z") },
          { sortOrder: 8, homeTeam: "Родина", awayTeam: "Оренбург", kickoffAt: new Date("2026-10-19T19:30:00.000Z") },
        ],
      },
    },
  });

  const checkpoint = await saveManualCheckpoint({
    seasonId: season.id,
    afterRoundNumber: 11,
    label: "Manual checkpoint after round 11",
    rawText: ROUND_11_CHECKPOINT,
  });
  if (checkpoint.unmatched.length > 0) {
    throw new Error(`Checkpoint names did not match the registry: ${checkpoint.unmatched.join(", ")}`);
  }

  await scoringDb.$disconnect();
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
