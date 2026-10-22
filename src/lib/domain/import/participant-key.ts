/**
 * Identity key for a forum nick.
 *
 * Case, ё/е, extra spaces, and punctuation wrapped around the nick
 * (`Йош!`, `  XXX  `) collapse to one key. Extra words stay different keys.
 * A known alias, not this function, maps `Павел` onto `Павел Абросимов`.
 */
export function participantKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff\u00ad]/g, "")
    .replace(/\p{Zs}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е");
}
