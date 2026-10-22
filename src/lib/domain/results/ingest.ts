import { prisma } from "@/lib/db/prisma";
import { alignToFixture, applyResultDecision, attachResults, decideFixture } from "./decide";
import { RESULT_ADAPTERS, interpretSourcePage } from "./sources";
import type { SourceFetchResult } from "./types";

export interface IngestReport {
  confirmed: number;
  conflicts: number;
  sources: { source: string; role: string; status: string; matchCount: number; error: string | null }[];
}

async function readSource(adapter: (typeof RESULT_ADAPTERS)[number]): Promise<SourceFetchResult> {
  try {
    const response = await fetch(adapter.url, {
      headers: { "user-agent": "udaff-counter-tracker/0.1", accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await response.text();
    return interpretSourcePage(adapter, response.ok, html, response.ok ? null : `HTTP ${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return interpretSourcePage(adapter, false, "", message);
  }
}

export async function ingestSeasonResults(seasonId: string): Promise<IngestReport> {
  const rounds = await prisma.round.findMany({
    where: { seasonId },
    include: { matches: true },
  });
  const fetches = await Promise.all(RESULT_ADAPTERS.map((adapter) => readSource(adapter)));
  for (const fetchResult of fetches) {
    await prisma.resultFetchLog.create({
      data: {
        source: fetchResult.source,
        url: fetchResult.url,
        status: fetchResult.status,
        matchCount: fetchResult.results.length,
        error: fetchResult.error,
      },
    });
  }

  const fixtures = rounds.flatMap((round) =>
    round.matches.map((match) => ({
      id: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      roundNumber: round.number,
      resultState: match.resultState,
      actualHomeGoals: match.actualHomeGoals,
      actualAwayGoals: match.actualAwayGoals,
    })),
  );
  const byRound = new Map<number, typeof fixtures>();
  for (const fixture of fixtures) {
    const list = byRound.get(fixture.roundNumber) ?? [];
    list.push(fixture);
    byRound.set(fixture.roundNumber, list);
  }

  for (const fetchResult of fetches) {
    for (const [roundNumber, roundFixtures] of byRound) {
      const roundResults = fetchResult.results.filter((result) => result.roundNumber === roundNumber);
      const attached = attachResults(roundFixtures, roundResults);
      for (const [matchId, observations] of attached) {
        for (const observation of observations) {
          const sourceRow = roundResults.find((result) => result.sourceKey === observation.sourceKey);
          if (!sourceRow) {
            continue;
          }
          await prisma.resultObservation.upsert({
            where: { source_sourceKey: { source: sourceRow.source, sourceKey: sourceRow.sourceKey } },
            create: {
              source: sourceRow.source,
              sourceKey: sourceRow.sourceKey,
              roundNumber: sourceRow.roundNumber,
              homeTeam: sourceRow.homeTeam,
              awayTeam: sourceRow.awayTeam,
              homeGoals: sourceRow.homeGoals,
              awayGoals: sourceRow.awayGoals,
              matchId,
            },
            update: {
              roundNumber: sourceRow.roundNumber,
              homeTeam: sourceRow.homeTeam,
              awayTeam: sourceRow.awayTeam,
              homeGoals: sourceRow.homeGoals,
              awayGoals: sourceRow.awayGoals,
              matchId,
              fetchedAt: new Date(),
            },
          });
        }
      }
    }
  }

  const stored = await prisma.resultObservation.findMany({
    where: { matchId: { in: fixtures.map((fixture) => fixture.id) } },
  });
  let confirmed = 0;
  let conflicts = 0;
  for (const fixture of fixtures) {
    const aligned = stored.flatMap((row) => {
      if (row.matchId !== fixture.id) {
        return [];
      }
      const score = alignToFixture(fixture, row);
      if (!score) {
        return [];
      }
      return [{
        source: row.source,
        sourceKey: row.sourceKey,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeGoals: score.homeGoals,
        awayGoals: score.awayGoals,
      }];
    });
    const decision = decideFixture(fixture.id, aligned);
    if (decision.outcome === "none") {
      continue;
    }
    const write = applyResultDecision(fixture, decision);
    if (write.resultConflict) {
      conflicts += 1;
    } else if (write.resultState === "confirmed") {
      confirmed += 1;
    }
    await prisma.match.update({
      where: { id: fixture.id },
      data: {
        actualHomeGoals: write.actualHomeGoals,
        actualAwayGoals: write.actualAwayGoals,
        resultState: write.resultState,
        resultConflict: write.resultConflict,
        resultNote: write.resultNote,
      },
    });
  }

  return {
    confirmed,
    conflicts,
    sources: fetches.map((fetchResult) => ({
      source: fetchResult.source,
      role: fetchResult.role,
      status: fetchResult.status,
      matchCount: fetchResult.results.length,
      error: fetchResult.error,
    })),
  };
}

export async function ingestRoundResults(roundId: string): Promise<IngestReport> {
  const round = await prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { seasonId: true } });
  return ingestSeasonResults(round.seasonId);
}
