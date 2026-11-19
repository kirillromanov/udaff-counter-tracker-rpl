import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { fetchForumPost } from "@/lib/domain/forum/fetch-post";
import { parseFixtureSchedule } from "@/lib/domain/forum/parse-schedule";
import { parseStoredComments } from "@/lib/domain/import/persist-import";
import { BALBES_STYLIZED_ALIAS } from "@/lib/domain/parser/attribute-blocks";

try {
  loadEnvFile();
} catch {
  // The app loads .env itself. This script can also run with DATABASE_URL already set.
}

function fail(message: string): never {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

async function main() {
  const round = await prisma.round.findFirst({
    where: { number: 14 },
    include: { matches: true },
  });
  if (!round) {
    fail("Round 14 was not found. Nothing was written.");
  }
  const comment = await prisma.forumComment.findFirst({
    where: {
      roundId: round.id,
      authorName: "neofit",
      rawText: { contains: BALBES_STYLIZED_ALIAS },
    },
  });
  if (!comment || !comment.rawText.includes("мну")) {
    fail("The stored neofit comment with both owner markers was not found. No submission was created.");
  }

  const baseline = await prisma.standingsCheckpoint.findFirst({
    where: { source: "manual", afterRoundNumber: 13 },
    select: { id: true, rawText: true },
  });
  const pollBefore = {
    status: round.status,
    pollStatus: round.pollStatus,
    nextPollAt: round.nextPollAt?.toISOString() ?? null,
  };
  const otherSets = await prisma.predictionSet.count({
    where: { roundId: { not: round.id } },
  });

  if (round.matches.length === 0) {
    if (!round.forumUrl) {
      fail("Round 14 has no fixtures and no stored forum URL. Predictions were not invented.");
    }
    const post = await fetchForumPost(round.forumUrl);
    const schedule = parseFixtureSchedule(post.openingText);
    if (schedule.fixtures.length === 0) {
      fail(`The opening post did not contain a fixture list. ${schedule.warnings.join(" ")}`.trim());
    }
    await prisma.match.createMany({
      data: schedule.fixtures.map((fixture, index) => ({
        roundId: round.id,
        sortOrder: index + 1,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        kickoffAt: fixture.kickoffAt,
        isMatchOfTheRound: fixture.isMatchOfTheRound,
      })),
    });
    if (!round.sourceSnapshot) {
      await prisma.round.update({
        where: { id: round.id },
        data: { sourceSnapshot: post.openingText, fetchedAt: post.fetchedAt ?? new Date() },
      });
    }
    console.log(`Created ${schedule.fixtures.length} fixtures from the stored round URL.`);
  }

  const manual = await prisma.predictionSet.findMany({
    where: { forumCommentId: comment.id, OR: [{ manuallyEdited: true }, { selection: "manual" }] },
    include: { participant: true },
  });
  if (manual.length > 0) {
    console.log(`Manual overrides left intact: ${manual.map((set) => set.participant.name).join(", ")}`);
  }

  await parseStoredComments(round.id, { commentId: comment.id, force: true });

  const fresh = await prisma.predictionSet.findMany({
    where: { forumCommentId: comment.id, selected: true },
    include: {
      participant: true,
      predictions: { include: { match: true }, orderBy: { match: { sortOrder: "asc" } } },
    },
  });
  for (const set of fresh) {
    const scores = set.predictions
      .filter((prediction) => !prediction.ignored && prediction.homeGoals != null)
      .map((prediction) => `${prediction.match.homeTeam} ${prediction.homeGoals}-${prediction.awayGoals}`);
    console.log(`${set.participant.name} ${set.status} ${set.attributionMethod}: ${scores.join(", ")}`);
  }

  const after = await prisma.round.findUniqueOrThrow({ where: { id: round.id } });
  if (after.status !== pollBefore.status || after.pollStatus !== pollBefore.pollStatus || (after.nextPollAt?.toISOString() ?? null) !== pollBefore.nextPollAt) {
    fail("Polling state changed during the repair.");
  }
  const baselineAfter = await prisma.standingsCheckpoint.findFirst({
    where: { id: baseline?.id ?? "" },
    select: { rawText: true },
  });
  if (baseline && baselineAfter?.rawText !== baseline.rawText) {
    fail("The baseline text changed.");
  }
  const otherAfter = await prisma.predictionSet.count({ where: { roundId: { not: round.id } } });
  if (otherAfter !== otherSets) {
    fail("Prediction sets outside round 14 changed.");
  }
  console.log(`Repaired comment ${comment.id}. Selected sets: ${fresh.length}.`);
}

main()
  .catch((error: unknown) => {
    if (!process.exitCode) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
