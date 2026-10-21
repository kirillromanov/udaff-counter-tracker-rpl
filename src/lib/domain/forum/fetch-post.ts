import { z } from "zod";
import { extractForumPost } from "./extract-comments";
import type { ForumPost } from "./types";

export const forumUrlSchema = z
  .string()
  .trim()
  .url("Enter a full forum post URL")
  .refine((value) => /^https?:\/\//i.test(value), "URL must start with http:// or https://");

export async function fetchForumPost(url: string): Promise<ForumPost> {
  const sourceUrl = forumUrlSchema.parse(url);
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "udaff-counter-tracker/0.1",
      accept: "text/html",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Forum request failed (${response.status})`);
  }
  const html = await response.text();
  return { ...extractForumPost(html, sourceUrl), fetchedAt: new Date() };
}
