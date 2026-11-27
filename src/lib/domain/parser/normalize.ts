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

/**
 * Tokens used to compare a header keyword or a team spelling.
 *
 * Punctuation and symbols are removed before NFKC. The trademark sign
 * otherwise decomposes into the letters "TM" and sticks to the previous
 * word. Styled letters and digits are letters and numbers, so they survive
 * that removal and then fold to plain characters. Case and ё/е are folded.
 * Letters stay in their own script: a Latin lookalike is not rewritten as
 * Cyrillic. The result is a list of whole words, never a fuzzy fragment.
 */
export function matchTokens(value: string): string[] {
  const withoutDecoration = value.normalize("NFC").replace(/[\p{P}\p{S}\p{C}]+/gu, " ");
  const folded = withoutDecoration.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е");
  return folded.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
}

/** Stable key for a team name or an alias. Empty when nothing letter-like remains. */
export function teamKey(value: string): string {
  return matchTokens(value).join(" ");
}

export function sameTokens(left: readonly string[], right: readonly string[]): boolean {
  return left.length > 0 && left.length === right.length && left.every((token, index) => token === right[index]);
}
