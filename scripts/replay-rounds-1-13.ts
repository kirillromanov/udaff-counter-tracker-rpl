import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fetchForumThread } from "@/lib/domain/forum/fetch-post";
import { parseFixtureSchedule } from "@/lib/domain/forum/parse-schedule";
import { ROUND_SOURCES } from "@/lib/domain/import/round-sources";
import {
  buildDiagnosticReport,
  readonlyDatabaseUrl,
  type DiagnosticFixture,
  type DiagnosticRoundInput,
} from "@/lib/domain/standings/diagnostic-replay";

try {
  loadEnvFile();
} catch {
  // DATABASE_URL may already be set.
}

const DIAGNOSTIC_URLS = [
  ...ROUND_SOURCES.map((source) => ({ number: source.number, url: source.url })),
  { number: 12, url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/2763/" },
  { number: 13, url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/2920/" },
] as const;

function reportDirectory(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set, so the diagnostic report has nowhere outside the repository to go.");
  }
  return path.join(home, "Library", "Application Support", "udaff-counter-tracker", "reports");
}

async function productionFingerprint(prisma: Awaited<typeof import("@/lib/db/prisma")>["prisma"]): Promise<string> {
  const snapshot = {
    checkpoints: await prisma.standingsCheckpoint.findMany({
      select: { id: true, afterRoundNumber: true, source: true, rawText: true },
      orderBy: { afterRoundNumber: "asc" },
    }),
    rounds: await prisma.round.findMany({
      select: {
        id: true,
        number: true,
        standingRole: true,
        forumUrl: true,
        pollStatus: true,
        nextPollAt: true,
        lastPolledAt: true,
      },
      orderBy: { number: "asc" },
    }),
    matches: await prisma.match.findMany({
      select: {
        id: true,
        actualHomeGoals: true,
        actualAwayGoals: true,
        resultState: true,
        resultConflict: true,
        resultResolution: true,
        resultNote: true,
      },
      orderBy: { id: "asc" },
    }),
    predictionSets: await prisma.predictionSet.count(),
    predictions: await prisma.prediction.count(),
    participants: await prisma.participant.count(),
    aliases: await prisma.participantAlias.count(),
    roundScores: await prisma.roundScore.count(),
    ignoredAuthors: await prisma.ignoredForumAuthor.count(),
  };
  return JSON.stringify(snapshot);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  process.env.DATABASE_URL = readonlyDatabaseUrl(databaseUrl, path.resolve("prisma"));
  const { prisma } = await import("@/lib/db/prisma");
  const before = await productionFingerprint(prisma);

  const season = await prisma.season.findFirst({ orderBy: { createdAt: "asc" } });
  if (!season) {
    throw new Error("No season was found.");
  }
  const [participants, aliases, ignored, rounds, checkpoint] = await Promise.all([
    prisma.participant.findMany(),
    prisma.participantAlias.findMany(),
    prisma.ignoredForumAuthor.findMany(),
    prisma.round.findMany({
      where: { seasonId: season.id, number: { lte: 13 } },
      include: {
        matches: {
          orderBy: { sortOrder: "asc" },
          include: { resultObservations: { orderBy: { fetchedAt: "desc" }, take: 1, select: { source: true } } },
        },
      },
    }),
    prisma.standingsCheckpoint.findFirst({
      where: { seasonId: season.id, source: "manual" },
      orderBy: { afterRoundNumber: "desc" },
      include: { rows: { orderBy: { rank: "asc" } } },
    }),
  ]);
  if (!checkpoint || checkpoint.afterRoundNumber !== 13) {
    throw new Error("Diagnostic comparison needs the active manual baseline after round 13. No production data was written.");
  }

  const byNumber = new Map(rounds.map((round) => [round.number, round]));
  const inputs: DiagnosticRoundInput[] = [];
  for (const source of DIAGNOSTIC_URLS) {
    const stored = byNumber.get(source.number);
    const fixtures: DiagnosticFixture[] = (stored?.matches ?? []).map((match) => ({
      id: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      isMatchOfTheRound: match.isMatchOfTheRound,
      actualHomeGoals: match.actualHomeGoals,
      actualAwayGoals: match.actualAwayGoals,
      resultState: match.resultState,
      resultConflict: match.resultConflict,
      provenance: match.resultNote || match.resultObservations[0]?.source || match.resultResolution || null,
    }));
    try {
      let thread: Awaited<ReturnType<typeof fetchForumThread>>;
      try {
        thread = await fetchForumThread(source.url);
      } catch (error) {
        const code = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause
          ? String(error.cause.code)
          : "";
        if (!code.startsWith("UND_ERR_")) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        thread = await fetchForumThread(source.url);
      }
      const schedule = parseFixtureSchedule(thread.post.openingText);
      inputs.push({
        number: source.number,
        sourceUrl: source.url,
        fetchStatus: "fetched",
        fetchError: null,
        pagesFetched: thread.pagesFetched,
        pageErrors: thread.pageErrors,
        comments: thread.post.comments.map((comment, index) => ({
          id: `${source.number}:${comment.externalId ?? `line-${index}`}`,
          authorName: comment.authorName,
          postedAt: comment.postedAt,
          rawText: comment.rawText,
        })),
        fixtures,
        scheduleFixtures: schedule.fixtures.map((fixture, index) => ({
          id: `schedule-${source.number}-${index}`,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
        })),
      });
      console.log(`Round ${source.number}: fetched ${thread.post.comments.length} comments from ${thread.pagesFetched} page(s).`);
    } catch (error) {
      const cause = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause
        ? ` (${String(error.cause.code)})`
        : "";
      const message = `${error instanceof Error ? error.message : "Request failed"}${cause}`;
      inputs.push({
        number: source.number,
        sourceUrl: source.url,
        fetchStatus: "failed",
        fetchError: message,
        pagesFetched: 0,
        pageErrors: [],
        comments: [],
        fixtures,
        scheduleFixtures: [],
      });
      console.log(`Round ${source.number}: fetch failed: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const report = buildDiagnosticReport({
    catalog: {
      participants: participants.flatMap((person) => {
        if (!person.normalizedName) {
          return [];
        }
        return [{ id: person.id, name: person.name, normalized: person.normalizedName }];
      }),
      aliases: aliases.map((alias) => ({
        participantId: alias.participantId,
        alias: alias.alias,
        normalized: alias.normalized,
      })),
      ignored: ignored.map((author) => ({ name: author.name, normalized: author.normalized })),
    },
    baseline: checkpoint.rows.flatMap((row) => {
      if (!row.participantId) {
        return [];
      }
      return [{
        participantId: row.participantId,
        name: row.displayName,
        rank: row.rank,
        totalPoints: row.totalPoints,
      }];
    }),
    rounds: inputs,
  });

  const after = await productionFingerprint(prisma);
  const productionUnchanged = before === after;
  const output = {
    generatedAt: new Date().toISOString(),
    season: season.name,
    baselineAfterRound: checkpoint.afterRoundNumber,
    productionUnchanged,
    ...report,
  };
  const directory = reportDirectory();
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "replay-rounds-1-13.json");
  writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`Comparison: ${report.comparison}.`);
  console.log(report.eligibility);
  for (const round of report.rounds) {
    console.log(
      `Round ${round.number}: ${round.fetchStatus}, comments ${round.commentsFetched}, recognized lines ${round.predictionLinesRecognized}, scored ${round.scored ? "yes" : "no"}${round.scoreBlocker ? ` (${round.scoreBlocker})` : ""}`,
    );
  }
  console.log("name | computed | baseline | delta | scored rounds");
  for (const row of report.participants) {
    console.log(`${row.name} | ${row.computedPoints} | ${row.baselinePoints ?? "—"} | ${row.delta ?? "—"} | ${row.scoredRounds.join(",") || "—"}`);
  }
  console.log(`Report: ${file}`);
  console.log(productionUnchanged ? "Production records were unchanged by this replay." : "Production records changed during the replay.");
  if (!productionUnchanged) {
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
