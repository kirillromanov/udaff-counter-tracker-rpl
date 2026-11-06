import { defaultScoringConfig, type ScoringConfig } from "@/lib/config/scoring";
import { scoreRound } from "@/lib/domain/scoring/score-round";
import type { RoundScoreResult } from "@/lib/domain/scoring/types";

export const ROUND_STATUS_PARTIAL = "partial";
export const ROUND_STATUS_SCORED = "scored";
export const ROUND_STATUS_STALE = "stale";

export type FixtureExclusion = "pending" | "live" | "unverified" | "conflict";
export type IntermediateFixtureClass = "included" | FixtureExclusion;

export interface IntermediateFixture {
  matchId: string;
  label: string;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  isMatchOfTheRound: boolean;
  /** Stored provider lifecycle. A verified score with a live observation is not final. */
  observationStatuses: readonly string[];
}

export interface IntermediatePrediction {
  matchId: string;
  home: number | null;
  away: number | null;
  ignored: boolean;
}

export interface IntermediateParticipant {
  participantId: string;
  predictions: readonly IntermediatePrediction[];
}

export interface IntermediateRoundResult {
  status: "empty" | "partial" | "complete";
  includedCount: number;
  fixtureCount: number;
  excluded: { matchId: string; label: string; reason: FixtureExclusion }[];
  /** Whole-round bonus stays off until every canonical fixture is a verified finished result. */
  roundBonusPending: boolean;
  scores: {
    participantId: string;
    result: RoundScoreResult;
    predictedByMatch: Map<string, { home: number; away: number } | null>;
  }[];
}

function hasScore(fixture: IntermediateFixture): boolean {
  return fixture.actualHomeGoals != null && fixture.actualAwayGoals != null;
}

function isManual(fixture: IntermediateFixture): boolean {
  return fixture.resultState === "manual" || fixture.resultResolution === "manual";
}

function isVerified(fixture: IntermediateFixture): boolean {
  return isManual(fixture) || fixture.resultState === "verified" || fixture.resultResolution === "verified";
}

/**
 * A fixture enters the verified intermediate table only when the stored result is
 * verified and the match is finished. A live observation keeps a verified score out.
 * A manual score is the operator's final result.
 */
export function classifyIntermediateFixture(fixture: IntermediateFixture): IntermediateFixtureClass {
  if (fixture.resultConflict) {
    return "conflict";
  }
  const live = fixture.observationStatuses.includes("live");
  if (live && !isManual(fixture)) {
    return "live";
  }
  if (!hasScore(fixture)) {
    return "pending";
  }
  if (!isVerified(fixture)) {
    return "unverified";
  }
  if (isManual(fixture) || fixture.observationStatuses.length === 0 || fixture.observationStatuses.includes("finished")) {
    return "included";
  }
  return "unverified";
}

export function isFixtureExclusion(value: IntermediateFixtureClass): value is FixtureExclusion {
  return value !== "included";
}

export function exclusionLabel(reason: FixtureExclusion): string {
  if (reason === "pending") {
    return "not finished";
  }
  if (reason === "live") {
    return "still live";
  }
  if (reason === "conflict") {
    return "conflict";
  }
  return "finished, not verified";
}

/** Confirmed season totals use a stored final round. A partial round stays in the live delta only. */
export function countsAsConfirmedRound(status: string): boolean {
  return status === ROUND_STATUS_SCORED;
}

/**
 * Score the verified finished fixtures with the existing round scorer.
 * Pending fixtures are omitted, so they add no points and no missing-prediction penalty.
 * The round total-goals bonus is applied only when every fixture is included.
 */
export function scoreIntermediateRound(
  input: {
    roundId: string;
    fixtures: readonly IntermediateFixture[];
    participants: readonly IntermediateParticipant[];
  },
  config: ScoringConfig = defaultScoringConfig,
): IntermediateRoundResult {
  const classified = input.fixtures.map((fixture) => ({ fixture, klass: classifyIntermediateFixture(fixture) }));
  const included = classified.flatMap((item) => (item.klass === "included" ? [item.fixture] : []));
  const excluded = classified.flatMap((item) =>
    item.klass === "included" ? [] : [{ matchId: item.fixture.matchId, label: item.fixture.label, reason: item.klass }],
  );
  const fixtureCount = input.fixtures.length;
  const complete = fixtureCount > 0 && included.length === fixtureCount;
  if (included.length === 0) {
    return {
      status: "empty",
      includedCount: 0,
      fixtureCount,
      excluded,
      roundBonusPending: fixtureCount > 0,
      scores: [],
    };
  }

  const scores = input.participants.map((participant) => {
    const predictedByMatch = new Map<string, { home: number; away: number } | null>();
    const matches = included.map((fixture) => {
      const prediction = participant.predictions.find((item) => item.matchId === fixture.matchId);
      const predicted =
        prediction && !prediction.ignored && prediction.home != null && prediction.away != null
          ? { home: prediction.home, away: prediction.away }
          : null;
      predictedByMatch.set(fixture.matchId, predicted);
      return {
        matchId: fixture.matchId,
        actual: { home: fixture.actualHomeGoals as number, away: fixture.actualAwayGoals as number },
        predicted,
        isMatchOfTheRound: fixture.isMatchOfTheRound,
      };
    });
    const scored = scoreRound({ roundId: input.roundId, participantId: participant.participantId, matches }, config);
    const result: RoundScoreResult = complete
      ? scored
      : { ...scored, roundTotalGoalsBonus: 0, roundTotal: scored.matchPointsTotal };
    return { participantId: participant.participantId, result, predictedByMatch };
  });

  return {
    status: complete ? "complete" : "partial",
    includedCount: included.length,
    fixtureCount,
    excluded,
    roundBonusPending: !complete,
    scores,
  };
}
