export interface ForumCommentExtract {
  externalId: string | null;
  authorName: string;
  postedAt: Date | null;
  rawHtml: string;
  rawText: string;
}

export interface ForumPost {
  title: string;
  sourceUrl: string;
  /** Plain text of the opening post, before the first comment. */
  openingText: string;
  /** Set by the downloader. Extraction itself does not invent a fetch time. */
  fetchedAt?: Date;
  comments: ForumCommentExtract[];
}
