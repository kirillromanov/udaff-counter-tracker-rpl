import { prisma } from "@/lib/db/prisma";
import { assertRoundMutable, assertRoundsMutable } from "@/lib/domain/rounds/round-lock-db";
import type { ForumPost } from "@/lib/domain/forum/types";
import { attributeComment } from "@/lib/domain/parser/attribute-blocks";
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
import {
  authorIdentityKey,
  DUPLICATE_COMMENT_NOTE,
  isContentClass,
  MANUAL_PREDICTION_NOTE,
  resolveIngestionStatus,
  shouldReplaceStoredSlip,
  classifyIncomingComment,
  type ContentClass,
  type StoredCommentShape,
} from "./incremental";
import { readLines, readWarnings } from "./review-status";
import { resolveSelections, type SelectableSet } from "./select-sets";

export interface ForumSaveResult {
  saved: number;
  classes: { externalId: string; content: ContentClass }[];
}

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

function linkedParticipantId(authorName: string, catalog: Awaited<ReturnType<typeof loadIdentityCatalog>>): string | null {
  const resolution = effectiveAuthorResolution(authorName, catalog, false);
  if (resolution.kind === "participant" || resolution.kind === "alias") {
    return resolution.participantId;
  }
  return null;
}

export async function saveForumPost(roundId: string, post: ForumPost): Promise<ForumSaveResult> {
  await assertRoundMutable(roundId);
  await prisma.round.update({
    where: { id: roundId },
    data: { forumUrl: post.sourceUrl },
  });

  const catalog = await loadIdentityCatalog();
  const existing = await prisma.forumComment.findMany({
    where: { roundId },
    select: { externalId: true, authorName: true, rawText: true },
  });
  const stored: StoredCommentShape[] = existing.flatMap((row) => {
    if (!row.externalId) {
      return [];
    }
    return [
      {
        externalId: row.externalId,
        authorKey: authorIdentityKey({
          participantId: linkedParticipantId(row.authorName, catalog),
          authorName: row.authorName,
        }),
        text: row.rawText,
      },
    ];
  });
  const fetchedAt = post.fetchedAt ?? new Date();
  const ordered = [...post.comments].sort((left, right) => {
    const leftTime = left.postedAt?.getTime() ?? 0;
    const rightTime = right.postedAt?.getTime() ?? 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return (left.externalId ?? "").localeCompare(right.externalId ?? "");
  });

  let saved = 0;
  const classes: ForumSaveResult["classes"] = [];
  for (const comment of ordered) {
    const authorKey = authorIdentityKey({
      participantId: linkedParticipantId(comment.authorName, catalog),
      authorName: comment.authorName,
    });
    const content = classifyIncomingComment({
      externalId: comment.externalId,
      authorKey,
      text: comment.rawText,
      stored,
    });
    if (content === "skipped" || !comment.externalId) {
      continue;
    }
    const identity = {
      sourceUrl: post.sourceUrl,
      authorName: comment.authorName,
      postedAt: comment.postedAt,
      rawHtml: comment.rawHtml,
      rawText: comment.rawText,
      lastFetchedAt: fetchedAt,
    };
    await prisma.forumComment.upsert({
      where: {
        roundId_externalId: { roundId, externalId: comment.externalId },
      },
      create: {
        roundId,
        externalId: comment.externalId,
        ingestionStatus: content,
        ...identity,
      },
      update: {
        ...identity,
        ...(content === "unchanged" ? {} : { ingestionStatus: content }),
      },
    });
    const remembered = stored.findIndex((row) => row.externalId === comment.externalId);
    const shape = { externalId: comment.externalId, authorKey, text: comment.rawText };
    if (remembered >= 0) {
      stored[remembered] = shape;
    } else {
      stored.push(shape);
    }
    classes.push({ externalId: comment.externalId, content });
    saved += 1;
  }
  return { saved, classes };
}

function sqliteText(value: string): string {
  return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function predictionData(line: ReturnType<typeof rowsForStorage>[number]) {
  return {
    matchId: line.fixtureId as string,
    homeGoals: line.homeGoals,
    awayGoals: line.awayGoals,
    markedAsMt: line.markedAsMt,
    rawLine: sqliteText(line.rawLine),
    confidence: line.confidence,
    warning: line.warnings.length > 0 ? line.warnings.join("; ") : null,
  };
}

export async function parseStoredComments(
  roundId: string,
  options?: { authorKey?: string; force?: boolean; commentId?: string },
): Promise<number> {
  await assertRoundMutable(roundId);
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
  const touchedParticipants = new Set<string>();
  for (const comment of round.forumComments) {
    if (options?.commentId && comment.id !== options.commentId) {
      continue;
    }
    const authorKey = participantKey(comment.authorName);
    if (options?.authorKey && authorKey !== options.authorKey) {
      continue;
    }
    const existingSets = await prisma.predictionSet.findMany({
      where: { forumCommentId: comment.id },
    });
    const content: ContentClass = isContentClass(comment.ingestionStatus) ? comment.ingestionStatus : existingSets.length > 0 ? "unchanged" : "new";
    const manualSets = existingSets.filter((set) => set.manuallyEdited || set.selection === "manual");
    const autoSets = existingSets.filter((set) => !set.manuallyEdited && set.selection !== "manual");
    if (content === "duplicate") {
      if (autoSets.length > 0) {
        await prisma.predictionSet.deleteMany({ where: { id: { in: autoSets.map((set) => set.id) } } });
      }
      await prisma.forumComment.update({
        where: { id: comment.id },
        data: {
          ingestionStatus: "duplicate",
          reviewState: "ignored",
          reviewNote: DUPLICATE_COMMENT_NOTE,
        },
      });
      continue;
    }
    if (!options?.force && !shouldReplaceStoredSlip(content, false, existingSets.length > 0)) {
      continue;
    }
    if (!options?.force && autoSets.length === 0 && manualSets.length > 0) {
      if (content === "updated") {
        await prisma.forumComment.update({
          where: { id: comment.id },
          data: {
            ingestionStatus: "flagged",
            reviewState: "flagged",
            reviewNote: MANUAL_PREDICTION_NOTE,
          },
        });
      }
      continue;
    }

    const resolution = effectiveAuthorResolution(comment.authorName, catalog, comment.importAnyway);
    if (resolution.kind !== "participant" && resolution.kind !== "alias") {
      if (autoSets.length > 0) {
        await prisma.predictionSet.deleteMany({ where: { id: { in: autoSets.map((set) => set.id) } } });
      }
      await prisma.forumComment.update({
        where: { id: comment.id },
        data: {
          ingestionStatus: resolveIngestionStatus(content, resolution.kind, false),
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

    const blocks = attributeComment({
      raw: comment.rawText,
      authorName: resolution.canonicalName ?? comment.authorName,
      roundNumber: round.number,
    });
    const keptIds = new Set<string>();
    for (const block of blocks) {
      const owner = block.ownerName === resolution.canonicalName
        ? resolution
        : effectiveAuthorResolution(block.ownerName, catalog, false);
      if (!owner.participantId || (owner.kind !== "participant" && owner.kind !== "alias")) {
        continue;
      }
      touchedParticipants.add(owner.participantId);
      if (manualSets.some((set) => set.participantId === owner.participantId)) {
        continue;
      }
      const parsed = parseComment(block.text, fixtures);
      const warnings = [...block.warnings, ...parsed.warnings];
      const rows = rowsForStorage(parsed).map(predictionData);
      if (rows.length === 0) {
        continue;
      }
      const shared = {
        participantId: owner.participantId,
        rawComment: sqliteText(comment.rawText),
        source: "import",
        status: "parsed",
        confidence: block.confidence,
        warningsJson: sqliteText(JSON.stringify(warnings)),
        parsedJson: sqliteText(JSON.stringify(parsed.lines)),
        attributionMethod: block.method,
        attributionEvidence: sqliteText(block.evidence),
        attributionReview: block.review,
        blockKey: sqliteText(block.blockKey),
        sourceExcerpt: sqliteText(block.excerpt),
      };
      const current = autoSets.find((set) => set.blockKey === block.blockKey);
      if (current) {
        await prisma.prediction.deleteMany({ where: { predictionSetId: current.id } });
        await prisma.predictionSet.update({
          where: { id: current.id },
          data: { ...shared, predictions: { create: rows } },
        });
        keptIds.add(current.id);
      } else {
        const created = await prisma.predictionSet.create({
          data: {
            roundId,
            forumCommentId: comment.id,
            ...shared,
            predictions: { create: rows },
          },
        });
        keptIds.add(created.id);
      }
    }
    const stale = autoSets.filter((set) => !keptIds.has(set.id));
    if (stale.length > 0) {
      await prisma.predictionSet.deleteMany({ where: { id: { in: stale.map((set) => set.id) } } });
    }
    await prisma.forumComment.update({
      where: { id: comment.id },
      data: {
        ingestionStatus: resolveIngestionStatus(content, resolution.kind, manualSets.length > 0),
        reviewNote: blocks.some((block) => block.review === "review")
          ? "A prediction block needs an owner check"
          : null,
      },
    });
    parsedCount += 1;
  }

  if (options?.commentId) {
    await applyAutoSelection(roundId, { participantIds: [...touchedParticipants], commentId: options.commentId });
  } else {
    await applyAutoSelection(roundId);
  }
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
    const round = await prisma.round.findUnique({ where: { id: roundId }, select: { closedAt: true } });
    if (round?.closedAt) {
      continue;
    }
    await parseStoredComments(roundId, { authorKey: key });
  }
}

export async function applyAutoSelection(
  roundId: string,
  options?: { participantIds?: string[]; commentId?: string },
): Promise<void> {
  await assertRoundMutable(roundId);
  const sets = await prisma.predictionSet.findMany({
    where: { roundId },
    include: { predictions: true, forumComment: true },
  });
  const fixtureCount = await prisma.match.count({ where: { roundId } });
  const selectable: SelectableSet[] = sets.map((set) => {
    const shape = {
      warnings: readWarnings(set.warningsJson),
      unmatchedLines: readLines(set.parsedJson).filter((line) => !line.fixtureId).length,
      fixtureCount,
      predictions: set.predictions,
    };
    const acceptable = isAcceptableImport(shape);
    const scored = set.predictions.filter((row) => !row.ignored && row.homeGoals != null && row.awayGoals != null).length;
    return {
      id: set.id,
      participantId: set.participantId,
      postedAt: set.forumComment?.postedAt ?? set.createdAt,
      valid: acceptable,
      provisional: set.attributionReview !== "review" && scored > 0 && !acceptable,
      selection: set.selection === "manual" ? "manual" : "auto",
      selected: set.selected,
    };
  });
  const chosen = new Set(resolveSelections(selectable));
  const limit = options?.participantIds ? new Set(options.participantIds) : null;

  for (const set of sets) {
    if (limit && !limit.has(set.participantId)) {
      continue;
    }
    const selected = chosen.has(set.id);
    const shape = {
      warnings: readWarnings(set.warningsJson),
      unmatchedLines: readLines(set.parsedJson).filter((line) => !line.fixtureId).length,
      fixtureCount,
      predictions: set.predictions,
    };
    const ownerReview = set.attributionReview === "probable" || set.attributionReview === "review";
    const status = set.manuallyEdited
      ? set.status
      : selected
        ? ownerReview || importNeedsReview(shape)
          ? "flagged"
          : "accepted"
        : importNeedsReview(shape) || ownerReview
          ? "flagged"
          : "parsed";
    if (set.selected !== selected || set.status !== status) {
      await prisma.predictionSet.update({
        where: { id: set.id },
        data: { selected, status },
      });
    }
    if (set.forumCommentId && !set.manuallyEdited && (!options?.commentId || set.forumCommentId === options.commentId)) {
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
  await assertRoundMutable(set.roundId);
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

  const current = await prisma.prediction.findUniqueOrThrow({
    where: { id: predictionId },
    include: { predictionSet: { select: { roundId: true } } },
  });
  await assertRoundMutable(current.predictionSet.roundId);
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
  await assertRoundsMutable(roundIds);

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
  await assertRoundMutable(roundId);
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
