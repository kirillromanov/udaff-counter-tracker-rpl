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
    .replace(/[—–―−]/g, "-")
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
