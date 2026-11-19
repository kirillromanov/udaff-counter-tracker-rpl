/**
 * WordPress `date` is the site timezone and `date_gmt` is GMT.
 * On this forum those fields differ by exactly three hours in July, August,
 * October, and November. The HTML permalink matches `date` to the minute.
 * Offset-less publication text uses this configured offset once.
 * It is not applied to a value that already has an explicit offset.
 */
export const FORUM_SITE_OFFSET_MINUTES = 180;

const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;

/** Legacy encoding: permalink digits placed on a UTC clock, with no offset applied. */
export function parseForumTimestamp(value: string): Date | null {
  const match = value
    .trim()
    .match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})/i);
  if (!match) {
    return null;
  }
  const parsed = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5])));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type StoredPublication =
  | { kind: "normalized"; at: Date }
  | { kind: "explicit"; at: Date }
  | { kind: "uncertain"; reason: "legacy-offsetless" | "missing" | "unrecognized" };

export function parseExplicitOffset(value: string): Date | null {
  const text = value.trim();
  if (!EXPLICIT_OFFSET.test(text)) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Permalink digits are site-local. The result is UTC, converted once. */
export function normalizeOffsetlessPublication(value: string): Date | null {
  const digits = parseForumTimestamp(value);
  if (!digits) {
    return null;
  }
  return new Date(digits.getTime() - FORUM_SITE_OFFSET_MINUTES * 60_000);
}

export function permalinkText(rawHtml: string): string | null {
  const bodyAt = rawHtml.search(/<p[\s>]/i);
  const meta = bodyAt === -1 ? rawHtml : rawHtml.slice(0, bodyAt);
  const match = meta.match(/#comment-\d+"[^>]*>\s*([^<]+)/i);
  return match?.[1]?.trim() || null;
}

/**
 * A stored `postedAt` is usable only when it already matches the normalized
 * permalink or an explicit offset. The legacy encoding stored the permalink
 * digits as UTC and stays uncertain. This does not rewrite the stored value.
 */
export function classifyStoredPublication(postedAt: Date | null, rawHtml: string | null | undefined): StoredPublication {
  if (postedAt == null) {
    return { kind: "uncertain", reason: "missing" };
  }
  if (rawHtml == null || rawHtml.trim() === "") {
    return { kind: "normalized", at: postedAt };
  }
  const permalink = permalinkText(rawHtml);
  if (!permalink) {
    return { kind: "uncertain", reason: "unrecognized" };
  }
  const explicit = parseExplicitOffset(permalink);
  if (explicit) {
    return explicit.getTime() === postedAt.getTime()
      ? { kind: "explicit", at: explicit }
      : { kind: "uncertain", reason: "unrecognized" };
  }
  const legacy = parseForumTimestamp(permalink);
  const normalized = normalizeOffsetlessPublication(permalink);
  if (normalized && normalized.getTime() === postedAt.getTime()) {
    return { kind: "normalized", at: normalized };
  }
  if (legacy && legacy.getTime() === postedAt.getTime()) {
    return { kind: "uncertain", reason: "legacy-offsetless" };
  }
  return { kind: "uncertain", reason: "unrecognized" };
}

/** Instant used by the deadline. Uncertain legacy times produce no instant. */
export function deadlineInstant(postedAt: Date | null, rawHtml: string | null | undefined): Date | null {
  const reading = classifyStoredPublication(postedAt, rawHtml);
  return reading.kind === "uncertain" ? null : reading.at;
}
