import {
  normalizeOffsetlessPublication,
  parseForumTimestamp,
  permalinkText,
  FORUM_SITE_OFFSET_MINUTES,
} from "@/lib/domain/time/publication-clock";

const EXACT_PERMALINK = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) at (\d{1,2}):(\d{2})$/;

export interface LegacyComment {
  id: string;
  externalId: string | null;
  postedAt: Date | null;
  rawHtml: string;
}

export interface PublicationCorrection {
  commentId: string;
  externalId: string;
  permalink: string;
  classification: "legacy-offsetless";
  oldPostedAt: string;
  newPostedAt: string;
}

export interface PublicationPlan {
  corrections: PublicationCorrection[];
  unchanged: { commentId: string; externalId: string | null; classification: "already-normalized" }[];
  conflicts: { commentId: string; externalId: string | null; reason: string }[];
}

function ownPermalink(rawHtml: string, externalId: string): string | null {
  const ids = [...rawHtml.matchAll(/#comment-(\d+)/gi)].map((match) => match[1]);
  if (ids.length !== 1 || ids[0] !== externalId) {
    return null;
  }
  const text = permalinkText(rawHtml);
  return text;
}

/**
 * Correct only a stored instant that is exactly the permalink digits read as UTC.
 * The replacement is those same digits read as the configured site offset.
 * Anything else is a conflict or an already-normalized row.
 */
export function planLegacyPublicationCorrections(comments: readonly LegacyComment[]): PublicationPlan {
  const corrections: PublicationCorrection[] = [];
  const unchanged: PublicationPlan["unchanged"] = [];
  const conflicts: PublicationPlan["conflicts"] = [];
  for (const comment of comments) {
    if (!comment.externalId) {
      conflicts.push({ commentId: comment.id, externalId: null, reason: "missing-external-id" });
      continue;
    }
    const permalink = ownPermalink(comment.rawHtml, comment.externalId);
    if (!permalink || !EXACT_PERMALINK.test(permalink)) {
      conflicts.push({ commentId: comment.id, externalId: comment.externalId, reason: "permalink-not-exact-offsetless" });
      continue;
    }
    const legacy = parseForumTimestamp(permalink);
    const normalized = normalizeOffsetlessPublication(permalink);
    if (!legacy || !normalized || comment.postedAt == null) {
      conflicts.push({ commentId: comment.id, externalId: comment.externalId, reason: "unreadable-timestamp" });
      continue;
    }
    if (legacy.getUTCSeconds() !== 0 || legacy.getUTCMilliseconds() !== 0 || normalized.getUTCSeconds() !== 0 || normalized.getUTCMilliseconds() !== 0) {
      conflicts.push({ commentId: comment.id, externalId: comment.externalId, reason: "unexpected-seconds" });
      continue;
    }
    if (normalized.getTime() !== legacy.getTime() - FORUM_SITE_OFFSET_MINUTES * 60_000) {
      conflicts.push({ commentId: comment.id, externalId: comment.externalId, reason: "offset-not-configured" });
      continue;
    }
    if (comment.postedAt.getTime() === normalized.getTime()) {
      unchanged.push({ commentId: comment.id, externalId: comment.externalId, classification: "already-normalized" });
      continue;
    }
    if (comment.postedAt.getTime() !== legacy.getTime()) {
      conflicts.push({ commentId: comment.id, externalId: comment.externalId, reason: "postedAt-matches-neither-encoding" });
      continue;
    }
    corrections.push({
      commentId: comment.id,
      externalId: comment.externalId,
      permalink,
      classification: "legacy-offsetless",
      oldPostedAt: legacy.toISOString(),
      newPostedAt: normalized.toISOString(),
    });
  }
  return { corrections, unchanged, conflicts };
}
