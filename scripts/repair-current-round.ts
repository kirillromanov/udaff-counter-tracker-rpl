import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { planMoscowKickoffRepair } from "@/lib/domain/forum/repair-moscow-kickoff";
import { applyAutoSelection } from "@/lib/domain/import/persist-import";
import { nextPollAfterCheck, planRoundPoll, pollIntervals, type PollFixture } from "@/lib/domain/results/poll";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";
import { recalculateRound } from "@/lib/domain/standings/recalculate-round";
import { formatMoscow } from "@/lib/domain/time/moscow";

try {
  loadEnvFile();
} catch {
  // The app loads .env itself. This script can still read DATABASE_URL from the environment.
}

async function main() {
  const round = await prisma.round.findFirst({
    where: { standingRole: { not: ARCHIVED_ROUND }, status: { not: "scored" } },
    orderBy: { number: "desc" },
    include: {
      matches: { orderBy: { sortOrder: "asc" }, include: { resultObservations: { select: { matchStatus: true } } } },
      predictionSets: { include: { predictions: true, participant: true, forumComment: { select: { postedAt: true } } } },
    },
  });
  if (!round?.sourceSnapshot) {
    throw new Error("No operational round with a stored opening post.");
  }

  const beforeScores = round.matches.map((match) => ({
    id: match.id,
    home: match.actualHomeGoals,
    away: match.actualAwayGoals,
    state: match.resultState,
  }));
  const beforeSelected = round.predictionSets.filter((set) => set.selected).map((set) => set.id).sort();
  const plan = planMoscowKickoffRepair(round.matches, round.sourceSnapshot);
  const now = new Date();
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ round: round.number, ...plan, updates: plan.updates.map((update) => ({ ...update, from: update.from?.toISOString() ?? null, to: update.to.toISOString() })) }, null, 2));
    return;
  }

  for (const update of plan.updates) {
    await prisma.match.update({ where: { id: update.id }, data: { kickoffAt: update.to } });
  }

  const matches = await prisma.match.findMany({ where: { roundId: round.id }, orderBy: { sortOrder: "asc" } });
  const fixtures: PollFixture[] = matches.map((match) => ({
    kickoffAt: match.kickoffAt,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledgedAt: match.conflictAcknowledgedAt,
    liveReported: round.matches.find((item) => item.id === match.id)?.resultObservations.some((observation) => observation.matchStatus === "live") ?? false,
    providerStatus: round.matches.find((item) => item.id === match.id)?.resultObservations.some((observation) => observation.matchStatus === "live") ? "live" : null,
  }));
  const intervals = pollIntervals();
  const pollPlan = planRoundPoll(fixtures, now, intervals);
  const nextPollAt = nextPollAfterCheck(pollPlan, now, intervals.liveMinutes);
  await prisma.round.update({
    where: { id: round.id },
    data: { nextPollAt, pollStatus: pollPlan.pollStatus },
  });

  await applyAutoSelection(round.id);
  const calculation = await recalculateRound(round.id);

  const after = await prisma.round.findUniqueOrThrow({
    where: { id: round.id },
    include: {
      matches: { orderBy: { sortOrder: "asc" } },
      predictionSets: { include: { predictions: true, participant: true, forumComment: { select: { postedAt: true } } } },
    },
  });
  for (const match of after.matches) {
    const previous = beforeScores.find((item) => item.id === match.id);
    if (previous && (previous.home !== match.actualHomeGoals || previous.away !== match.actualAwayGoals || previous.state !== match.resultState)) {
      throw new Error(`Actual result changed for ${match.homeTeam}.`);
    }
  }
  const afterSelected = new Set(after.predictionSets.filter((set) => set.selected).map((set) => set.id));
  const erased = beforeSelected.filter((id) => !afterSelected.has(id));
  const added = [...afterSelected].filter((id) => !beforeSelected.includes(id));

  const deadlineCases = [];
  for (const update of plan.updates) {
    if (!update.from) {
      continue;
    }
    const match = after.matches.find((item) => item.id === update.id);
    for (const set of after.predictionSets) {
      const postedAt = set.forumComment?.postedAt;
      if (!postedAt || postedAt.getTime() <= update.to.getTime() || postedAt.getTime() > update.from.getTime()) {
        continue;
      }
      const prediction = set.predictions.find((item) => item.matchId === update.id && item.homeGoals != null && !item.ignored);
      if (!prediction) {
        continue;
      }
      deadlineCases.push({
        participant: set.participant.name,
        fixture: match ? `${match.homeTeam} — ${match.awayTeam}` : update.id,
        postedAt: postedAt.toISOString(),
        selected: set.selected,
        manual: set.selection === "manual" || set.manuallyEdited,
      });
    }
  }

  console.log(JSON.stringify({
    round: round.number,
    kickoffs: after.matches.map((match) => ({
      fixture: `${match.homeTeam} — ${match.awayTeam}`,
      stored: match.kickoffAt?.toISOString() ?? null,
      display: match.kickoffAt ? formatMoscow(match.kickoffAt) : null,
      score: `${match.actualHomeGoals ?? "—"}-${match.actualAwayGoals ?? "—"}`,
      state: match.resultState,
    })),
    corrected: plan.updates.length,
    alreadyCorrect: plan.alreadyCorrect,
    preserved: plan.preserved,
    nextPollAt: after.nextPollAt?.toISOString() ?? null,
    nextPollDisplay: after.nextPollAt ? formatMoscow(after.nextPollAt) : null,
    pollStatus: after.pollStatus,
    calculation,
    newlySelectedSets: added,
    deselectedSets: erased,
    deadlineCases,
  }, null, 2));
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
