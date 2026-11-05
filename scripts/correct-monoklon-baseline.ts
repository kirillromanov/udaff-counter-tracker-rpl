import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { normalizeParticipantName } from "@/lib/domain/participants/identity";
import { applyMonoklonBaselineCorrection, isMonoklonName } from "@/lib/domain/standings/correct-monoklon-baseline";
import { saveManualCheckpoint } from "@/lib/domain/standings/save-checkpoint";

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
  const season = await prisma.season.findFirst({ orderBy: { createdAt: "asc" } });
  if (!season) {
    fail("No season was found. Nothing was written.");
  }
  const active = await prisma.standingsCheckpoint.findFirst({
    where: { seasonId: season.id, source: "manual" },
    orderBy: { afterRoundNumber: "desc" },
    include: { rows: { orderBy: { rank: "asc" } } },
  });
  if (!active || active.afterRoundNumber !== 13) {
    fail("The active manual baseline is not the checkpoint after round 13. Nothing was written.");
  }
  const round11Id = (
    await prisma.standingsCheckpoint.findFirst({
      where: { seasonId: season.id, source: "manual", afterRoundNumber: 11 },
      select: { id: true },
    })
  )?.id;
  const round14 = await prisma.round.findFirst({
    where: { seasonId: season.id, number: 14 },
    select: { id: true, updatedAt: true, status: true, standingRole: true },
  });
  const scoreCount = await prisma.roundScore.count({ where: { round: { seasonId: season.id, number: { lte: 14 } } } });
  const before = new Map(active.rows.map((row) => [row.displayName, { points: row.totalPoints, medals: row.markerCount, movement: row.movement, delta: row.movementDelta }]));

  const participant = await prisma.participant.findFirst({
    where: { name: "моноклон" },
    include: { aliases: true },
  });
  const alias = participant?.aliases.find((item) => normalizeParticipantName(item.alias) === normalizeParticipantName("monoklon"));
  if (!participant || !alias) {
    fail("моноклон / monoklon does not resolve to one existing participant. Nothing was written.");
  }
  const owners = await prisma.participant.count({
    where: {
      OR: [
        { normalizedName: normalizeParticipantName("моноклон") },
        { aliases: { some: { normalized: normalizeParticipantName("monoklon") } } },
        { aliases: { some: { normalized: normalizeParticipantName("моноклон") } } },
      ],
    },
  });
  if (owners !== 1) {
    fail(`моноклон resolves to ${owners} participants. Nothing was written.`);
  }

  const correctedAt = new Date().toISOString();
  const result = applyMonoklonBaselineCorrection(active.rawText, correctedAt);
  if (result.status === "refused") {
    fail(`${result.reason} Nothing was written.`);
  }
  if (result.status === "unchanged") {
    console.log("моноклон baseline is already 189. No change was written.");
    return;
  }

  const saved = await saveManualCheckpoint({
    seasonId: season.id,
    afterRoundNumber: 13,
    label: active.label,
    rawText: result.rawText,
  });
  if (saved.unmatched.length > 0) {
    fail(`Baseline write left unmatched names: ${saved.unmatched.join(", ")}`);
  }
  await prisma.reconciliationDecision.upsert({
    where: {
      seasonId_afterRoundNumber_subjectName: {
        seasonId: season.id,
        afterRoundNumber: 13,
        subjectName: "моноклон",
      },
    },
    create: {
      seasonId: season.id,
      afterRoundNumber: 13,
      subjectName: "моноклон",
      participantId: participant.id,
      action: "manual_correction",
      note: result.note,
    },
    update: {
      participantId: participant.id,
      action: "manual_correction",
      note: result.note,
    },
  });

  const stored = await prisma.standingsCheckpoint.findFirst({
    where: { seasonId: season.id, source: "manual", afterRoundNumber: 13 },
    include: { rows: { orderBy: { rank: "asc" } } },
  });
  const monoklon = stored?.rows.find((row) => isMonoklonName(row.displayName));
  if (!stored || stored.rows.length !== 25 || !monoklon || monoklon.totalPoints !== 189 || monoklon.participantId !== participant.id) {
    fail("The stored baseline does not show моноклон at 189.");
  }
  for (const row of stored.rows) {
    if (isMonoklonName(row.displayName)) {
      continue;
    }
    const original = before.get(row.displayName);
    if (!original || original.points !== row.totalPoints || original.medals !== row.markerCount || original.movement !== row.movement || original.delta !== row.movementDelta) {
      fail(`Baseline metadata changed for ${row.displayName}.`);
    }
  }
  const activeCount = await prisma.standingsCheckpoint.count({
    where: { seasonId: season.id, source: "manual", afterRoundNumber: 13 },
  });
  const round11After = await prisma.standingsCheckpoint.findFirst({
    where: { seasonId: season.id, source: "manual", afterRoundNumber: 11 },
    select: { id: true },
  });
  const round14After = await prisma.round.findFirst({
    where: { seasonId: season.id, number: 14 },
    select: { id: true, updatedAt: true, status: true, standingRole: true },
  });
  const scoreCountAfter = await prisma.roundScore.count({ where: { round: { seasonId: season.id, number: { lte: 14 } } } });
  const decisions = await prisma.reconciliationDecision.count({
    where: { seasonId: season.id, afterRoundNumber: 13, subjectName: "моноклон", action: "manual_correction" },
  });
  if (activeCount !== 1 || round11After?.id !== round11Id) {
    fail("The active baseline set changed beyond the round 13 correction.");
  }
  if (round14After?.id !== round14?.id || round14After?.updatedAt.getTime() !== round14?.updatedAt.getTime() || round14After?.status !== round14?.status) {
    fail("Round 14 was modified.");
  }
  if (scoreCountAfter !== scoreCount || decisions !== 1) {
    fail("Historical scores or the audit record were not left as a single correction.");
  }

  console.log(`моноклон baseline is ${monoklon.totalPoints} at rank ${monoklon.rank}. Movement ${monoklon.movement} ${monoklon.movementDelta}.`);
  console.log(`Other baseline points and awards were unchanged. Audit decisions for this correction: ${decisions}.`);
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
