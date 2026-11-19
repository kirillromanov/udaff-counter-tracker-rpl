import { prisma } from "@/lib/db/prisma";
import { readWarnings } from "@/lib/domain/import/review-status";
import { buildReconciliationReport, type ReconciliationReport, type StoredDecision } from "./reconcile";

export interface ReconciliationPageData {
  seasonId: string;
  seasonName: string;
  checkpointLabel: string | null;
  afterRoundNumber: number | null;
  report: ReconciliationReport | null;
  roundLinks: { number: number; id: string }[];
  participants: { id: string; name: string }[];
}

const DECISIONS = new Set<StoredDecision["action"]>(["accept_computed", "keep_manual", "alias", "manual_correction"]);

function isDecision(action: string): action is StoredDecision["action"] {
  return DECISIONS.has(action as StoredDecision["action"]);
}

export async function loadReconciliation(seasonId: string): Promise<ReconciliationPageData | null> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) {
    return null;
  }
  const [checkpoint, participants, aliases] = await Promise.all([
    prisma.standingsCheckpoint.findFirst({
      where: { seasonId, source: "manual" },
      include: { rows: { orderBy: { rank: "asc" } } },
      orderBy: { afterRoundNumber: "desc" },
    }),
    prisma.participant.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
    }),
    prisma.participantAlias.findMany({ include: { participant: true } }),
  ]);
  if (!checkpoint) {
    return {
      seasonId: season.id,
      seasonName: season.name,
      checkpointLabel: null,
      afterRoundNumber: null,
      report: null,
      roundLinks: [],
      participants: participants.map((person) => ({ id: person.id, name: person.name })),
    };
  }

  const [rounds, snapshotRound, latestScored, decisions] = await Promise.all([
    prisma.round.findMany({
      where: { seasonId, number: { lte: checkpoint.afterRoundNumber } },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        name: true,
        forumUrl: true,
        sourceSnapshot: true,
        importNotes: true,
        matches: { select: { actualHomeGoals: true, actualAwayGoals: true } },
        predictionSets: {
          select: {
            participantId: true,
            status: true,
            selected: true,
            warningsJson: true,
            participant: { select: { name: true } },
          },
        },
        forumComments: {
          select: {
            authorName: true,
            reviewNote: true,
            predictionSets: { select: { id: true } },
          },
        },
      },
    }),
    prisma.round.findUnique({
      where: { seasonId_number: { seasonId, number: checkpoint.afterRoundNumber } },
      include: { standingSnapshots: true },
    }),
    prisma.round.findFirst({
      where: { seasonId, standingSnapshots: { some: {} } },
      orderBy: { number: "desc" },
      select: { number: true },
    }),
    prisma.reconciliationDecision.findMany({
      where: { seasonId, afterRoundNumber: checkpoint.afterRoundNumber },
    }),
  ]);

  const computed =
    snapshotRound && snapshotRound.standingSnapshots.length > 0
      ? snapshotRound.standingSnapshots.map((row) => ({
          participantId: row.participantId,
          rank: row.rank,
          totalPoints: row.totalPoints,
          movement: row.movement,
          previousRank: row.previousRank,
          roundWins: row.roundWins,
        }))
      : null;

  const report = buildReconciliationReport({
    afterRoundNumber: checkpoint.afterRoundNumber,
    checkpoint: checkpoint.rows.map((row) => ({
      participantId: row.participantId,
      displayName: row.displayName,
      rank: row.rank,
      totalPoints: row.totalPoints,
      movement: row.movement,
      movementDelta: row.movementDelta,
      previousRank: row.previousRank,
      markerCount: row.markerCount,
    })),
    computed,
    latestScoredRound: latestScored?.number ?? null,
    rounds: rounds.map((round) => {
      const unknown = new Map<string, number>();
      for (const comment of round.forumComments) {
        const note = comment.reviewNote ?? "";
        const unmatched =
          comment.predictionSets.length === 0 &&
          (note.includes("not in the registry") || note === "Uncertain identity match");
        if (!unmatched) {
          continue;
        }
        unknown.set(comment.authorName, (unknown.get(comment.authorName) ?? 0) + 1);
      }
      return {
        number: round.number,
        name: round.name,
        forumUrl: round.forumUrl,
        openingText: round.sourceSnapshot,
        importNotes: round.importNotes,
        fixtureCount: round.matches.length,
        scoredFixtureCount: round.matches.filter((match) => match.actualHomeGoals != null && match.actualAwayGoals != null)
          .length,
        acceptedParticipantIds: [
          ...new Set(
            round.predictionSets
              .filter((set) => set.selected && set.status === "accepted")
              .map((set) => set.participantId),
          ),
        ],
        flagged: round.predictionSets
          .filter((set) => set.status === "flagged")
          .map((set) => ({
            participantId: set.participantId,
            participantName: set.participant.name,
            selected: set.selected,
            warnings: readWarnings(set.warningsJson),
          })),
        unknownAuthors: [...unknown.entries()].map(([name, commentCount]) => ({ name, commentCount })),
      };
    }),
    registry: participants.map((person) => ({ participantId: person.id, name: person.name })),
    aliases: aliases.map((alias) => ({
      participantId: alias.participantId,
      participantName: alias.participant.name,
      alias: alias.alias,
      primary: alias.isPrimary,
    })),
    decisions: decisions.flatMap((decision) =>
      isDecision(decision.action)
        ? [
            {
              subjectName: decision.subjectName,
              action: decision.action,
              note: decision.note,
              participantId: decision.participantId,
            },
          ]
        : [],
    ),
  });

  return {
    seasonId: season.id,
    seasonName: season.name,
    checkpointLabel: checkpoint.label,
    afterRoundNumber: checkpoint.afterRoundNumber,
    report,
    roundLinks: rounds.map((round) => ({ number: round.number, id: round.id })),
    participants: participants.map((person) => ({ id: person.id, name: person.name })),
  };
}
