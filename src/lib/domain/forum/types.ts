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
  comments: ForumCommentExtract[];
}
