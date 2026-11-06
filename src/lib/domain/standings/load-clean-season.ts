import { prisma } from "@/lib/db/prisma";
import { defaultScoringConfig, scoringConfigFromRecord } from "@/lib/config/scoring";
import { scoreLiveParticipant, type LiveFixtureInput } from "@/lib/domain/scoring/live-score";
import { buildCleanSeasonStandings, type CleanSeasonTable } from "./clean-season";
import { countsAsConfirmedRound } from "./intermediate";
import { oneSelectedSetPerParticipant } from "./recalculate-round";
import { countsTowardProduction } from "./round-role";

function toFixture(match: {
  id: string;
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
    label: match.id,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledged: match.conflictAcknowledgedAt != null,
    isMatchOfTheRound: match.isMatchOfTheRound,
  };
}

/** Read the confirmed season table. This does not write scores, snapshots, or the baseline. */
export async function loadCleanSeason(seasonId: string): Promise<CleanSeasonTable | null> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: {
      scoringConfig: true,
      participants: { include: { participant: true } },
      checkpoints: {
        where: { source: "manual" },
        orderBy: { afterRoundNumber: "desc" },
        take: 1,
        include: { rows: { orderBy: { rank: "asc" } } },
      },
      rounds: {
        orderBy: { number: "asc" },
        include: {
          matches: true,
          roundScores: true,
          predictionSets: { where: { selected: true }, include: { predictions: true } },
        },
      },
    },
  });
  if (!season) {
    return null;
  }
  const checkpoint = season.checkpoints[0] ?? null;
  const cutoff = checkpoint?.afterRoundNumber ?? null;
  const config = season.scoringConfig ? scoringConfigFromRecord(season.scoringConfig) : defaultScoringConfig;
  const confirmedRounds: { roundId: string; order: number; scores: { participantId: string; points: number }[] }[] = [];
  const liveRounds: { roundId: string; order: number; scores: { participantId: string; points: number }[] }[] = [];

  for (const round of season.rounds) {
    if (!countsTowardProduction(round.standingRole, round.number, cutoff)) {
      continue;
    }
    const fixtures = round.matches.map(toFixture);
    if (countsAsConfirmedRound(round.status) && round.roundScores.length > 0) {
      confirmedRounds.push({
        roundId: round.id,
        order: round.number,
        scores: round.roundScores.map((score) => ({ participantId: score.participantId, points: score.totalPoints })),
      });
      continue;
    }
    const sets = oneSelectedSetPerParticipant(round.predictionSets);
    if (sets.length === 0) {
      continue;
    }
    liveRounds.push({
      roundId: round.id,
      order: round.number,
      scores: sets.map((set) => {
        const predictions = set.predictions.flatMap((prediction) =>
          prediction.ignored || prediction.homeGoals == null || prediction.awayGoals == null
            ? []
            : [{ matchId: prediction.matchId, home: prediction.homeGoals, away: prediction.awayGoals }],
        );
        const scored = scoreLiveParticipant(set.participantId, fixtures, predictions, config);
        return { participantId: set.participantId, points: scored.confirmedPoints + scored.provisionalPoints };
      }),
    });
  }

  return buildCleanSeasonStandings({
    baselineAfterRound: cutoff,
    baseline: (checkpoint?.rows ?? []).map((row) => ({
      participantId: row.participantId,
      name: row.displayName,
      points: row.totalPoints,
      medals: row.markerCount,
      rank: row.rank,
      movement: row.movement,
      previousRank: row.previousRank,
    })),
    participants: season.participants.map((membership) => ({
      id: membership.participantId,
      name: membership.participant.name,
    })),
    confirmedRounds,
    liveRounds,
  });
}
