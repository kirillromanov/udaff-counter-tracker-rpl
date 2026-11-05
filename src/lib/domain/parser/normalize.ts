/**
 * Turn forum punctuation into a single dash and collapse whitespace.
 *
 * NFKC folds mathematical bold digits and letters (`𝟮`, `𝗦`) into plain
 * text. Superscript `²` becomes `2`, so an `*²` match-of-the-round mark
 * is detected later as `*2`.
 */
export function normalizeCommentText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff\u00ad]/g, "")
    .replace(/\p{Zs}/gu, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTeamName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
