import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { FIRST_CHECK_MINUTES, planRoundPoll, pollIntervals, type PollFixture } from "@/lib/domain/results/poll";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";
import { formatMoscow } from "@/lib/domain/time/moscow";

try {
  loadEnvFile();
} catch {
  // The app loads .env. DATABASE_URL can also come from the environment.
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function toFixture(match: {
  kickoffAt: Date | null;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledgedAt: Date | null;
  autoCheckAttempts: number;
  autoCheckKickoffAt: Date | null;
  autoCheckNextAt: Date | null;
  resultObservations: { matchStatus: string }[];
}): PollFixture {
  return {
    kickoffAt: match.kickoffAt,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledgedAt: match.conflictAcknowledgedAt,
    autoCheckAttempts: match.autoCheckAttempts,
    autoCheckKickoffAt: match.autoCheckKickoffAt,
    autoCheckNextAt: match.autoCheckNextAt,
    liveReported: match.resultObservations.some((observation) => observation.matchStatus === "live"),
    providerStatus: (["postponed", "cancelled", "suspended", "live"] as const).find((status) =>
      match.resultObservations.some((observation) => observation.matchStatus === status),
    ) ?? null,
  };
}

async function main() {
  const rounds = await prisma.round.findMany({
    where: { standingRole: { not: ARCHIVED_ROUND } },
    include: { matches: { orderBy: { sortOrder: "asc" }, include: { resultObservations: { select: { matchStatus: true } } } } },
  });
  const now = new Date();
  for (const round of rounds) {
    for (const match of round.matches) {
      const verified =
        !match.resultConflict &&
        (match.resultState === "verified" || match.resultState === "manual" || match.resultResolution === "verified" || match.resultResolution === "manual");
      if (verified || match.autoCheckAttempts > 0 || !match.kickoffAt) {
        continue;
      }
      if (match.autoCheckKickoffAt && match.autoCheckKickoffAt.getTime() !== match.kickoffAt.getTime()) {
        continue;
      }
      await prisma.match.update({
        where: { id: match.id },
        data: {
          autoCheckKickoffAt: match.kickoffAt,
          autoCheckNextAt: addMinutes(match.kickoffAt, FIRST_CHECK_MINUTES),
        },
      });
      match.autoCheckKickoffAt = match.kickoffAt;
      match.autoCheckNextAt = addMinutes(match.kickoffAt, FIRST_CHECK_MINUTES);
    }
    const plan = planRoundPoll(round.matches.map(toFixture), now, pollIntervals());
    if (round.nextPollAt?.getTime() !== plan.nextPollAt?.getTime() || (plan.pollStatus !== "finalized" && round.pollStatus === "finalized")) {
      await prisma.round.update({
        where: { id: round.id },
        data: {
          nextPollAt: plan.nextPollAt,
          pollStatus: plan.pollStatus === "finalized" ? round.pollStatus : plan.pollStatus,
        },
      });
    }
    console.log(JSON.stringify({
      round: round.number,
      role: round.standingRole,
      nextPollAt: plan.nextPollAt?.toISOString() ?? null,
      nextDisplay: plan.nextPollAt ? formatMoscow(plan.nextPollAt) : null,
      reason: plan.reason,
      fixtures: round.matches.map((match) => ({
        fixture: `${match.homeTeam} — ${match.awayTeam}`,
        kickoff: match.kickoffAt?.toISOString() ?? null,
        score: `${match.actualHomeGoals ?? "—"}-${match.actualAwayGoals ?? "—"}`,
        state: match.resultState,
        attempts: match.autoCheckAttempts,
        next: match.autoCheckNextAt ? formatMoscow(match.autoCheckNextAt) : null,
      })),
    }));
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
