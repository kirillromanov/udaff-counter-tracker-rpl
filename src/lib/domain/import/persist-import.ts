import { prisma } from "@/lib/db/prisma";
import { assertRoundMutable, assertRoundsMutable } from "@/lib/domain/rounds/round-lock-db";
import { commentEditEvidence } from "@/lib/domain/forum/comment-edit";
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
import { EDIT_AFTER_KICKOFF_NOTE, EDIT_TIME_UNKNOWN_NOTE, editWritePlan } from "./fixture-deadline";
import {
  authorIdentityKey,
  commentFingerprint,
  DUPLICATE_COMMENT_NOTE,
  MANUAL_PREDICTION_NOTE,
  planCommentParse,
  resolveIngestionStatus,
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

function samePredictionValues(
  existing: { homeGoals: number | null; awayGoals: number | null; markedAsMt: boolean; rawLine: string | null },
  incoming: { homeGoals: number | null; awayGoals: number | null; markedAsMt: boolean; rawLine: string | null },
): boolean {
  return existing.homeGoals === incoming.homeGoals
    && existing.awayGoals === incoming.awayGoals
    && existing.markedAsMt === incoming.markedAsMt
    && (existing.rawLine ?? "") === (incoming.rawLine ?? "");
}

async function writeCommentState(
  comment: { id: string; ingestionStatus: string; reviewState: string; reviewNote: string | null },
  data: { ingestionStatus?: string; reviewState?: string; reviewNote?: string | null },
): Promise<void> {
  const ingestionStatus = data.ingestionStatus ?? comment.ingestionStatus;
  const reviewState = data.reviewState ?? comment.reviewState;
  const reviewNote = data.reviewNote === undefined ? comment.reviewNote : data.reviewNote;
  if (
    ingestionStatus === comment.ingestionStatus
    && reviewState === comment.reviewState
    && reviewNote === comment.reviewNote
  ) {
    return;
  }
  await prisma.forumComment.update({
    where: { id: comment.id },
    data: { ingestionStatus, reviewState, reviewNote },
  });
}

async function syncPredictions(
  setId: string,
  existing: { id: string; matchId: string; homeGoals: number | null; awayGoals: number | null; markedAsMt: boolean; rawLine: string | null }[],
  incoming: ReturnType<typeof predictionData>[],
  partialMatchIds: ReadonlySet<string> | null,
): Promise<void> {
  const rows = partialMatchIds ? incoming.filter((row) => partialMatchIds.has(row.matchId)) : incoming;
  for (const row of rows) {
    const current = existing.find((item) => item.matchId === row.matchId);
    if (!current) {
      await prisma.prediction.create({ data: { predictionSetId: setId, ...row } });
      continue;
    }
    if (!samePredictionValues(current, row)) {
      await prisma.prediction.update({
        where: { id: current.id },
        data: {
          homeGoals: row.homeGoals,
          awayGoals: row.awayGoals,
          markedAsMt: row.markedAsMt,
          rawLine: row.rawLine,
          confidence: row.confidence,
          warning: row.warning,
        },
      });
    }
  }
  const kept = new Set(rows.map((row) => row.matchId));
  const remove = existing.filter((item) => {
    if (partialMatchIds && !partialMatchIds.has(item.matchId)) {
      return false;
    }
    return !kept.has(item.matchId);
  });
  if (remove.length > 0) {
    await prisma.prediction.deleteMany({ where: { id: { in: remove.map((item) => item.id) } } });
  }
}

export async function parseStoredComments(
  roundId: string,
  options?: {
    authorKey?: string;
    force?: boolean;
    commentId?: string;
    /** Outcomes from the fetch that just saved these comments. Omit for an explicit reparse. */
    outcomes?: readonly { externalId: string; content: ContentClass }[];
  },
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
  const outcomes = options?.outcomes ? new Map(options.outcomes.map((row) => [row.externalId, row.content])) : null;
  for (const comment of round.forumComments) {
    if (options?.commentId && comment.id !== options.commentId) {
      continue;
    }
    const authorKey = participantKey(comment.authorName);
    if (options?.authorKey && authorKey !== options.authorKey) {
      continue;
    }
    if (outcomes && (!comment.externalId || !outcomes.has(comment.externalId))) {
      continue;
    }
    const fetchOutcome = outcomes ? outcomes.get(comment.externalId ?? "") ?? null : null;
    const existingSets = await prisma.predictionSet.findMany({
      where: { forumCommentId: comment.id },
      include: { predictions: true },
    });
    const manualSets = existingSets.filter((set) => set.manuallyEdited || set.selection === "manual");
    const autoSets = existingSets.filter((set) => !set.manuallyEdited && set.selection !== "manual");
    const slipText = autoSets.find((set) => (set.rawComment ?? "").length > 0)?.rawComment ?? null;
    const bodyDiffers = slipText != null && commentFingerprint(slipText) !== commentFingerprint(comment.rawText);
    const editEvidence = bodyDiffers || fetchOutcome === "updated"
      ? commentEditEvidence(comment.rawHtml, comment.postedAt)
      : { editedAt: null };
    const provisional = parseComment(comment.rawText, fixtures);
    const provisionalRows = rowsForStorage(provisional).map(predictionData);
    const storedRows = autoSets.flatMap((set) => set.predictions);
    const equivalentPredictions = provisionalRows.length === storedRows.length
      && provisionalRows.every((row) => storedRows.some((stored) => stored.matchId === row.matchId && samePredictionValues(stored, row)));
    const plan = planCommentParse({
      fetch: fetchOutcome,
      force: options?.force === true,
      bodyDiffersFromSlip: bodyDiffers,
      hasReliableEditTime: editEvidence.editedAt != null,
      equivalentPredictions,
      hasAutoSlip: autoSets.length > 0,
      hasManualSlip: manualSets.length > 0,
      disposed: (comment.ingestionStatus === "duplicate" || comment.ingestionStatus === "ignored") && autoSets.length === 0,
    });
    if (plan.action === "leave") {
      if (!bodyDiffers && comment.reviewNote === EDIT_TIME_UNKNOWN_NOTE) {
        await writeCommentState(comment, { reviewNote: null, reviewState: "accepted" });
      }
      continue;
    }
    if (plan.action === "protect-unresolved") {
      await writeCommentState(comment, {
        ingestionStatus: "flagged",
        reviewState: "flagged",
        reviewNote: EDIT_TIME_UNKNOWN_NOTE,
      });
      continue;
    }
    if (plan.action === "manual-hold") {
      await writeCommentState(comment, {
        ingestionStatus: "flagged",
        reviewState: "flagged",
        reviewNote: MANUAL_PREDICTION_NOTE,
      });
      continue;
    }
    if (plan.action === "duplicate") {
      if (autoSets.length > 0) {
        await prisma.predictionSet.deleteMany({ where: { id: { in: autoSets.map((set) => set.id) } } });
      }
      await writeCommentState(comment, {
        ingestionStatus: "duplicate",
        reviewState: "ignored",
        reviewNote: DUPLICATE_COMMENT_NOTE,
      });
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
          ingestionStatus: resolveIngestionStatus(fetchOutcome ?? "unchanged", resolution.kind, false),
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

    let editRefused = false;
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
      const parsedRows = rowsForStorage(parsed).map(predictionData);
      const deadline = editEvidence.editedAt
        ? editWritePlan({
            editedAt: editEvidence.editedAt,
            fixtures: round.matches.map((match) => ({ id: match.id, kickoffAt: match.kickoffAt })),
            incomingMatchIds: parsedRows.map((row) => row.matchId),
          })
        : { writeMatchIds: parsedRows.map((row) => row.matchId), note: null };
      if (deadline.note) {
        editRefused = true;
      }
      const partial = editEvidence.editedAt != null;
      const rows = partial ? parsedRows.filter((row) => deadline.writeMatchIds.includes(row.matchId)) : parsedRows;
      if (partial && rows.length === 0) {
        continue;
      }
      const shared = {
        participantId: owner.participantId,
        rawComment: sqliteText(comment.rawText),
        source: "import",
        confidence: block.confidence,
        warningsJson: sqliteText(JSON.stringify(warnings)),
        parsedJson: sqliteText(JSON.stringify(parsed.lines)),
        attributionMethod: block.method,
        attributionEvidence: sqliteText(block.evidence),
        attributionReview: block.review,
        blockKey: sqliteText(block.blockKey),
        sourceExcerpt: sqliteText(block.excerpt),
      };
      const owned = autoSets.filter((set) => set.participantId === owner.participantId);
      const current = autoSets.find((set) => set.blockKey === block.blockKey) ?? (owned.length === 1 ? owned[0] : undefined);
      if (current) {
        await syncPredictions(current.id, current.predictions, parsedRows, partial ? new Set(deadline.writeMatchIds) : null);
        const changed = current.participantId !== shared.participantId
          || (current.rawComment ?? "") !== shared.rawComment
          || current.confidence !== shared.confidence
          || current.warningsJson !== shared.warningsJson
          || current.parsedJson !== shared.parsedJson
          || current.attributionMethod !== shared.attributionMethod
          || current.attributionEvidence !== shared.attributionEvidence
          || current.attributionReview !== shared.attributionReview
          || current.blockKey !== shared.blockKey
          || current.sourceExcerpt !== shared.sourceExcerpt
          || current.source !== shared.source;
        if (changed) {
          await prisma.predictionSet.update({ where: { id: current.id }, data: shared });
        }
        keptIds.add(current.id);
      } else if (rows.length > 0) {
        const created = await prisma.predictionSet.create({
          data: {
            roundId,
            forumCommentId: comment.id,
            status: "parsed",
            ...shared,
            predictions: { create: rows },
          },
        });
        keptIds.add(created.id);
      }
    }
    const stale = autoSets.filter((set) => !keptIds.has(set.id));
    if (!editEvidence.editedAt && stale.length > 0) {
      await prisma.predictionSet.deleteMany({ where: { id: { in: stale.map((set) => set.id) } } });
    }
    const ownerReview = blocks.some((block) => block.review === "review");
    await writeCommentState(comment, {
      ingestionStatus: editRefused
        ? "flagged"
        : resolveIngestionStatus(fetchOutcome ?? "unchanged", resolution.kind, manualSets.length > 0),
      reviewState: editRefused ? "flagged" : ownerReview ? "flagged" : comment.reviewState,
      reviewNote: editRefused
        ? EDIT_AFTER_KICKOFF_NOTE
        : ownerReview
          ? "A prediction block needs an owner check"
          : comment.reviewNote === EDIT_TIME_UNKNOWN_NOTE || comment.reviewNote === MANUAL_PREDICTION_NOTE
            ? null
            : comment.reviewNote,
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
    const keptNote = set.forumComment?.reviewNote === EDIT_TIME_UNKNOWN_NOTE
      || set.forumComment?.reviewNote === EDIT_AFTER_KICKOFF_NOTE
      || set.forumComment?.reviewNote === MANUAL_PREDICTION_NOTE
      || set.forumComment?.reviewNote === "A prediction block needs an owner check";
    if (keptNote) {
      continue;
    }
    if (set.forumCommentId && !set.manuallyEdited && (!options?.commentId || set.forumCommentId === options.commentId)) {
      const reviewState = status === "accepted" ? "accepted" : status === "flagged" ? "flagged" : "stored";
      const reviewNote = status === "flagged" ? "Needs review before it can be accepted" : null;
      if (set.forumComment?.reviewState === reviewState && set.forumComment.reviewNote === reviewNote) {
        continue;
      }
      await prisma.forumComment.update({
        where: { id: set.forumCommentId },
        data: { reviewState, reviewNote },
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
