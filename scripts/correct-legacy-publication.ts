import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { slipsByParticipant } from "@/lib/domain/import/effective-slip";
import { planLegacyPublicationCorrections } from "@/lib/domain/import/legacy-publication";
import { fixtureDeadline } from "@/lib/domain/import/fixture-deadline";
import { acquireClaim, workerLockDirectory } from "@/lib/domain/worker/claims";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? null : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function required(name: string): string {
  const value = argument(name);
  if (!value) {
    throw new Error("Required: --database file:/absolute/path.db --round-id <id>. Add --apply --manifest <path> to write.");
  }
  return value;
}

const database = required("--database");
const roundId = required("--round-id");
const manifestPath = argument("--manifest");
const apply = process.argv.includes("--apply");

const prisma = new PrismaClient({ datasources: { db: { url: database } } });

function cellCounts(cells: { state: string; reason?: string }[]) {
  return {
    accepted: cells.filter((cell) => cell.state === "selected").length,
    uncertain: cells.filter((cell) => cell.state === "review" && cell.reason === "uncertain-time").length,
    ambiguous: cells.filter((cell) => cell.state === "review" && cell.reason === "disagreement").length,
    missing: cells.filter((cell) => cell.state === "missing").length,
  };
}

async function main(): Promise<void> {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      matches: { orderBy: { sortOrder: "asc" } },
      forumComments: true,
      predictionSets: { include: { predictions: true, forumComment: true } },
      roundScores: true,
    },
  });
  if (!round) {
    throw new Error("Round not found");
  }
  const plan = planLegacyPublicationCorrections(round.forumComments.map((comment) => ({
    id: comment.id,
    externalId: comment.externalId,
    postedAt: comment.postedAt,
    rawHtml: comment.rawHtml,
  })));
  if (plan.conflicts.length > 0) {
    console.log(JSON.stringify({ roundId, conflicts: plan.conflicts }, null, 2));
    throw new Error("Unresolved publication conflicts");
  }
  const correctedAt = new Map(plan.corrections.map((item) => [item.commentId, new Date(item.newPostedAt)]));
  const setsFor = (useCorrected: boolean) => round.predictionSets.filter((set) => set.selected).map((set) => ({
    id: set.id,
    participantId: set.participantId,
    selection: set.selection,
    manuallyEdited: set.manuallyEdited,
    createdAt: set.createdAt,
    postedAt: useCorrected && set.forumCommentId && correctedAt.has(set.forumCommentId)
      ? correctedAt.get(set.forumCommentId) ?? null
      : set.forumComment?.postedAt ?? null,
    rawHtml: set.forumComment?.rawHtml ?? null,
    predictions: set.predictions,
  }));
  const fixtures = round.matches.map((match) => ({ id: match.id, kickoffAt: match.kickoffAt }));
  const before = slipsByParticipant(fixtures, setsFor(false)).flatMap((slip) => slip.cells);
  const after = slipsByParticipant(fixtures, setsFor(true)).flatMap((slip) => slip.cells);
  const kickoffMinute = plan.corrections.flatMap((item) => {
    const at = new Date(item.newPostedAt).getTime();
    return round.matches.filter((match) => match.kickoffAt?.getTime() === at).map((match) => ({
      externalId: item.externalId,
      fixture: `${match.homeTeam} — ${match.awayTeam}`,
    }));
  });
  const predictionDeadlines = round.predictionSets.filter((set) => set.selected).flatMap((set) => set.predictions.map((prediction) => {
    const posted = set.forumCommentId ? correctedAt.get(set.forumCommentId) ?? set.forumComment?.postedAt ?? null : null;
    const kickoff = round.matches.find((match) => match.id === prediction.matchId)?.kickoffAt ?? null;
    return fixtureDeadline(posted, kickoff);
  }));
  const report = {
    mode: apply ? "apply" : "plan",
    roundId,
    roundNumber: round.number,
    comments: round.forumComments.length,
    sets: round.predictionSets.length,
    selectedSets: round.predictionSets.filter((set) => set.selected).length,
    predictions: round.predictionSets.reduce((sum, set) => sum + set.predictions.length, 0),
    scores: round.roundScores.length,
    corrections: plan.corrections.length,
    unchanged: plan.unchanged.length,
    rows: plan.corrections,
    unchangedRows: plan.unchanged,
    kickoffMinute,
    cellsBefore: cellCounts(before),
    cellsAfter: cellCounts(after),
    predictionDeadlinesAfter: {
      eligible: predictionDeadlines.filter((item) => item === "eligible").length,
      late: predictionDeadlines.filter((item) => item === "late").length,
      unknown: predictionDeadlines.filter((item) => item === "unknown").length,
    },
    copiedPublicationFields: "ForumComment.postedAt is the only stored publication instant. Selection reads it from the comment.",
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) {
    return;
  }
  if (!manifestPath) {
    throw new Error("Apply requires --manifest");
  }
  writeFileSync(manifestPath, `${JSON.stringify({ roundId, corrections: plan.corrections }, null, 2)}\n`);
  const releasePrediction = await acquireClaim(workerLockDirectory(), `prediction-${roundId}`);
  const releaseResult = releasePrediction ? await acquireClaim(workerLockDirectory(), `result-${roundId}`) : null;
  if (!releasePrediction || !releaseResult) {
    await releasePrediction?.();
    throw new Error("A prediction or result claim is already held");
  }
  try {
  const otherBefore = await prisma.forumComment.aggregate({
    where: { roundId: { not: roundId } },
    _count: true,
    _max: { updatedAt: true },
  });
  await prisma.$transaction(async (tx) => {
    for (const correction of plan.corrections) {
      const changed = await tx.$executeRawUnsafe(
        `UPDATE ForumComment SET postedAt = ? WHERE id = ? AND roundId = ? AND postedAt = ?`,
        new Date(correction.newPostedAt).getTime(),
        correction.commentId,
        roundId,
        new Date(correction.oldPostedAt).getTime(),
      );
      if (changed !== 1) {
        throw new Error(`Compare-and-set failed for ${correction.externalId}`);
      }
    }
    const otherAfter = await tx.forumComment.aggregate({
      where: { roundId: { not: roundId } },
      _count: true,
      _max: { updatedAt: true },
    });
    if (otherAfter._count !== otherBefore._count || otherAfter._max?.updatedAt?.getTime() !== otherBefore._max?.updatedAt?.getTime()) {
      throw new Error("Another round changed inside the correction");
    }
  });
  } finally {
    await releaseResult();
    await releasePrediction();
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "correction failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
