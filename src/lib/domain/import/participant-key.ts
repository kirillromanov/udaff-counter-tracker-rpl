/**
 * Identity key for a forum nick.
 *
 * Case, ё/е, extra spaces, and punctuation wrapped around the nick
 * (`Йош!`, `  XXX  `) collapse to one participant. Extra words stay,
 * so `Павел` and `Павел Абросимов` remain different people.
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
