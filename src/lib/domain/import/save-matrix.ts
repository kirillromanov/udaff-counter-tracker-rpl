import { prisma } from "@/lib/db/prisma";
import { recalculateRound } from "@/lib/domain/standings/recalculate-round";
import { applyAutoSelection } from "./persist-import";
import {
  appendCorrection,
  formatCellScore,
  parseCellScore,
  revisionToken,
  revisionsMatch,
  scoreLabel,
  type CorrectionEntry,
} from "./matrix-edits";

function cellValue(formData: FormData, participantId: string, matchId: string): string {
  const picked = String(formData.get(`pick_${participantId}_${matchId}`) ?? "").trim();
  if (picked) {
    return picked;
  }
  return String(formData.get(`score_${participantId}_${matchId}`) ?? "");
}

export async function saveCleanMatrix(roundId: string, formData: FormData, recalculate: boolean): Promise<void> {
  const round = await prisma.round.findUniqueOrThrow({
    where: { id: roundId },
    include: {
      matches: { orderBy: { sortOrder: "asc" } },
      season: {
        include: {
          participants: {
            where: { status: "included", participant: { archivedAt: null } },
            include: { participant: true },
          },
        },
      },
    },
  });
  const sets = await prisma.predictionSet.findMany({
    where: { roundId },
    include: { predictions: true },
  });
  const roster = round.season.participants.map((membership) => membership.participant);

  for (const person of roster) {
    const selected = sets
      .filter((set) => set.participantId === person.id && set.selected)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;
    const submitted = String(formData.get(`revision_${person.id}`) ?? "");
    if (submitted && !revisionsMatch(revisionToken(selected?.updatedAt ?? null), submitted)) {
      throw new Error(`${person.name} was updated after this page opened. Reload the review and save again.`);
    }
  }

  const now = new Date().toISOString();
  await prisma.$transaction(async (tx) => {
    for (const set of sets) {
      const nextOwner = String(formData.get(`owner_${set.id}`) ?? "");
      if (!nextOwner || nextOwner === set.participantId) {
        continue;
      }
      if (!roster.some((person) => person.id === nextOwner)) {
        throw new Error("The corrected owner has to be on this season roster.");
      }
      const entry: CorrectionEntry = {
        at: now,
        field: "owner",
        oldValue: set.participantId,
        newValue: nextOwner,
      };
      await tx.predictionSet.update({
        where: { id: set.id },
        data: {
          participantId: nextOwner,
          attributionMethod: "manual",
          attributionReview: "clear",
          attributionEvidence: "Operator changed the prediction owner",
          manuallyEdited: true,
          selection: "manual",
          selected: true,
          correctionLog: appendCorrection(set.correctionLog, entry),
        },
      });
      await tx.predictionSet.updateMany({
        where: { roundId, participantId: nextOwner, id: { not: set.id } },
        data: { selected: false, selection: "auto" },
      });
    }

    for (const person of roster) {
      const predictions = round.matches.map((match) => {
        const score = parseCellScore(cellValue(formData, person.id, match.id));
        return {
          matchId: match.id,
          homeGoals: score?.home ?? null,
          awayGoals: score?.away ?? null,
          ignored: score == null,
        };
      });
      const current = await tx.predictionSet.findFirst({
        where: { roundId, participantId: person.id, selected: true },
        include: { predictions: true },
        orderBy: { updatedAt: "desc" },
      });
      const changes: CorrectionEntry[] = [];
      for (const prediction of predictions) {
        const previous = current?.predictions.find((item) => item.matchId === prediction.matchId);
        const oldValue = scoreLabel(previous?.homeGoals ?? null, previous?.awayGoals ?? null);
        const newValue = scoreLabel(prediction.homeGoals, prediction.awayGoals);
        if (oldValue !== newValue) {
          changes.push({ at: now, field: prediction.matchId, oldValue, newValue });
        }
      }
      let keepId = current?.id ?? "";
      if (current) {
        await tx.prediction.deleteMany({ where: { predictionSetId: current.id } });
        await tx.predictionSet.update({
          where: { id: current.id },
          data: {
            manuallyEdited: true,
            selection: "manual",
            selected: true,
            correctionLog: changes.reduce((log, entry) => appendCorrection(log, entry), current.correctionLog),
            predictions: { create: predictions },
          },
        });
      } else if (predictions.some((prediction) => !prediction.ignored) || formData.get(`revision_${person.id}`) === "new") {
        const created = await tx.predictionSet.create({
          data: {
            roundId,
            participantId: person.id,
            source: "manual",
            status: "reviewed",
            selected: true,
            selection: "manual",
            manuallyEdited: true,
            attributionMethod: "manual",
            attributionEvidence: "Entered on the clean review matrix",
            correctionLog: JSON.stringify(changes),
            predictions: { create: predictions },
          },
        });
        keepId = created.id;
      }
      if (keepId) {
        await tx.predictionSet.updateMany({
          where: { roundId, participantId: person.id, selected: true, id: { not: keepId } },
          data: { selected: false, selection: "auto" },
        });
      }
    }
  });

  await applyAutoSelection(roundId);
  if (recalculate) {
    await recalculateRound(roundId);
  }
}

export async function saveMatrixResults(roundId: string, formData: FormData): Promise<void> {
  const matches = await prisma.match.findMany({ where: { roundId } });
  for (const match of matches) {
    const homeText = String(formData.get(`actual_${match.id}_home`) ?? "").trim();
    const awayText = String(formData.get(`actual_${match.id}_away`) ?? "").trim();
    if ((homeText === "") !== (awayText === "")) {
      throw new Error(`${match.homeTeam} — ${match.awayTeam} needs both scores, or both fields cleared.`);
    }
    const home = homeText === "" ? null : Number(homeText);
    const away = awayText === "" ? null : Number(awayText);
    if ((home != null && !Number.isInteger(home)) || (away != null && !Number.isInteger(away))) {
      throw new Error("Actual scores have to be whole numbers.");
    }
    if (home === match.actualHomeGoals && away === match.actualAwayGoals) {
      continue;
    }
    await prisma.match.update({
      where: { id: match.id },
      data: {
        actualHomeGoals: home,
        actualAwayGoals: away,
        resultState: home == null ? "open" : "manual",
        resultResolution: home == null ? "" : "manual",
        resultNote: home == null ? null : "Entered on the clean review matrix. This score is used for every participant.",
        resultConflict: false,
      },
    });
  }
}

export function cellText(home: number | null | undefined, away: number | null | undefined, ignored: boolean | undefined): string {
  return formatCellScore(home ?? null, away ?? null, Boolean(ignored) || home == null || away == null);
}
