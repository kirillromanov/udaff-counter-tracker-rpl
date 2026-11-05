import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { fixtureConfidence, type LiveFixtureInput } from "@/lib/domain/scoring/live-score";
import { recalculateRound } from "@/lib/domain/standings/recalculate-round";

try {
  loadEnvFile();
} catch {
  // DATABASE_URL may already be set.
}

function baselineFingerprint(rows: {
  rank: number;
  participantId: string | null;
  displayName: string;
  totalPoints: number;
  movement: string;
  movementDelta: number;
  previousRank: number | null;
  markerCount: number;
  rawLine: string;
}[]): string {
  return rows
    .map((row) =>
      [
        row.rank,
        row.participantId ?? "",
        row.displayName,
        row.totalPoints,
        row.movement,
        row.movementDelta,
        row.previousRank ?? "",
        row.markerCount,
        row.rawLine,
      ].join("|"),
    )
    .join("\n");
}

async function main() {
  const season = await prisma.season.findFirst({ orderBy: { name: "asc" } });
  if (!season) {
    throw new Error("No season found. Nothing was recalculated.");
  }
  const before = await prisma.standingsCheckpoint.findFirst({
    where: { seasonId: season.id, source: "manual" },
    orderBy: { afterRoundNumber: "desc" },
    include: { rows: { orderBy: { rank: "asc" } } },
  });
  if (!before || before.afterRoundNumber !== 13 || before.rows.length !== 25) {
    throw new Error("Active baseline is not the 25-row checkpoint after round 13. Nothing was recalculated.");
  }
  const baselineBefore = `${before.id}\n${before.rawText}\n${baselineFingerprint(before.rows)}`;
  const laterBefore = await prisma.round.findMany({
    where: { seasonId: season.id, number: { gt: 13 } },
    select: { id: true, number: true, updatedAt: true, _count: { select: { roundScores: true, matches: true } } },
  });

  const rounds = await prisma.round.findMany({
    where: { seasonId: season.id, number: { gte: 1, lte: 13 } },
    orderBy: { number: "asc" },
    include: {
      matches: true,
      roundScores: { select: { totalPoints: true } },
      predictionSets: { where: { selected: true }, select: { id: true } },
    },
  });

  for (const round of rounds) {
    const blockers = round.matches.flatMap((match) => {
      const fixture: LiveFixtureInput = {
        matchId: match.id,
        label: `${match.homeTeam} — ${match.awayTeam}`,
        actualHomeGoals: match.actualHomeGoals,
        actualAwayGoals: match.actualAwayGoals,
        resultState: match.resultState,
        resultResolution: match.resultResolution,
        resultConflict: match.resultConflict,
        conflictAcknowledged: match.conflictAcknowledgedAt != null,
        isMatchOfTheRound: match.isMatchOfTheRound,
      };
      const confidence = fixtureConfidence(fixture);
      return confidence === "verified" ? [] : [`${fixture.label} (${confidence})`];
    });
    const oldTotal = round.roundScores.reduce((sum, score) => sum + score.totalPoints, 0);
    if (round.matches.length === 0 || blockers.length > 0 || round.predictionSets.length === 0) {
      const reason = round.matches.length === 0
        ? "no fixtures"
        : blockers.length > 0
          ? blockers.join("; ")
          : "no selected predictions";
      console.log(`Round ${round.number}: partial — ${reason}. Left ${round.roundScores.length} stored rows, total ${oldTotal}.`);
      continue;
    }
    try {
      const stored = await recalculateRound(round.id);
      const scores = await prisma.roundScore.findMany({ where: { roundId: round.id }, select: { totalPoints: true } });
      const nextTotal = scores.reduce((sum, score) => sum + score.totalPoints, 0);
      console.log(
        `Round ${round.number}: complete. rows ${round.roundScores.length} -> ${stored}, total ${oldTotal} -> ${nextTotal} (${nextTotal - oldTotal >= 0 ? "+" : ""}${nextTotal - oldTotal})`,
      );
    } catch (error) {
      console.log(`Round ${round.number}: failed — ${error instanceof Error ? error.message : "recalculation failed"}`);
    }
  }

  const after = await prisma.standingsCheckpoint.findFirst({
    where: { id: before.id },
    include: { rows: { orderBy: { rank: "asc" } } },
  });
  const baselineAfter = after ? `${after.id}\n${after.rawText}\n${baselineFingerprint(after.rows)}` : "";
  console.log(baselineBefore === baselineAfter ? "Baseline unchanged." : "Baseline changed. This recalculation must be reviewed.");
  const laterAfter = await prisma.round.findMany({
    where: { seasonId: season.id, number: { gt: 13 } },
    select: { id: true, number: true, updatedAt: true, _count: { select: { roundScores: true, matches: true } } },
  });
  console.log(
    JSON.stringify(laterBefore) === JSON.stringify(laterAfter)
      ? "Rounds after 13 were unchanged."
      : "Rounds after 13 changed.",
  );

  const doctor = await prisma.participant.findFirst({ where: { name: "Doctor Livesey" } });
  const round13 = rounds.find((round) => round.number === 13);
  if (doctor && round13) {
    const score = await prisma.roundScore.findUnique({
      where: { roundId_participantId: { roundId: round13.id, participantId: doctor.id } },
    });
    const breakdown = score ? JSON.parse(score.breakdownJson) as { matches: { label: string; finalMatchPoints: number; basePoints: number; bonusPoints: number; predicted: string; actual: string }[] } : null;
    const lines = (breakdown?.matches ?? []).filter((match) => match.label.includes("Рубин") || match.label.includes("Локомотив"));
    console.log(`Doctor Livesey round 13 total: ${score?.totalPoints ?? "missing"}`);
    for (const line of lines) {
      console.log(`  ${line.label}: predicted ${line.predicted}, actual ${line.actual}, base ${line.basePoints}, bonus ${line.bonusPoints}, final ${line.finalMatchPoints}`);
    }
  }

  const computedScores = await prisma.roundScore.findMany({
    where: { round: { seasonId: season.id, number: { gte: 1, lte: 13 } } },
    select: { participantId: true, totalPoints: true },
  });
  const computedByParticipant = new Map<string, number>();
  for (const score of computedScores) {
    computedByParticipant.set(score.participantId, (computedByParticipant.get(score.participantId) ?? 0) + score.totalPoints);
  }
  console.log("Computed rounds 1–13 versus baseline (diagnostic only):");
  for (const row of after?.rows ?? []) {
    const computed = row.participantId ? computedByParticipant.get(row.participantId) : undefined;
    const shown = computed ?? "missing";
    const delta = computed == null ? "n/a" : `${computed - row.totalPoints >= 0 ? "+" : ""}${computed - row.totalPoints}`;
    console.log(`${row.rank} ${row.displayName}: computed ${shown}, baseline ${row.totalPoints}, delta ${delta}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
