import { decideFixture, partitionResultAttachments, type FixtureSide, type NameMatch } from "./decide";
import type { SourceFetchResult, SourceMatch } from "./types";

export interface ObservedFixtureInput extends FixtureSide {
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
}

export interface ObservedFixture {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  storedHomeGoals: number | null;
  storedAwayGoals: number | null;
  source: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  outcome: string;
  resolution: string;
  nameMatch: NameMatch | null;
  agreesWithStored: boolean | null;
  note: string;
}

export interface ObservedSource {
  source: string;
  status: string;
  matchCount: number;
  error: string | null;
}

export interface ObserveRoundReport {
  roundNumber: number;
  fixtures: ObservedFixture[];
  sources: ObservedSource[];
  ambiguous: { source: string; homeTeam: string; awayTeam: string; homeGoals: number; awayGoals: number }[];
}

/** What a result check would decide. This function does not fetch or write. */
export function observeRoundDecisions(input: {
  roundNumber: number;
  fixtures: readonly ObservedFixtureInput[];
  fetches: readonly SourceFetchResult[];
}): ObserveRoundReport {
  const dated: SourceMatch[] = [];
  for (const fetchResult of input.fetches) {
    for (const result of fetchResult.results) {
      if (result.roundNumber == null || result.roundNumber === input.roundNumber) {
        dated.push(result);
      }
    }
  }
  const { attached, ambiguous } = partitionResultAttachments(input.fixtures, dated);
  const fixtures = input.fixtures.map((fixture) => {
    const observations = attached.get(fixture.id) ?? [];
    const decision = decideFixture(fixture.id, observations);
    const nameMatch = observations.find((item) => item.nameMatch)?.nameMatch ?? null;
    const source = decision.selectedSource ?? observations[0]?.source ?? null;
    const agrees = decision.homeGoals == null
      ? null
      : decision.homeGoals === fixture.actualHomeGoals && decision.awayGoals === fixture.actualAwayGoals;
    return {
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      storedHomeGoals: fixture.actualHomeGoals,
      storedAwayGoals: fixture.actualAwayGoals,
      source,
      homeGoals: decision.homeGoals,
      awayGoals: decision.awayGoals,
      outcome: decision.outcome === "confirmed" ? "provisional" : decision.outcome,
      resolution: decision.resolution,
      nameMatch,
      agreesWithStored: agrees,
      note: decision.note,
    };
  });
  return {
    roundNumber: input.roundNumber,
    fixtures,
    sources: input.fetches.map((fetchResult) => ({
      source: fetchResult.source,
      status: fetchResult.status,
      matchCount: fetchResult.results.length,
      error: fetchResult.error,
    })),
    ambiguous: ambiguous.map((result) => ({
      source: result.source,
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      homeGoals: result.homeGoals,
      awayGoals: result.awayGoals,
    })),
  };
}
