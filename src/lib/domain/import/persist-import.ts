import { prisma } from "@/lib/db/prisma";
import type { ForumPost } from "@/lib/domain/forum/types";
import { parseComment, rowsForStorage } from "@/lib/domain/parser/parse-comment";
import type { FixtureRef } from "@/lib/domain/parser/types";
import { participantKey } from "@/lib/domain/import/participant-key";
import {
  createParticipant,
  ensureKnownIdentities,
  findParticipantByName,
  loadIdentityCatalog,
  transferIdentity,
  updateParticipantName,
} from "@/lib/domain/participants/registry";
import { AUTHOR_NOTE, effectiveAuthorResolution } from "@/lib/domain/participants/resolve-author";
import { importNeedsReview, isAcceptableImport } from "./accept-import";
import { readLines, readWarnings } from "./review-status";
import { resolveSelections, type SelectableSet } from "./select-sets";

async function ensureParticipant(authorName: string, seasonId: string) {
  const name = authorName.trim() || "unknown";
  const existing = await findParticipantByName(name);
  const participant = existing ?? (await createParticipant(name));
  const membership = await prisma.seasonParticipant.findUnique({
    where: { seasonId_participantId: { seasonId, participantId: participant.id } },
  });
  if (!membership) {
    await prisma.seasonParticipant.create({
      data: {
        seasonId,
        participantId: participant.id,
        status: participant.archivedAt ? "excluded" : "included",
        excludedAt: participant.archivedAt ? new Date() : null,
      },
    });
  }
  return participant;
}

export async function saveForumPost(roundId: string, post: ForumPost): Promise<number> {
  await prisma.round.update({
    where: { id: roundId },
    data: { forumUrl: post.sourceUrl },
  });

  let saved = 0;
  for (const comment of post.comments) {
    if (!comment.externalId) {
      continue;
    }
    await prisma.forumComment.upsert({
      where: {
        roundId_externalId: { roundId, externalId: comment.externalId },
      },
      create: {
        roundId,
        sourceUrl: post.sourceUrl,
        externalId: comment.externalId,
        authorName: comment.authorName,
        postedAt: comment.postedAt,
        rawHtml: comment.rawHtml,
        rawText: comment.rawText,
      },
      update: {
        sourceUrl: post.sourceUrl,
        authorName: comment.authorName,
        postedAt: comment.postedAt,
        rawHtml: comment.rawHtml,
        rawText: comment.rawText,
      },
    });
    saved += 1;
  }
  return saved;
}

function predictionData(line: ReturnType<typeof rowsForStorage>[number]) {
  return {
    matchId: line.fixtureId as string,
    homeGoals: line.homeGoals,
    awayGoals: line.awayGoals,
    markedAsMt: line.markedAsMt,
    rawLine: line.rawLine,
    confidence: line.confidence,
    warning: line.warnings.length > 0 ? line.warnings.join("; ") : null,
  };
}

export async function parseStoredComments(roundId: string, options?: { authorKey?: string }): Promise<number> {
  await ensureKnownIdentities();
  const catalog = await loadIdentityCatalog();
  const round = await prisma.round.findUniqueOrThrow({
    where: { id: roundId },
    include: { matches: { orderBy: { sortOrder: "asc" } }, forumComments: true },
  });
  const fixtures: FixtureRef[] = round.matches.map((match) => ({
    id: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  }));

  let parsedCount = 0;
  for (const comment of round.forumComments) {
    const authorKey = participantKey(comment.authorName);
    if (options?.authorKey && authorKey !== options.authorKey) {
      continue;
    }
    const existing = await prisma.predictionSet.findFirst({
      where: { forumCommentId: comment.id },
    });
    if (existing?.manuallyEdited) {
      continue;
    }

    const resolution = effectiveAuthorResolution(comment.authorName, catalog, comment.importAnyway);
    if (resolution.kind !== "participant" && resolution.kind !== "alias") {
      if (existing) {
        await prisma.predictionSet.delete({ where: { id: existing.id } });
      }
      await prisma.forumComment.update({
        where: { id: comment.id },
        data: {
          reviewState: resolution.kind === "ignored" ? "ignored" : "flagged",
          reviewNote:
            resolution.kind === "ignored"
              ? AUTHOR_NOTE.ignored
              : resolution.kind === "uncertain"
                ? AUTHOR_NOTE.uncertain
                : AUTHOR_NOTE.unknown,
        },
      });
      parsedCount += 1;
      continue;
    }

    const parsed = parseComment(comment.rawText, fixtures);
    const participantId = resolution.participantId;
    if (!participantId) {
      continue;
    }
    const rows = rowsForStorage(parsed).map(predictionData);
    const shared = {
      participantId,
      rawComment: comment.rawText,
      source: "import",
      status: "parsed",
      confidence: parsed.confidence,
      warningsJson: JSON.stringify(parsed.warnings),
      parsedJson: JSON.stringify(parsed.lines),
    };

    if (existing) {
      await prisma.prediction.deleteMany({ where: { predictionSetId: existing.id } });
      await prisma.predictionSet.update({
        where: { id: existing.id },
        data: { ...shared, predictions: { create: rows } },
      });
    } else {
      await prisma.predictionSet.create({
        data: {
          roundId,
          forumCommentId: comment.id,
          ...shared,
          predictions: { create: rows },
        },
      });
    }
    parsedCount += 1;
  }

  await applyAutoSelection(roundId);
  return parsedCount;
}

export async function reparseAuthor(authorName: string): Promise<void> {
  const key = participantKey(authorName);
  if (!key) {
    return;
  }
  const comments = await prisma.forumComment.findMany({ select: { roundId: true, authorName: true } });
  const roundIds = [...new Set(comments.filter((comment) => participantKey(comment.authorName) === key).map((comment) => comment.roundId))];
  for (const roundId of roundIds) {
    await parseStoredComments(roundId, { authorKey: key });
  }
}

export async function applyAutoSelection(roundId: string): Promise<void> {
  const sets = await prisma.predictionSet.findMany({
    where: { roundId },
    include: { predictions: true, forumComment: true },
  });
  const fixtureCount = await prisma.match.count({ where: { roundId } });
  const selectable: SelectableSet[] = sets.map((set) => ({
    id: set.id,
    participantId: set.participantId,
    postedAt: set.forumComment?.postedAt ?? set.createdAt,
    valid: isAcceptableImport({
      warnings: readWarnings(set.warningsJson),
      unmatchedLines: readLines(set.parsedJson).filter((line) => !line.fixtureId).length,
      fixtureCount,
      predictions: set.predictions,
    }),
    selection: set.selection === "manual" ? "manual" : "auto",
    selected: set.selected,
  }));
  const chosen = new Set(resolveSelections(selectable));

  for (const set of sets) {
    const selected = chosen.has(set.id);
    const shape = {
      warnings: readWarnings(set.warningsJson),
      unmatchedLines: readLines(set.parsedJson).filter((line) => !line.fixtureId).length,
      fixtureCount,
      predictions: set.predictions,
    };
    const status = set.manuallyEdited
      ? set.status
      : selected
        ? "accepted"
        : importNeedsReview(shape)
          ? "flagged"
          : "parsed";
    if (set.selected !== selected || set.status !== status) {
      await prisma.predictionSet.update({
        where: { id: set.id },
        data: { selected, status },
      });
    }
    if (set.forumCommentId && !set.manuallyEdited) {
      await prisma.forumComment.update({
        where: { id: set.forumCommentId },
        data: {
          reviewState: status === "accepted" ? "accepted" : status === "flagged" ? "flagged" : "stored",
          reviewNote: status === "flagged" ? "Needs review before it can be accepted" : null,
        },
      });
    }
  }
}

export async function selectPredictionSet(setId: string): Promise<void> {
  const set = await prisma.predictionSet.findUniqueOrThrow({ where: { id: setId } });
  await prisma.predictionSet.updateMany({
    where: { roundId: set.roundId, participantId: set.participantId },
    data: { selected: false, selection: "auto" },
  });
  await prisma.predictionSet.update({
    where: { id: set.id },
    data: { selected: true, selection: "manual", manuallyEdited: true },
  });
}

function parseGoals(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Goals must be a non-negative integer");
  }
  return parsed;
}

export async function updatePredictionFromForm(formData: FormData): Promise<void> {
  const predictionId = String(formData.get("predictionId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const homeGoals = parseGoals(formData.get("homeGoals"));
  const awayGoals = parseGoals(formData.get("awayGoals"));
  const ignored = formData.get("ignored") === "on";

  const current = await prisma.prediction.findUniqueOrThrow({ where: { id: predictionId } });
  if (matchId !== current.matchId) {
    const clash = await prisma.prediction.findUnique({
      where: {
        predictionSetId_matchId: { predictionSetId: current.predictionSetId, matchId },
      },
    });
    if (clash) {
      throw new Error("That fixture is already on this prediction set");
    }
  }

  await prisma.prediction.update({
    where: { id: predictionId },
    data: { matchId, homeGoals, awayGoals, ignored },
  });
  await prisma.predictionSet.update({
    where: { id: current.predictionSetId },
    data: { manuallyEdited: true, status: "reviewed" },
  });
}

export async function renameParticipant(participantId: string, name: string): Promise<void> {
  await updateParticipantName(participantId, name);
}

export async function mergeParticipants(sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) {
    throw new Error("Choose a different participant to merge into");
  }
  const sets = await prisma.predictionSet.findMany({ where: { participantId: sourceId } });
  const roundIds = [...new Set(sets.map((set) => set.roundId))];

  await prisma.predictionSet.updateMany({
    where: { participantId: sourceId },
    data: { participantId: targetId },
  });

  const memberships = await prisma.seasonParticipant.findMany({
    where: { participantId: sourceId },
  });
  for (const membership of memberships) {
    const existing = await prisma.seasonParticipant.findUnique({
      where: {
        seasonId_participantId: { seasonId: membership.seasonId, participantId: targetId },
      },
    });
    if (existing) {
      await prisma.seasonParticipant.delete({ where: { id: membership.id } });
    } else {
      await prisma.seasonParticipant.update({
        where: { id: membership.id },
        data: { participantId: targetId },
      });
    }
  }

  const scores = await prisma.roundScore.findMany({ where: { participantId: sourceId } });
  for (const score of scores) {
    const clash = await prisma.roundScore.findUnique({
      where: { roundId_participantId: { roundId: score.roundId, participantId: targetId } },
    });
    if (clash) {
      await prisma.roundScore.delete({ where: { id: score.id } });
    } else {
      await prisma.roundScore.update({
        where: { id: score.id },
        data: { participantId: targetId },
      });
    }
  }

  const standings = await prisma.standingSnapshot.findMany({
    where: { participantId: sourceId },
  });
  for (const standing of standings) {
    const clash = await prisma.standingSnapshot.findUnique({
      where: {
        seasonId_roundId_participantId: {
          seasonId: standing.seasonId,
          roundId: standing.roundId,
          participantId: targetId,
        },
      },
    });
    if (clash) {
      await prisma.standingSnapshot.delete({ where: { id: standing.id } });
    } else {
      await prisma.standingSnapshot.update({
        where: { id: standing.id },
        data: { participantId: targetId },
      });
    }
  }

  await transferIdentity(sourceId, targetId);
  await prisma.participant.delete({ where: { id: sourceId } });
  for (const roundId of roundIds) {
    await applyAutoSelection(roundId);
  }
}

export async function addManualPredictionSet(roundId: string, participantName: string): Promise<void> {
  const round = await prisma.round.findUniqueOrThrow({
    where: { id: roundId },
    include: { matches: { orderBy: { sortOrder: "asc" } } },
  });
  const participant = await ensureParticipant(participantName, round.seasonId);
  const created = await prisma.predictionSet.create({
    data: {
      roundId,
      participantId: participant.id,
      source: "manual",
      status: "reviewed",
      selected: true,
      selection: "manual",
      manuallyEdited: true,
      rawComment: "",
      warningsJson: "[]",
      parsedJson: "[]",
      predictions: {
        create: round.matches.map((match) => ({
          matchId: match.id,
          homeGoals: null,
          awayGoals: null,
        })),
      },
    },
  });
  await prisma.predictionSet.updateMany({
    where: {
      roundId,
      participantId: participant.id,
      id: { not: created.id },
    },
    data: { selected: false, selection: "auto" },
  });
}
