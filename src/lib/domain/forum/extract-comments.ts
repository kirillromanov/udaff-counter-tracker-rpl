import type { ForumCommentExtract, ForumPost } from "./types";

/**
 * Assumptions for https://canadaru.net/udaff_afterlife/ (WordPress + Atahualpa):
 * - The post title is the first `<h1>` inside `.post-headline`, otherwise `<title>`.
 * - Each comment is an `<li id="comment-{id}">`, including replies.
 * - The author is `span.authorname`.
 * - The timestamp is the text of the permalink `a[href="#comment-{id}"]`,
 *   shaped like `16/10/2026 at 10:10`. It is stored as UTC with no zone conversion.
 * - The body is the `<p>` elements before a nested `ul.children`.
 * - The live theme prints a PHP warning inside the comment container class.
 *   Extraction does not depend on that class being valid HTML.
 * - This reads only the HTML of the given URL. The sample post includes every
 *   comment on one page and has no comment pagination links.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  hellip: "…",
};

export function decodeHtml(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? full;
  });
}

export function parseForumTimestamp(value: string): Date | null {
  const match = value
    .trim()
    .match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})/i);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTitle(html: string): string {
  const headline = html.match(/class="post-headline"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (headline?.[1]) {
    return stripTags(headline[1]);
  }
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!title?.[1]) {
    return "Forum post";
  }
  return stripTags(title[1]).replace(/\s+[«|].*$/, "").trim();
}

function commentBody(chunk: string): { html: string; text: string } {
  const beforeChildren = chunk.split(/<ul[^>]*class="children"/i)[0] ?? chunk;
  const paragraphs = [...beforeChildren.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(
    (match) => match[1] ?? "",
  );
  const html = paragraphs.join("\n");
  return { html, text: stripTags(html) };
}

export function extractOpeningPost(html: string): string {
  const start = html.search(/class="post-bodycopy/i);
  if (start < 0) {
    return "";
  }
  const rest = html.slice(start);
  const end = rest.search(/<li\b[^>]*\bid="comment-\d+"/i);
  return stripTags(end >= 0 ? rest.slice(0, end) : rest.slice(0, 80_000));
}

export function extractForumPost(html: string, sourceUrl: string): ForumPost {
  const parts = html.split(/<li\b[^>]*\bid="comment-(\d+)"[^>]*>/i);
  const comments: ForumCommentExtract[] = [];

  for (let index = 1; index < parts.length; index += 2) {
    const externalId = parts[index] ?? null;
    const chunk = parts[index + 1] ?? "";
    const author = chunk.match(/class="authorname"[^>]*>\s*([^<]+?)\s*</i);
    const permalink = externalId
      ? chunk.match(new RegExp(`#comment-${externalId}"[^>]*>\\s*([^<]+)`, "i"))
      : null;
    const body = commentBody(chunk);

    comments.push({
      externalId,
      authorName: decodeHtml(author?.[1]?.trim() || "unknown"),
      postedAt: permalink?.[1] ? parseForumTimestamp(permalink[1]) : null,
      rawHtml: chunk.trim(),
      rawText: body.text,
    });
  }

  return {
    title: extractTitle(html),
    sourceUrl,
    openingText: extractOpeningPost(html),
    comments,
  };
}
