import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { fetchForumThread } from "@/lib/domain/forum/fetch-post";
import type { ForumPost } from "@/lib/domain/forum/types";
import { importRounds } from "@/lib/domain/import/batch-import";
import { parseStoredComments } from "@/lib/domain/import/persist-import";
import { ingestSeasonResults } from "@/lib/domain/results/ingest";
import { fixtureConfidence, type LiveFixtureInput } from "@/lib/domain/scoring/live-score";
import { recalculateRound } from "@/lib/domain/standings/recalculate-round";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";

try {
  loadEnvFile();
} catch {
  // DATABASE_URL may already be set.
}

const SOURCES = [
  { number: 12, name: "12 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/2763/" },
  { number: 13, name: "13 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/2920/" },
] as const;

async function loadThread(url: string): Promise<ForumPost> {
  try {
    return (await fetchForumThread(url)).post;
  } catch (error) {
    const code = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause
      ? String(error.cause.code)
      : "";
    if (!code.startsWith("UND_ERR_")) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return (await fetchForumThread(url)).post;
  }
}

function fixtureInput(match: {
  id: string;
  homeTeam: string;
  awayTeam: string;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledgedAt: Date | null;
  isMatchOfTheRound: boolean;
}): LiveFixtureInput {
  return {
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
}

async function main() {
  const season = await prisma.season.findFirst({ orderBy: { name: "asc" } });
  if (!season) {
    throw new Error("No season found. Nothing was imported.");
  }
  const baseline = await prisma.standingsCheckpoint.findFirst({
    where: { seasonId: season.id, source: "manual" },
    orderBy: { afterRoundNumber: "desc" },
    include: { _count: { select: { rows: true } } },
  });
  if (!baseline || baseline.afterRoundNumber !== 13 || baseline._count.rows !== 25) {
    throw new Error("The active manual baseline is not the 25-row checkpoint after round 13. Nothing was imported.");
  }

  const reports = await importRounds({
    seasonId: season.id,
    sources: SOURCES,
    fetchPost: loadThread,
  });
  for (const report of reports) {
    if (report.error) {
      console.log(`Round ${report.number}: import failed: ${report.error}`);
      continue;
    }
    console.log(
      `Round ${report.number}: ${report.comments} comments stored, ${report.fixtures} fixtures, ${report.accepted} accepted, ${report.flaggedSets} in review`,
    );
  }

  const rounds = await prisma.round.findMany({
    where: { seasonId: season.id, number: { in: [12, 13] } },
    include: { predictionSets: { include: { _count: { select: { predictions: true } } } } },
  });
  for (const round of rounds) {
    if (round.standingRole !== ARCHIVED_ROUND) {
      throw new Error(`Round ${round.number} is ${round.standingRole}. It was not imported as reference data.`);
    }
    const emptyManual = round.predictionSets.filter((set) => set.manuallyEdited && set._count.predictions === 0);
    if (emptyManual.length > 0) {
      await prisma.predictionSet.updateMany({
        where: { id: { in: emptyManual.map((set) => set.id) } },
        data: { manuallyEdited: false, selection: "auto", selected: false },
      });
      console.log(
        `Round ${round.number}: released ${emptyManual.length} empty manual selection(s) that had no stored predictions, then parsed again.`,
      );
      await parseStoredComments(round.id);
    }
  }

  const imported = await prisma.round.findMany({
    where: { seasonId: season.id, number: { in: [12, 13] } },
    select: { id: true },
  });
  const ingested = await ingestSeasonResults(season.id, {
    onlyRoundIds: imported.map((round) => round.id),
    skipUndated: true,
  });
  console.log(
    `Results fetch: verified ${ingested.verified}, confirmed ${ingested.confirmed}, conflicts ${ingested.conflicts}, insufficient ${ingested.insufficient}`,
  );
  for (const source of ingested.sources) {
    console.log(`  ${source.source} ${source.role} ${source.status} rows ${source.matchCount}${source.error ? ` (${source.error})` : ""}`);
  }

  for (const source of SOURCES) {
    const round = await prisma.round.findUnique({
      where: { seasonId_number: { seasonId: season.id, number: source.number } },
      include: { matches: { orderBy: { sortOrder: "asc" } } },
    });
    if (!round) {
      console.log(`Round ${source.number}: missing after import`);
      continue;
    }
    const blockers = round.matches.flatMap((match) => {
      const confidence = fixtureConfidence(fixtureInput(match));
      return confidence === "verified" ? [] : [`${match.homeTeam} — ${match.awayTeam} (${confidence})`];
    });
    if (round.matches.length === 0 || blockers.length > 0) {
      console.log(`Round ${source.number}: calculation incomplete. ${round.matches.length === 0 ? "No fixtures." : blockers.join("; ")}`);
      continue;
    }
    const scored = (await recalculateRound(round.id)).participants;
    const stored = await prisma.round.findUnique({
      where: { id: round.id },
      select: { standingRole: true, status: true, _count: { select: { roundScores: true } } },
    });
    console.log(
      `Round ${source.number}: calculated ${scored} reference rows, status ${stored?.status}, role ${stored?.standingRole}, stored scores ${stored?._count.roundScores ?? 0}`,
    );
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
