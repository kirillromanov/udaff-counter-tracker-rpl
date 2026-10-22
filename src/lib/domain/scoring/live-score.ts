import { defaultScoringConfig, type ScoringConfig } from "@/lib/config/scoring";
import { rankMovement } from "./movement";
import { roundTotalGoalsBonus, scoreRound } from "./score-round";
import { scoreMatch } from "./score-match";
import type { Movement } from "./types";

/** How a fixture affects the live table. Verified points stay labeled even inside a live round. */
export type LiveConfidence = "verified" | "provisional" | "conflict" | "pending";

export interface LiveFixtureInput {
  matchId: string;
  label: string;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledged: boolean;
  isMatchOfTheRound: boolean;
}

export interface LivePrediction {
  matchId: string;
  home: number;
  away: number;
}

export interface LiveMatchLine {
  matchId: string;
  label: string;
  confidence: LiveConfidence;
  acknowledgedConflict: boolean;
  points: number | null;
  category: string | null;
  predicted: string;
  actual: string;
}

export interface LiveParticipantScore {
  participantId: string;
  confirmedPoints: number;
  provisionalPoints: number;
  livePoints: number;
  pendingCount: number;
  conflictCount: number;
  roundBonus: number;
  matches: LiveMatchLine[];
}

export interface RankedLiveScore extends LiveParticipantScore {
  name: string;
  rank: number;
}

export interface LiveSeasonRoundInput {
  order: number;
  /** Every fixture is verified, so the round may enter the confirmed season total. */
  complete: boolean;
  scores: { participantId: string; confirmedPoints: number; provisionalPoints: number }[];
}

export interface LiveBaselineRow {
  participantId: string | null;
  name: string;
  points: number;
  medals: number;
}

export interface LiveSeasonRow {
  participantId: string;
  name: string;
  baselinePoints: number;
  confirmedRoundPoints: number;
  liveDelta: number;
  confirmedTotal: number;
  liveTotal: number;
  medals: number;
  confirmedRank: number;
  liveRank: number;
  movement: Movement;
}

function hasScore(fixture: LiveFixtureInput): boolean {
  return fixture.actualHomeGoals != null && fixture.actualAwayGoals != null;
}

function isVerifiedFixture(fixture: LiveFixtureInput): boolean {
  return (
    fixture.resultState === "manual" ||
    fixture.resultState === "verified" ||
    fixture.resultResolution === "verified" ||
    fixture.resultResolution === "manual"
  );
}

/** Verified scores can become confirmed points. A dispute does not. A blank score stays pending. */
export function fixtureConfidence(fixture: LiveFixtureInput): LiveConfidence {
  if (fixture.resultConflict && !fixture.conflictAcknowledged) {
    return "conflict";
  }
  if (!hasScore(fixture)) {
    return "pending";
  }
  if (fixture.resultConflict) {
    return "provisional";
  }
  if (isVerifiedFixture(fixture)) {
    return "verified";
  }
  return "provisional";
}

export function confidenceLabel(confidence: LiveConfidence, acknowledgedConflict: boolean): string {
  if (confidence === "verified") {
    return "verified";
  }
  if (confidence === "conflict") {
    return "conflict";
  }
  if (confidence === "pending") {
    return "pending";
  }
  return acknowledgedConflict ? "conflict acknowledged" : "provisional";
}

export function roundIsComplete(fixtures: readonly LiveFixtureInput[]): boolean {
  return fixtures.length > 0 && fixtures.every((fixture) => fixtureConfidence(fixture) === "verified");
}

/**
 * Score one participant from the fixtures that currently have a usable result.
 * The round-total bonus is included only when every fixture is verified.
 */
export function scoreLiveParticipant(
  participantId: string,
  fixtures: readonly LiveFixtureInput[],
  predictions: readonly LivePrediction[],
  config: ScoringConfig = defaultScoringConfig,
): LiveParticipantScore {
  const predictedByMatch = new Map(predictions.map((prediction) => [prediction.matchId, prediction]));
  const complete = roundIsComplete(fixtures);
  const confirmedInputs = [];
  const lines: LiveMatchLine[] = [];
  let confirmedPoints = 0;
  let provisionalPoints = 0;
  let pendingCount = 0;
  let conflictCount = 0;

  for (const fixture of fixtures) {
    const confidence = fixtureConfidence(fixture);
    const prediction = predictedByMatch.get(fixture.matchId);
    const acknowledgedConflict = fixture.resultConflict && fixture.conflictAcknowledged;
    if (confidence === "pending") {
      pendingCount += 1;
      lines.push({
        matchId: fixture.matchId,
        label: fixture.label,
        confidence,
        acknowledgedConflict: false,
        points: null,
        category: null,
        predicted: prediction ? `${prediction.home}-${prediction.away}` : "—",
        actual: "—",
      });
      continue;
    }
    if (confidence === "conflict") {
      conflictCount += 1;
      lines.push({
        matchId: fixture.matchId,
        label: fixture.label,
        confidence,
        acknowledgedConflict: false,
        points: null,
        category: null,
        predicted: prediction ? `${prediction.home}-${prediction.away}` : "—",
        actual:
          fixture.actualHomeGoals != null && fixture.actualAwayGoals != null
            ? `${fixture.actualHomeGoals}-${fixture.actualAwayGoals}`
            : "—",
      });
      continue;
    }

    const actual = { home: fixture.actualHomeGoals as number, away: fixture.actualAwayGoals as number };
    const scored = scoreMatch(
      {
        matchId: fixture.matchId,
        actual,
        predicted: prediction ? { home: prediction.home, away: prediction.away } : null,
        isMatchOfTheRound: fixture.isMatchOfTheRound,
      },
      config,
    );
    if (confidence === "verified") {
      confirmedPoints += scored.finalMatchPoints;
      confirmedInputs.push({
        matchId: fixture.matchId,
        actual,
        predicted: prediction ? { home: prediction.home, away: prediction.away } : null,
        isMatchOfTheRound: fixture.isMatchOfTheRound,
      });
    } else {
      provisionalPoints += scored.finalMatchPoints;
    }
    lines.push({
      matchId: fixture.matchId,
      label: fixture.label,
      confidence,
      acknowledgedConflict,
      points: scored.finalMatchPoints,
      category: scored.baseCategory,
      predicted: prediction ? `${prediction.home}-${prediction.away}` : "—",
      actual: `${actual.home}-${actual.away}`,
    });
  }

  const roundBonus = complete
    ? roundTotalGoalsBonus(confirmedInputs, config)
    : 0;
  if (complete) {
    const full = scoreRound(
      { roundId: "live", participantId, matches: confirmedInputs },
      config,
    );
    confirmedPoints = full.roundTotal;
  }

  return {
    participantId,
    confirmedPoints,
    provisionalPoints,
    livePoints: confirmedPoints + provisionalPoints,
    pendingCount,
    conflictCount,
    roundBonus,
    matches: lines,
  };
}

export function rankLiveScores(
  rows: readonly (LiveParticipantScore & { name: string })[],
): RankedLiveScore[] {
  const ordered = [...rows].sort((left, right) => {
    if (right.livePoints !== left.livePoints) {
      return right.livePoints - left.livePoints;
    }
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }
    return left.participantId.localeCompare(right.participantId);
  });
  return ordered.map((row, index) => ({ ...row, rank: index + 1 }));
}

function baselineKey(row: LiveBaselineRow): string {
  return row.participantId ?? `baseline:${row.name}`;
}

/**
 * Confirmed season total is the trusted baseline plus later rounds whose fixtures are all verified.
 * Points from an unfinished round stay in the live delta, including that round's already verified matches.
 */
export function buildLiveSeasonTable(input: {
  baselineAfterRound: number | null;
  baseline: readonly LiveBaselineRow[];
  participants: readonly { id: string; name: string }[];
  rounds: readonly LiveSeasonRoundInput[];
}): LiveSeasonRow[] {
  const names = new Map<string, string>();
  const baselinePoints = new Map<string, number>();
  const baselineMedals = new Map<string, number>();
  for (const row of input.baseline) {
    const key = baselineKey(row);
    names.set(key, row.name);
    baselinePoints.set(key, row.points);
    baselineMedals.set(key, row.medals);
  }
  for (const participant of input.participants) {
    if (!names.has(participant.id)) {
      names.set(participant.id, participant.name);
    }
  }

  const confirmedRoundPoints = new Map<string, number>();
  const liveDelta = new Map<string, number>();
  const extraMedals = new Map<string, number>();
  const floor = input.baselineAfterRound ?? 0;

  for (const round of input.rounds) {
    if (round.order <= floor) {
      continue;
    }
    if (round.complete) {
      const scored = round.scores;
      for (const score of scored) {
        names.set(score.participantId, names.get(score.participantId) ?? score.participantId);
        confirmedRoundPoints.set(
          score.participantId,
          (confirmedRoundPoints.get(score.participantId) ?? 0) + score.confirmedPoints,
        );
      }
      if (scored.length > 0) {
        const max = Math.max(...scored.map((score) => score.confirmedPoints));
        for (const score of scored) {
          if (score.confirmedPoints === max) {
            extraMedals.set(score.participantId, (extraMedals.get(score.participantId) ?? 0) + 1);
          }
        }
      }
      continue;
    }
    for (const score of round.scores) {
      names.set(score.participantId, names.get(score.participantId) ?? score.participantId);
      liveDelta.set(
        score.participantId,
        (liveDelta.get(score.participantId) ?? 0) + score.confirmedPoints + score.provisionalPoints,
      );
    }
  }

  const draft = [...names.entries()].map(([participantId, name]) => {
    const baseline = baselinePoints.get(participantId) ?? 0;
    const confirmedRounds = confirmedRoundPoints.get(participantId) ?? 0;
    const delta = liveDelta.get(participantId) ?? 0;
    const confirmedTotal = baseline + confirmedRounds;
    return {
      participantId,
      name,
      baselinePoints: baseline,
      confirmedRoundPoints: confirmedRounds,
      liveDelta: delta,
      confirmedTotal,
      liveTotal: confirmedTotal + delta,
      medals: (baselineMedals.get(participantId) ?? 0) + (extraMedals.get(participantId) ?? 0),
      confirmedRank: 0,
      liveRank: 0,
      movement: "new" as Movement,
    };
  });

  const byConfirmed = [...draft].sort(compareSeason);
  byConfirmed.forEach((row, index) => {
    row.confirmedRank = index + 1;
  });
  const confirmedRank = new Map(byConfirmed.map((row) => [row.participantId, row.confirmedRank]));
  const byLive = [...draft].sort((left, right) => {
    if (right.liveTotal !== left.liveTotal) {
      return right.liveTotal - left.liveTotal;
    }
    return compareSeason(left, right);
  });
  return byLive.map((row, index) => {
    const previous = confirmedRank.get(row.participantId) ?? null;
    const liveRank = index + 1;
    return {
      ...row,
      confirmedRank: previous ?? liveRank,
      liveRank,
      movement: rankMovement(liveRank, previous),
    };
  });
}

function compareSeason(left: LiveSeasonRow, right: LiveSeasonRow): number {
  if (right.confirmedTotal !== left.confirmedTotal) {
    return right.confirmedTotal - left.confirmedTotal;
  }
  if (right.medals !== left.medals) {
    return right.medals - left.medals;
  }
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) {
    return byName;
  }
  return left.participantId.localeCompare(right.participantId);
}
