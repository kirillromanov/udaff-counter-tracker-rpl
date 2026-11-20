import { EDIT_TIME_UNKNOWN_NOTE } from "@/lib/domain/import/fixture-deadline";
import { participantKey } from "@/lib/domain/import/participant-key";
import { fixtureBlocksPolling, pollIntervals, type PollFixture, type PollIntervals } from "@/lib/domain/results/poll";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";

/** How this fetch relates to comments already stored for the round. */
export type ContentClass = "new" | "updated" | "unchanged" | "duplicate";

/** Stored on the comment after identity resolution. */
export type IngestionStatus = ContentClass | "ignored" | "flagged";

export interface StoredCommentShape {
  externalId: string;
  authorKey: string;
  text: string;
}

export interface PredictionRefreshPlan {
  active: boolean;
  nextAt: Date | null;
  reason: string;
}

export const DUPLICATE_COMMENT_NOTE = "Duplicate of an earlier comment with the same prediction text.";
export const MANUAL_PREDICTION_NOTE = "Forum comment changed after a manual edit. The stored slip was left as edited.";

export interface IngestionCounts {
  new: number;
  updated: number;
  unchanged: number;
  duplicate: number;
  ignored: number;
  flagged: number;
}

export function commentFingerprint(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru");
}

/** Alias matches share a participant id. Everyone else stays on the forum nick. */
export function authorIdentityKey(input: { participantId: string | null; authorName: string }): string {
  if (input.participantId) {
    return `participant:${input.participantId}`;
  }
  const nick = participantKey(input.authorName);
  return nick ? `nick:${nick}` : "nick:";
}

export function isContentClass(value: string): value is ContentClass {
  return value === "new" || value === "updated" || value === "unchanged" || value === "duplicate";
}

/**
 * Same forum comment id with the same text is unchanged.
 * Same id with different text is an update.
 * A new id whose author and text match an older comment is a duplicate repost.
 */
export function classifyIncomingComment(input: {
  externalId: string | null;
  authorKey: string;
  text: string;
  stored: readonly StoredCommentShape[];
}): ContentClass | "skipped" {
  if (!input.externalId) {
    return "skipped";
  }
  const fingerprint = commentFingerprint(input.text);
  const same = input.stored.find((row) => row.externalId === input.externalId);
  if (same) {
    return commentFingerprint(same.text) === fingerprint ? "unchanged" : "updated";
  }
  const repost =
    fingerprint.length > 0 &&
    input.stored.some((row) => row.authorKey === input.authorKey && commentFingerprint(row.text) === fingerprint);
  return repost ? "duplicate" : "new";
}

export function resolveIngestionStatus(content: ContentClass, authorKind: string, manuallyEdited: boolean): IngestionStatus {
  if (content === "duplicate") {
    return "duplicate";
  }
  if (authorKind === "ignored") {
    return "ignored";
  }
  if (authorKind !== "participant" && authorKind !== "alias") {
    return "flagged";
  }
  if (content === "updated" && manuallyEdited) {
    return "flagged";
  }
  if (content === "unchanged") {
    return "unchanged";
  }
  return content;
}

export type StoredEditSignal = "none" | "stale-note" | "body-differs";

/**
 * Compares the current body with the slip that was parsed.
 * A stored new/updated/unchanged label is not an input: it is not evidence
 * that this fetch changed the comment.
 */
export function storedEditSignal(input: {
  commentText: string;
  slipText: string | null;
  reviewNote?: string | null;
}): StoredEditSignal {
  if (input.slipText == null) {
    return "none";
  }
  if (commentFingerprint(input.slipText) !== commentFingerprint(input.commentText)) {
    return "body-differs";
  }
  if (input.reviewNote === EDIT_TIME_UNKNOWN_NOTE) {
    return "stale-note";
  }
  return "none";
}

export type CommentParsePlan =
  | { action: "leave" }
  | { action: "protect-unresolved" }
  | { action: "manual-hold" }
  | { action: "duplicate" }
  | { action: "parse"; reason: "created" | "changed" | "recovery" | "explicit" };

/**
 * Decides whether this comment needs a parse.
 * `fetch` is the outcome of the current save. Null means an explicit reparse,
 * which is not evidence that the source changed.
 */
export function planCommentParse(input: {
  fetch: ContentClass | null;
  force: boolean;
  bodyDiffersFromSlip: boolean;
  hasReliableEditTime: boolean;
  equivalentPredictions: boolean;
  hasAutoSlip: boolean;
  hasManualSlip: boolean;
  /** A duplicate or ignored comment that already has no automatic slip. */
  disposed: boolean;
}): CommentParsePlan {
  if (input.fetch === "duplicate") {
    return { action: "duplicate" };
  }
  const unchangedFetch = input.fetch === "unchanged" && !input.force;
  if (unchangedFetch && input.bodyDiffersFromSlip) {
    return !input.hasAutoSlip && input.hasManualSlip
      ? { action: "manual-hold" }
      : { action: "protect-unresolved" };
  }
  if (unchangedFetch && input.disposed && !input.hasAutoSlip) {
    return { action: "leave" };
  }
  if (unchangedFetch && input.equivalentPredictions) {
    return { action: "leave" };
  }
  if (unchangedFetch && !input.hasAutoSlip && input.hasManualSlip) {
    return { action: "leave" };
  }
  if (unchangedFetch) {
    return { action: "parse", reason: "recovery" };
  }
  if (input.bodyDiffersFromSlip && !input.hasReliableEditTime) {
    return !input.hasAutoSlip && input.hasManualSlip
      ? { action: "manual-hold" }
      : { action: "protect-unresolved" };
  }
  if (!input.hasAutoSlip && input.hasManualSlip && input.fetch === "updated") {
    return { action: "manual-hold" };
  }
  if ((input.force || input.fetch === null) && input.equivalentPredictions && !input.bodyDiffersFromSlip) {
    return { action: "leave" };
  }
  if (input.disposed && !input.hasAutoSlip && input.fetch !== "new" && input.fetch !== "updated") {
    return { action: "leave" };
  }
  const reason = input.fetch === "updated" || input.bodyDiffersFromSlip
    ? "changed"
    : input.force || input.fetch === null
      ? "explicit"
      : "created";
  return { action: "parse", reason };
}

/** A manual edit is kept. An unchanged comment is parsed only when no slip is stored yet. */
export function shouldReplaceStoredSlip(content: ContentClass, manuallyEdited: boolean, hasStoredSlip: boolean): boolean {
  if (content === "duplicate" || manuallyEdited) {
    return false;
  }
  if (content === "unchanged") {
    return !hasStoredSlip;
  }
  return true;
}

export function ingestionStatusLabel(status: string): string {
  if (status === "new") {
    return "New prediction";
  }
  if (status === "updated") {
    return "Updated prediction";
  }
  if (status === "duplicate") {
    return "Duplicate comment";
  }
  if (status === "ignored") {
    return "Ignored user";
  }
  if (status === "flagged") {
    return "Needs review";
  }
  return "Unchanged";
}

/**
 * Whether automatic prediction refresh may run.
 * The due instant is the stored nextPredictionFetchAt, not the result-attempt clock.
 * Archived, preparation, and fully final rounds stay out. Exhausted result attempts do not.
 */
export function planPredictionRefresh(
  input: {
    standingRole: string;
    hasForumUrl: boolean;
    fixtures: readonly PollFixture[];
    productionStartedAt?: Date | null;
  },
  now: Date,
  intervals: PollIntervals = pollIntervals(),
): PredictionRefreshPlan {
  void intervals;
  if (input.standingRole === ARCHIVED_ROUND) {
    return {
      active: false,
      nextAt: null,
      reason: "Archived round. Use Refresh predictions on this page for a reference fetch.",
    };
  }
  if (input.productionStartedAt === null) {
    return {
      active: false,
      nextAt: null,
      reason: "Preparation. Automatic comment and result checks start after Start production.",
    };
  }
  if (!input.hasForumUrl) {
    return { active: false, nextAt: null, reason: "Add the forum URL before predictions can be refreshed." };
  }
  if (input.fixtures.length === 0) {
    return { active: false, nextAt: null, reason: "This round has no fixtures." };
  }
  const open = input.fixtures.some((fixture) => fixtureBlocksPolling(fixture, now));
  if (!open) {
    return {
      active: false,
      nextAt: null,
      reason: "Automatic prediction refresh is stopped. Every fixture is final.",
    };
  }
  return {
    active: true,
    nextAt: null,
    reason: "Active round. The next prediction refresh is the stored nextPredictionFetchAt.",
  };
}

export function isPredictionRefreshDue(plan: PredictionRefreshPlan, nextAt: Date | null, now: Date, force: boolean): boolean {
  if (!plan.active) {
    return false;
  }
  if (force) {
    return true;
  }
  if (!nextAt) {
    return true;
  }
  return nextAt.getTime() <= now.getTime();
}

export function selectDuePredictionRoundIds(
  rounds: readonly {
    id: string;
    standingRole: string;
    forumUrl: string | null;
    nextPredictionFetchAt: Date | null;
    matches: readonly PollFixture[];
    closedAt?: Date | null;
    productionStartedAt?: Date | null;
  }[],
  now: Date,
  intervals: PollIntervals = pollIntervals(),
  forceRoundId?: string,
): string[] {
  return rounds.flatMap((round) => {
    if (round.closedAt) {
      return [];
    }
    const plan = planPredictionRefresh(
      {
        standingRole: round.standingRole,
        hasForumUrl: Boolean(round.forumUrl),
        productionStartedAt: round.productionStartedAt,
        fixtures: round.matches,
      },
      now,
      intervals,
    );
    return isPredictionRefreshDue(plan, round.nextPredictionFetchAt, now, forceRoundId === round.id) ? [round.id] : [];
  });
}

export function emptyIngestionCounts(): IngestionCounts {
  return { new: 0, updated: 0, unchanged: 0, duplicate: 0, ignored: 0, flagged: 0 };
}

/** Unchanged text stays unchanged. Identity can move a new or updated comment to ignored, flagged, or duplicate. */
export function countThisFetch(
  classes: readonly { externalId: string; content: ContentClass }[],
  storedStatus: ReadonlyMap<string, string>,
): IngestionCounts {
  const counts = emptyIngestionCounts();
  for (const row of classes) {
    if (row.content === "unchanged") {
      counts.unchanged += 1;
      continue;
    }
    const status = storedStatus.get(row.externalId);
    if (status === "ignored" || status === "flagged" || status === "duplicate") {
      counts[status] += 1;
      continue;
    }
    counts[row.content] += 1;
  }
  return counts;
}

export function formatIngestionCounts(counts: IngestionCounts): string {
  return `${counts.new} new, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.duplicate} duplicate, ${counts.ignored} ignored, ${counts.flagged} flagged`;
}
