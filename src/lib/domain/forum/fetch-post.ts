import { z } from "zod";
import { extractForumPost, listCommentPageUrls } from "./extract-comments";
import type { ForumPost } from "./types";

export const forumUrlSchema = z
  .string()
  .trim()
  .url("Enter a full forum post URL")
  .refine((value) => /^https?:\/\//i.test(value), "URL must start with http:// or https://");

async function fetchForumHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "udaff-counter-tracker/0.1",
      accept: "text/html",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Forum request failed (${response.status})`);
  }
  return response.text();
}

export async function fetchForumPost(url: string): Promise<ForumPost> {
  const sourceUrl = forumUrlSchema.parse(url);
  const html = await fetchForumHtml(sourceUrl);
  return { ...extractForumPost(html, sourceUrl), fetchedAt: new Date() };
}

const MAX_COMMENT_PAGES = 30;

/** Fetch the post and any comment pages linked from it. Comments are merged by id. */
export async function fetchForumThread(url: string): Promise<{ post: ForumPost; pagesFetched: number; pageErrors: string[] }> {
  const sourceUrl = forumUrlSchema.parse(url);
  const html = await fetchForumHtml(sourceUrl);
  const post = { ...extractForumPost(html, sourceUrl), fetchedAt: new Date() };
  const pages = listCommentPageUrls(html, sourceUrl);
  const seen = new Set(post.comments.flatMap((comment) => (comment.externalId ? [comment.externalId] : [])));
  const pageErrors: string[] = [];
  let pagesFetched = 1;
  for (const pageUrl of pages.slice(0, MAX_COMMENT_PAGES)) {
    try {
      const pageHtml = await fetchForumHtml(pageUrl);
      const extra = extractForumPost(pageHtml, pageUrl);
      for (const comment of extra.comments) {
        if (comment.externalId && seen.has(comment.externalId)) {
          continue;
        }
        if (comment.externalId) {
          seen.add(comment.externalId);
        }
        post.comments.push(comment);
      }
      pagesFetched += 1;
    } catch (error) {
      pageErrors.push(`${pageUrl}: ${error instanceof Error ? error.message : "Request failed"}`);
    }
  }
  if (pages.length > MAX_COMMENT_PAGES) {
    pageErrors.push(`Stopped after ${MAX_COMMENT_PAGES} extra comment pages; ${pages.length} were linked.`);
  }
  return { post, pagesFetched, pageErrors };
}
