import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { parseStoredComments } from "@/lib/domain/import/persist-import";
import { attributeComment } from "@/lib/domain/parser/attribute-blocks";

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
  const round = await prisma.round.findFirst({ where: { number: 14 } });
  if (!round) {
    fail("Round 14 was not found. Nothing was written.");
  }
  const comments = await prisma.forumComment.findMany({
    where: { roundId: round.id, authorName: { in: ["Павел Абросимов", "Павел"] } },
    orderBy: { postedAt: "asc" },
  });
  const relevant = comments.filter((comment) => {
    return attributeComment({ raw: comment.rawText, authorName: "Павел Абросимов", roundNumber: round.number }).length > 0;
  });
  if (relevant.length === 0) {
    fail("No stored Павел Абросимов prediction comment was found. No submission was created.");
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
  const unrelated = await prisma.predictionSet.count({
    where: { roundId: round.id, participant: { name: { notIn: ["Павел Абросимов", "СашкоБубен"] } } },
  });

  for (const comment of relevant) {
    const manual = await prisma.predictionSet.findMany({
      where: { forumCommentId: comment.id, OR: [{ manuallyEdited: true }, { selection: "manual" }] },
      include: { participant: true },
    });
    if (manual.length > 0) {
      console.log(`Manual overrides left intact on ${comment.id}: ${manual.map((set) => set.participant.name).join(", ")}`);
    }
    await parseStoredComments(round.id, { commentId: comment.id, force: true });
    console.log(`Reprocessed ${comment.id}`);
  }

  const fresh = await prisma.predictionSet.findMany({
    where: { roundId: round.id, participant: { name: { in: ["Павел Абросимов", "СашкоБубен"] } } },
    include: {
      participant: true,
      predictions: { include: { match: true }, orderBy: { match: { sortOrder: "asc" } } },
    },
    orderBy: [{ participant: { name: "asc" } }, { blockKey: "asc" }],
  });
  for (const set of fresh) {
    const scores = set.predictions
      .filter((prediction) => !prediction.ignored && prediction.homeGoals != null)
      .map((prediction) => `${prediction.homeGoals}-${prediction.awayGoals}`);
    console.log(`${set.participant.name} ${set.status} selected=${set.selected} ${set.attributionMethod} ${set.attributionReview}: ${scores.join(", ")}`);
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
  const unrelatedAfter = await prisma.predictionSet.count({
    where: { roundId: round.id, participant: { name: { notIn: ["Павел Абросимов", "СашкоБубен"] } } },
  });
  if (unrelatedAfter !== unrelated) {
    fail("Another participant's round-14 predictions changed.");
  }
  console.log(`Repaired ${relevant.length} comment(s). Pavel/Sashko sets: ${fresh.length}.`);
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
