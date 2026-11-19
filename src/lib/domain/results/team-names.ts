import { normalizeTeamName } from "@/lib/domain/parser/normalize";

/**
 * Names published by external sources, mapped to the club names stored on
 * contest fixtures. Longer patterns win.
 */
const ENGLISH_CLUBS: readonly [string, string][] = [
  ["спартак москва", "Спартак"],
  ["динамо москва", "Динамо"],
  ["динамо махачкала", "Динамо Махачкала"],
  ["пфк цска", "ЦСКА"],
  ["dynamo makhachkala", "Динамо Махачкала"],
  ["dinamo makhachkala", "Динамо Махачкала"],
  ["krylya sovetov samara", "Крылья Советов"],
  ["krylya sovetov", "Крылья Советов"],
  ["krylia sovetov", "Крылья Советов"],
  ["zenit st petersburg", "Зенит"],
  ["zenit saint petersburg", "Зенит"],
  ["lokomotiv moscow", "Локомотив"],
  ["spartak moscow", "Спартак"],
  ["dinamo moscow", "Динамо"],
  ["dynamo moscow", "Динамо"],
  ["cska moscow", "ЦСКА"],
  ["rubin kazan", "Рубин"],
  ["fakel voronezh", "Факел"],
  ["akhmat grozny", "Ахмат"],
  ["fk akhmat", "Ахмат"],
  ["fc krasnodar", "Краснодар"],
  ["fc orenburg", "Оренбург"],
  ["fc rostov", "Ростов"],
  ["cska", "ЦСКА"],
  ["zenit", "Зенит"],
  ["spartak", "Спартак"],
  ["lokomotiv", "Локомотив"],
  ["krasnodar", "Краснодар"],
  ["akhmat", "Ахмат"],
  ["rostov", "Ростов"],
  ["rubin", "Рубин"],
  ["orenburg", "Оренбург"],
  ["fakel", "Факел"],
  ["baltika", "Балтика"],
  ["akron", "Акрон"],
  ["rodina", "Родина"],
];

/** Return the contest club name when the source uses a known English name. */
export function canonicalTeamName(value: string): string {
  const key = normalizeTeamName(value);
  let best: { length: number; name: string } | null = null;
  for (const [pattern, name] of ENGLISH_CLUBS) {
    const matches = key === pattern || key.startsWith(`${pattern} `) || key.endsWith(` ${pattern}`) || key.includes(` ${pattern} `);
    if (!matches) {
      continue;
    }
    if (!best || pattern.length > best.length) {
      best = { length: pattern.length, name };
    }
  }
  return best?.name ?? value;
}
