import { prisma } from "@/lib/db/prisma";
import { defaultScoringConfig, scoringConfigFromRecord } from "@/lib/config/scoring";
import {
  buildLiveSeasonTable,
  fixtureConfidence,
  rankLiveScores,
  roundIsComplete,
  scoreLiveParticipant,
  type LiveFixtureInput,
  type LiveSeasonRow,
  type RankedLiveScore,
} from "@/lib/domain/scoring/live-score";
import { oneSelectedSetPerParticipant } from "./recalculate-round";

function toFixture(match: {
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

export interface LiveRoundView {
  complete: boolean;
  fixtures: LiveFixtureInput[];
  rows: RankedLiveScore[];
}

/** Read the current fixtures and selected slips. This does not write scores or the baseline. */
export async function loadLiveRound(roundId: string): Promise<LiveRoundView | null> {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      matches: { orderBy: { sortOrder: "asc" } },
      season: { include: { scoringConfig: true } },
      predictionSets: { where: { selected: true }, include: { predictions: true, participant: true } },
    },
  });
  if (!round) {
    return null;
  }
  const config = round.season.scoringConfig ? scoringConfigFromRecord(round.season.scoringConfig) : defaultScoringConfig;
  const fixtures = round.matches.map(toFixture);
  const names = new Map(round.predictionSets.map((set) => [set.participantId, set.participant.name]));
  const sets = oneSelectedSetPerParticipant(round.predictionSets);
  const rows = rankLiveScores(
    sets.map((set) => {
      const predictions = set.predictions.flatMap((prediction) =>
        prediction.ignored || prediction.homeGoals == null || prediction.awayGoals == null
          ? []
          : [{ matchId: prediction.matchId, home: prediction.homeGoals, away: prediction.awayGoals }],
      );
      return {
        ...scoreLiveParticipant(set.participantId, fixtures, predictions, config),
        name: names.get(set.participantId) ?? set.participantId,
      };
    }),
  );
  return { complete: roundIsComplete(fixtures), fixtures, rows };
}

export interface LiveSeasonView {
  baselineAfterRound: number | null;
  baselineLabel: string | null;
  rows: LiveSeasonRow[];
  unverifiedRounds: { number: number; name: string | null }[];
  /** In progress, but already covered by the trusted baseline, so their points are not added again. */
  baselineOpenRounds: { id: string; number: number; name: string | null }[];
  verifiedUnstored: { number: number; name: string | null }[];
}

/**
 * Baseline plus verified rounds after it, with a separate delta for rounds that are still open.
 * The checkpoint rows are only read.
 */
export async function loadLiveSeason(seasonId: string): Promise<LiveSeasonView> {
  const [checkpoint, memberships, rounds] = await Promise.all([
    prisma.standingsCheckpoint.findFirst({
      where: { seasonId },
      orderBy: { afterRoundNumber: "desc" },
      include: { rows: { orderBy: { rank: "asc" } } },
    }),
    prisma.seasonParticipant.findMany({ where: { seasonId }, include: { participant: true } }),
    prisma.round.findMany({
      where: { seasonId },
      orderBy: { number: "asc" },
      include: {
        matches: { orderBy: { sortOrder: "asc" } },
        roundScores: true,
        season: { include: { scoringConfig: true } },
        predictionSets: { where: { selected: true }, include: { predictions: true, participant: true } },
      },
    }),
  ]);

  const baselineAfterRound = checkpoint?.afterRoundNumber ?? null;
  const unverifiedRounds: { number: number; name: string | null }[] = [];
  const baselineOpenRounds: { id: string; number: number; name: string | null }[] = [];
  const verifiedUnstored: { number: number; name: string | null }[] = [];
  const seasonRounds = rounds.flatMap((round) => {
    const insideBaseline = baselineAfterRound != null && round.number <= baselineAfterRound;
    const fixtures = round.matches.map(toFixture);
    const complete = roundIsComplete(fixtures);
    if (!complete) {
      if (insideBaseline) {
        baselineOpenRounds.push({ id: round.id, number: round.number, name: round.name });
        return [];
      }
      unverifiedRounds.push({ number: round.number, name: round.name });
      const config = round.season.scoringConfig ? scoringConfigFromRecord(round.season.scoringConfig) : defaultScoringConfig;
      const sets = oneSelectedSetPerParticipant(round.predictionSets);
      return [
        {
          order: round.number,
          complete: false,
          scores: sets.map((set) => {
            const predictions = set.predictions.flatMap((prediction) =>
              prediction.ignored || prediction.homeGoals == null || prediction.awayGoals == null
                ? []
                : [{ matchId: prediction.matchId, home: prediction.homeGoals, away: prediction.awayGoals }],
            );
            const scored = scoreLiveParticipant(set.participantId, fixtures, predictions, config);
            return {
              participantId: set.participantId,
              confirmedPoints: scored.confirmedPoints,
              provisionalPoints: scored.provisionalPoints,
            };
          }),
        },
      ];
    }
    if (round.roundScores.length === 0) {
      if (!insideBaseline) {
        verifiedUnstored.push({ number: round.number, name: round.name });
      }
      return [];
    }
    return [
      {
        order: round.number,
        complete: true,
        scores: round.roundScores.map((score) => ({
          participantId: score.participantId,
          confirmedPoints: score.totalPoints,
          provisionalPoints: 0,
        })),
      },
    ];
  });

  return {
    baselineAfterRound: checkpoint?.afterRoundNumber ?? null,
    baselineLabel: checkpoint?.label ?? null,
    unverifiedRounds,
    baselineOpenRounds,
    verifiedUnstored,
    rows: buildLiveSeasonTable({
      baselineAfterRound,
      baseline: (checkpoint?.rows ?? []).map((row) => ({
        participantId: row.participantId,
        name: row.displayName,
        points: row.totalPoints,
        medals: row.markerCount,
      })),
      participants: memberships.map((membership) => ({ id: membership.participantId, name: membership.participant.name })),
      rounds: seasonRounds,
    }),
  };
}

export function fixtureMode(match: Parameters<typeof toFixture>[0]): ReturnType<typeof fixtureConfidence> {
  return fixtureConfidence(toFixture(match));
}
