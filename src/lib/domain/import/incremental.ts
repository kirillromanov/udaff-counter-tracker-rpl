import { participantKey } from "@/lib/domain/import/participant-key";
import { planRoundPoll, pollIntervals, type PollFixture, type PollIntervals } from "@/lib/domain/results/poll";
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
 * Automatic prediction refresh follows active and upcoming production rounds.
 * It stops when result polling would stop. Archived rounds stay manual.
 */
export function planPredictionRefresh(
  input: { standingRole: string; hasForumUrl: boolean; fixtures: readonly PollFixture[] },
  now: Date,
  intervals: PollIntervals = pollIntervals(),
): PredictionRefreshPlan {
  if (input.standingRole === ARCHIVED_ROUND) {
    return {
      active: false,
      nextAt: null,
      reason: "Archived round. Use Refresh predictions on this page for a reference fetch.",
    };
  }
  if (!input.hasForumUrl) {
    return { active: false, nextAt: null, reason: "Add the forum URL before predictions can be refreshed." };
  }
  const results = planRoundPoll(input.fixtures, now, intervals);
  if (!results.active) {
    return {
      active: false,
      nextAt: null,
      reason: "Automatic prediction refresh is stopped. Every fixture is final, or this round has no fixtures.",
    };
  }
  return {
    active: true,
    nextAt: results.nextPollAt,
    reason:
      results.pollStatus === "live"
        ? "Live round. The next prediction refresh follows the live result check."
        : "Active round. The next prediction refresh follows the result check.",
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
  }[],
  now: Date,
  intervals: PollIntervals = pollIntervals(),
  forceRoundId?: string,
): string[] {
  return rounds.flatMap((round) => {
    const plan = planPredictionRefresh(
      { standingRole: round.standingRole, hasForumUrl: Boolean(round.forumUrl), fixtures: round.matches },
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
