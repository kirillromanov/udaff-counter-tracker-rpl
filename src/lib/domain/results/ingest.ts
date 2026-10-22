import { prisma } from "@/lib/db/prisma";
import { alignToFixture, applyResultDecision, attachResults, type AlignedObservation, type FixtureSide } from "./decide";
import { collectSourceFetches, nextSourceHealth, resolveFixture, unavailableSources, type SourceHealth } from "./policy";
import { RESULT_ADAPTERS, interpretSourcePage } from "./sources";
import type { ConfidenceLevel, SourceFetchResult, SourceMatch, SourceRole } from "./types";

function sourceRole(value: string): SourceRole {
  if (value === "primary" || value === "verification") {
    return value;
  }
  return "fallback";
}

function confidenceLevel(value: string): ConfidenceLevel {
  if (value === "high" || value === "low") {
    return value;
  }
  return "medium";
}

export interface IngestReport {
  confirmed: number;
  verified: number;
  conflicts: number;
  sources: { source: string; role: string; status: string; matchCount: number; error: string | null }[];
}

async function readSource(adapter: (typeof RESULT_ADAPTERS)[number]): Promise<SourceFetchResult> {
  if (adapter.load) {
    return adapter.load();
  }
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
  const fetches = await collectSourceFetches(RESULT_ADAPTERS, readSource);
  const previousHealth = await prisma.resultSourceHealth.findMany();
  const previousBySource = new Map(previousHealth.map((row) => [row.source, row]));
  const health: SourceHealth[] = [];
  const fetchedAt = new Date();
  for (const fetchResult of fetches) {
    const previous = previousBySource.get(fetchResult.source);
    const next = nextSourceHealth(
      previous
        ? {
            source: previous.source,
            role: sourceRole(previous.role),
            lastSuccessAt: previous.lastSuccessAt,
            lastFailureAt: previous.lastFailureAt,
            consecutiveFailures: previous.consecutiveFailures,
            degraded: previous.degraded,
            lastError: previous.lastError,
          }
        : null,
      { source: fetchResult.source, role: fetchResult.role, status: fetchResult.status, error: fetchResult.error, at: fetchedAt },
    );
    health.push(next);
    await prisma.resultFetchLog.create({
      data: {
        source: fetchResult.source,
        url: fetchResult.url,
        status: fetchResult.status,
        matchCount: fetchResult.results.length,
        error: fetchResult.error,
        role: fetchResult.role,
      },
    });
    await prisma.resultSourceHealth.upsert({
      where: { source: next.source },
      create: next,
      update: {
        role: next.role,
        lastSuccessAt: next.lastSuccessAt,
        lastFailureAt: next.lastFailureAt,
        consecutiveFailures: next.consecutiveFailures,
        degraded: next.degraded,
        lastError: next.lastError,
      },
    });
  }
  const unavailable = unavailableSources(fetches, health);

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

  async function storeAttached(roundFixtures: readonly FixtureSide[], roundResults: readonly SourceMatch[]) {
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
            role: sourceRow.role,
            confidence: sourceRow.confidence,
            matchStatus: sourceRow.matchStatus ?? "finished",
            completeness: sourceRow.completeness ?? "complete",
            matchId,
          },
          update: {
            roundNumber: sourceRow.roundNumber,
            homeTeam: sourceRow.homeTeam,
            awayTeam: sourceRow.awayTeam,
            homeGoals: sourceRow.homeGoals,
            awayGoals: sourceRow.awayGoals,
            role: sourceRow.role,
            confidence: sourceRow.confidence,
            matchStatus: sourceRow.matchStatus ?? "finished",
            completeness: sourceRow.completeness ?? "complete",
            matchId,
            fetchedAt: new Date(),
          },
        });
      }
    }
  }

  for (const fetchResult of fetches) {
    const dated = fetchResult.results.filter((result) => result.roundNumber != null);
    const undated = fetchResult.results.filter((result) => result.roundNumber == null);
    for (const [roundNumber, roundFixtures] of byRound) {
      await storeAttached(roundFixtures, dated.filter((result) => result.roundNumber === roundNumber));
    }
    await storeAttached(fixtures, undated);
  }

  const stored = await prisma.resultObservation.findMany({
    where: { matchId: { in: fixtures.map((fixture) => fixture.id) } },
  });
  let confirmed = 0;
  let verified = 0;
  let conflicts = 0;
  for (const fixture of fixtures) {
    const aligned: AlignedObservation[] = stored.flatMap((row) => {
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
        role: sourceRole(row.role),
        confidence: confidenceLevel(row.confidence),
        matchStatus: row.matchStatus,
        completeness: row.completeness,
      }];
    });
    const decision = resolveFixture(fixture.id, aligned, unavailable);
    if (decision.outcome === "none") {
      continue;
    }
    const write = applyResultDecision(fixture, decision);
    if (write.resultConflict) {
      conflicts += 1;
    } else if (write.resultState === "verified") {
      verified += 1;
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
    verified,
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
