import { PrismaClient } from "@prisma/client";
import { prisma as scoringDb } from "../src/lib/db/prisma";
import { KNOWN_PARTICIPANTS } from "../src/lib/domain/participants/known-participants";
import { createParticipant, setRosterStatus } from "../src/lib/domain/participants/registry";
import { recalculateRound } from "../src/lib/domain/standings/recalculate-round";

const prisma = new PrismaClient();

async function main() {
  await prisma.season.deleteMany();
  await prisma.participant.deleteMany();

  const anna = await createParticipant("Anna");
  const boris = await createParticipant("Boris");
  const clara = await createParticipant("Clara");

  const season = await prisma.season.create({
    data: {
      name: "RPL Demo 2026",
      slug: "rpl-demo-2026",
      startsAt: new Date("2026-03-01T00:00:00.000Z"),
      endsAt: new Date("2026-05-31T00:00:00.000Z"),
      scoringConfig: {
        create: {},
      },
      participants: {
        create: [
          { participantId: anna.id, status: "included" },
          { participantId: boris.id, status: "included" },
          { participantId: clara.id, status: "included" },
        ],
      },
      rounds: {
        create: [
          {
            number: 1,
            name: "Round 1",
            status: "scored",
            forumUrl: "https://example.com/forum/rpl-demo/round-1",
            matches: {
              create: [
                {
                  sortOrder: 1,
                  homeTeam: "Zenit",
                  awayTeam: "Spartak",
                  kickoffAt: new Date("2026-03-07T16:00:00.000Z"),
                  actualHomeGoals: 2,
                  actualAwayGoals: 1,
                },
                {
                  sortOrder: 2,
                  homeTeam: "CSKA",
                  awayTeam: "Dynamo",
                  kickoffAt: new Date("2026-03-07T18:30:00.000Z"),
                  actualHomeGoals: 0,
                  actualAwayGoals: 0,
                },
                {
                  sortOrder: 3,
                  homeTeam: "Lokomotiv",
                  awayTeam: "Krasnodar",
                  kickoffAt: new Date("2026-03-08T14:00:00.000Z"),
                  actualHomeGoals: 3,
                  actualAwayGoals: 0,
                  isMatchOfTheRound: true,
                },
                {
                  sortOrder: 4,
                  homeTeam: "Rubin",
                  awayTeam: "Rostov",
                  kickoffAt: new Date("2026-03-08T16:30:00.000Z"),
                  actualHomeGoals: 3,
                  actualAwayGoals: 2,
                },
              ],
            },
          },
          {
            number: 2,
            name: "Round 2",
            status: "scored",
            forumUrl: "https://example.com/forum/rpl-demo/round-2",
            matches: {
              create: [
                {
                  sortOrder: 1,
                  homeTeam: "Spartak",
                  awayTeam: "Zenit",
                  kickoffAt: new Date("2026-03-14T16:00:00.000Z"),
                  actualHomeGoals: 1,
                  actualAwayGoals: 0,
                },
                {
                  sortOrder: 2,
                  homeTeam: "Dynamo",
                  awayTeam: "CSKA",
                  kickoffAt: new Date("2026-03-14T18:30:00.000Z"),
                  actualHomeGoals: 4,
                  actualAwayGoals: 1,
                  isMatchOfTheRound: true,
                },
                {
                  sortOrder: 3,
                  homeTeam: "Krasnodar",
                  awayTeam: "Lokomotiv",
                  kickoffAt: new Date("2026-03-15T14:00:00.000Z"),
                  actualHomeGoals: 1,
                  actualAwayGoals: 1,
                },
              ],
            },
          },
        ],
      },
    },
    include: {
      rounds: {
        include: { matches: { orderBy: { sortOrder: "asc" } } },
        orderBy: { number: "asc" },
      },
    },
  });

  const [round1, round2] = season.rounds;
  if (!round1 || !round2) {
    throw new Error("Expected two demo rounds");
  }

  const [r1m1, r1m2, r1m3, r1m4] = round1.matches;
  const [r2m1, r2m2, r2m3] = round2.matches;
  if (!r1m1 || !r1m2 || !r1m3 || !r1m4 || !r2m1 || !r2m2 || !r2m3) {
    throw new Error("Expected demo fixtures");
  }

  await prisma.predictionSet.create({
    data: {
      roundId: round1.id,
      participantId: anna.id,
      source: "manual",
      status: "confirmed",
      rawComment: "Zenit 2-1, CSKA 0-0, Lokomotiv 3-0, Rubin 3-2",
      predictions: {
        create: [
          { matchId: r1m1.id, homeGoals: 2, awayGoals: 1 },
          { matchId: r1m2.id, homeGoals: 0, awayGoals: 0 },
          { matchId: r1m3.id, homeGoals: 3, awayGoals: 0 },
          { matchId: r1m4.id, homeGoals: 3, awayGoals: 2 },
        ],
      },
    },
  });

  await prisma.predictionSet.create({
    data: {
      roundId: round1.id,
      participantId: boris.id,
      source: "manual",
      status: "confirmed",
      rawComment: "Zenit 1-0, CSKA 2-2, Lokomotiv 2-0, Rubin 4-1",
      predictions: {
        create: [
          { matchId: r1m1.id, homeGoals: 1, awayGoals: 0 },
          { matchId: r1m2.id, homeGoals: 2, awayGoals: 2 },
          { matchId: r1m3.id, homeGoals: 2, awayGoals: 0 },
          { matchId: r1m4.id, homeGoals: 4, awayGoals: 1 },
        ],
      },
    },
  });

  await prisma.predictionSet.create({
    data: {
      roundId: round1.id,
      participantId: clara.id,
      source: "import",
      status: "reviewed",
      rawComment: "Zenit 0-1, CSKA ?, Lokomotiv 0-3, Rubin 2-2",
      predictions: {
        create: [
          { matchId: r1m1.id, homeGoals: 0, awayGoals: 1 },
          { matchId: r1m2.id, homeGoals: null, awayGoals: null },
          { matchId: r1m3.id, homeGoals: 0, awayGoals: 3 },
          { matchId: r1m4.id, homeGoals: 2, awayGoals: 2 },
        ],
      },
    },
  });

  await prisma.predictionSet.create({
    data: {
      roundId: round2.id,
      participantId: anna.id,
      source: "manual",
      status: "confirmed",
      predictions: {
        create: [
          { matchId: r2m1.id, homeGoals: 0, awayGoals: 5 },
          { matchId: r2m2.id, homeGoals: 0, awayGoals: 5 },
          { matchId: r2m3.id, homeGoals: 0, awayGoals: 5 },
        ],
      },
    },
  });

  await prisma.predictionSet.create({
    data: {
      roundId: round2.id,
      participantId: boris.id,
      source: "manual",
      status: "confirmed",
      predictions: {
        create: [
          { matchId: r2m1.id, homeGoals: 1, awayGoals: 0 },
          { matchId: r2m2.id, homeGoals: 4, awayGoals: 1 },
          { matchId: r2m3.id, homeGoals: 1, awayGoals: 1 },
        ],
      },
    },
  });

  await prisma.predictionSet.create({
    data: {
      roundId: round2.id,
      participantId: clara.id,
      source: "import",
      status: "reviewed",
      predictions: {
        create: [
          { matchId: r2m1.id, homeGoals: 0, awayGoals: 2 },
          { matchId: r2m2.id, homeGoals: null, awayGoals: null },
          { matchId: r2m3.id, homeGoals: 2, awayGoals: 0 },
        ],
      },
    },
  });

  await prisma.round.create({
    data: {
      seasonId: season.id,
      number: 11,
      name: "11th tour",
      status: "open",
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

  for (const name of KNOWN_PARTICIPANTS) {
    const participant = await createParticipant(name);
    await setRosterStatus(participant.id, season.id, "include");
  }

  await prisma.predictionSet.updateMany({
    where: { roundId: { in: [round1.id, round2.id] } },
    data: { selected: true, selection: "manual" },
  });
  await recalculateRound(round1.id);
  await recalculateRound(round2.id);
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
