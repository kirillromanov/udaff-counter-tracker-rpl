import { normalizeCommentText, normalizeTeamName } from "@/lib/domain/parser/normalize";
import { readFixtureLine, type ScheduledFixture } from "./parse-schedule";
import type { ForumPost } from "./types";

export type FixtureSourceName = "article_body" | "first_comment_fallback";

export interface ChosenSchedule {
  ok: true;
  source: FixtureSourceName;
  fixtures: ScheduledFixture[];
  warnings: string[];
  excerpt: string;
  fallbackReason: string | null;
}

export interface RejectedSchedule {
  ok: false;
  error: string;
}

const MARKER = /(?<![\p{L}\p{N}_])абразцы(?![\p{L}\p{N}_])/iu;
const DATE_LINE = /^\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s+\d{1,2}:\d{2}\b/u;

function hasMarker(line: string): boolean {
  return MARKER.test(normalizeCommentText(line));
}

function isDateLine(line: string): boolean {
  return DATE_LINE.test(normalizeCommentText(line));
}

/**
 * The schedule is the fixture lines after a standalone "Абразцы" heading.
 * Prose before the first fixture line is skipped. The block ends at the next non-fixture line.
 */
export function scheduleBlockAfterMarker(text: string): { lines: string[] } | { error: string } {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => hasMarker(line));
  if (index < 0) {
    return { error: "The article has no Абразцы heading." };
  }
  const collected: string[] = [];
  let started = false;
  for (const raw of lines.slice(index + 1)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (isDateLine(line)) {
      started = true;
      collected.push(line);
      continue;
    }
    if (!started) {
      continue;
    }
    break;
  }
  if (collected.length === 0) {
    return { error: "The Абразцы section has no fixture list." };
  }
  return { lines: collected };
}

function pairKey(fixture: ScheduledFixture): string {
  return `${normalizeTeamName(fixture.homeTeam)}|${normalizeTeamName(fixture.awayTeam)}`;
}

/**
 * Accept a schedule block only when every dated line is a real fixture.
 * A count other than eight, or a missing Match of the Round, stays a warning.
 * Conflicts, unreadable lines, and more than one Match of the Round reject the whole block.
 */
export function validateScheduleLines(lines: readonly string[]): { fixtures: ScheduledFixture[]; warnings: string[] } | { error: string } {
  const fixtures: ScheduledFixture[] = [];
  const byPair = new Map<string, ScheduledFixture>();
  for (const raw of lines) {
    const fixture = readFixtureLine(raw);
    if (!fixture?.kickoffAt) {
      return { error: `Could not read a fixture from “${raw.trim()}”.` };
    }
    const key = pairKey(fixture);
    const previous = byPair.get(key);
    if (previous && previous.kickoffAt?.getTime() !== fixture.kickoffAt.getTime()) {
      return { error: `Conflicting kickoff for ${fixture.homeTeam} — ${fixture.awayTeam}.` };
    }
    if (!previous) {
      byPair.set(key, fixture);
      fixtures.push(fixture);
      continue;
    }
    if (fixture.isMatchOfTheRound) {
      previous.isMatchOfTheRound = true;
    }
  }
  if (fixtures.length === 0) {
    return { error: "No fixtures were read from the schedule." };
  }
  const marked = fixtures.filter((fixture) => fixture.isMatchOfTheRound);
  if (marked.length > 1) {
    return { error: "More than one Match of the Round was marked." };
  }
  const warnings: string[] = [];
  if (fixtures.length !== 8) {
    warnings.push(`Expected 8 fixtures in the opening post and found ${fixtures.length}`);
  }
  if (marked.length === 0) {
    warnings.push("No Match of the Round was marked in the opening post");
  }
  return { fixtures, warnings };
}

/** Earliest posted comment, then the lowest comment id. Array order is not the first comment. */
export function earliestComment<T extends { postedAt: Date | null; externalId: string | null }>(
  comments: readonly T[],
): T | null {
  if (comments.length === 0) {
    return null;
  }
  return [...comments].sort((left, right) => {
    const leftAt = left.postedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightAt = right.postedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    return (left.externalId ?? "").localeCompare(right.externalId ?? "", "en", { numeric: true });
  })[0] ?? null;
}

function accepted(lines: readonly string[]): { fixtures: ScheduledFixture[]; warnings: string[]; excerpt: string } | { error: string } {
  const validated = validateScheduleLines(lines);
  if ("error" in validated) {
    return validated;
  }
  return { ...validated, excerpt: lines.join("\n") };
}

/** The article is only the block after Абразцы. Other sections are not a schedule. */
function fromArticle(text: string): { fixtures: ScheduledFixture[]; warnings: string[]; excerpt: string } | { error: string } {
  const block = scheduleBlockAfterMarker(text);
  if ("error" in block) {
    return block;
  }
  return accepted(block.lines);
}

/** A comment with the heading uses that block. Otherwise the existing dated-line fallback applies. */
function fromComment(text: string): { fixtures: ScheduledFixture[]; warnings: string[]; excerpt: string } | { error: string } {
  if (text.split("\n").some((line) => hasMarker(line))) {
    const block = scheduleBlockAfterMarker(text);
    if ("error" in block) {
      return block;
    }
    return accepted(block.lines);
  }
  const dated = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && isDateLine(line));
  if (dated.length === 0) {
    return { error: "The first comment has no fixture list." };
  }
  return accepted(dated);
}

function rejection(article: string, comment: string): RejectedSchedule {
  return {
    ok: false,
    error: `Could not import a fixture schedule. No fixtures were saved. Article: ${article} First comment: ${comment}`,
  };
}

/**
 * Article schedule first. The first comment is used only when the article has no usable schedule.
 * The two lists are never merged.
 */
export function chooseFixtureSchedule(
  post: Pick<ForumPost, "openingText" | "comments">,
): ChosenSchedule | RejectedSchedule {
  const article = fromArticle(post.openingText);
  if (!("error" in article)) {
    return {
      ok: true,
      source: "article_body",
      fixtures: article.fixtures,
      warnings: article.warnings,
      excerpt: article.excerpt,
      fallbackReason: null,
    };
  }
  const first = earliestComment(post.comments);
  if (!first) {
    return rejection(article.error, "There is no first comment on this post.");
  }
  const comment = fromComment(first.rawText);
  if ("error" in comment) {
    return rejection(article.error, comment.error);
  }
  return {
    ok: true,
    source: "first_comment_fallback",
    fixtures: comment.fixtures,
    warnings: comment.warnings,
    excerpt: comment.excerpt,
    fallbackReason: article.error,
  };
}

export function fixtureProvenance(choice: ChosenSchedule, url: string, extractedAt: Date): string {
  const lines = [
    `Fixture source: ${choice.source}`,
    `URL: ${url}`,
    `Extracted: ${extractedAt.toISOString()}`,
  ];
  if (choice.fallbackReason) {
    lines.push(`Fallback: ${choice.fallbackReason}`);
  }
  return [...lines, ...choice.warnings].join("\n");
}
