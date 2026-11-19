import { normalizeOffsetlessPublication, parseExplicitOffset, permalinkText } from "@/lib/domain/time/publication-clock";

const EDIT_MARK = /edited|изменено|отредактировано|правка/i;

/**
 * An edit time is reliable only when the comment metadata, not the prediction
 * text, contains an edit mark and one timestamp different from publication.
 * The permalink time is the publication time and does not authorize an edit.
 */
export function commentEditEvidence(rawHtml: string, publishedAt: Date | null): { editedAt: Date | null } {
  const bodyAt = rawHtml.search(/<p[\s>]/i);
  const meta = bodyAt === -1 ? rawHtml : rawHtml.slice(0, bodyAt);
  if (!EDIT_MARK.test(meta)) {
    return { editedAt: null };
  }
  const permalink = permalinkText(meta);
  const times: Date[] = [];
  for (const match of meta.matchAll(/datetime="([^"]+)"/gi)) {
    const parsed = parseExplicitOffset(match[1] ?? "");
    if (parsed) {
      times.push(parsed);
    }
  }
  for (const match of meta.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+at)?\s+\d{1,2}:\d{2})/gi)) {
    const text = match[1] ?? "";
    if (permalink && text.trim() === permalink) {
      continue;
    }
    const parsed = normalizeOffsetlessPublication(text);
    if (parsed) {
      times.push(parsed);
    }
  }
  const distinct = times.filter((time) => publishedAt == null || time.getTime() !== publishedAt.getTime());
  const first = distinct[0];
  if (!first || !distinct.every((time) => time.getTime() === first.getTime())) {
    return { editedAt: null };
  }
  return { editedAt: first };
}
