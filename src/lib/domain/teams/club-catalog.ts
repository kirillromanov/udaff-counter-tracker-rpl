import { teamKey } from "@/lib/domain/parser/normalize";

export interface ClubAppearance {
  name: string;
  roundNumber: number;
}

export interface ClubRow {
  name: string;
  key: string;
  fixtureCount: number;
  rounds: number[];
  warnings: string[];
}

function makhachkalaKey(key: string): boolean {
  return key.includes("махачкала") || / м[хx]$/u.test(key);
}

function latinInsideCyrillic(name: string): string[] {
  const chars = [...name];
  if (!chars.some((char) => /\p{Script=Cyrillic}/u.test(char))) {
    return [];
  }
  return chars.filter((char) => /\p{Script=Latin}/u.test(char));
}

export function buildClubCatalog(appearances: readonly ClubAppearance[]): ClubRow[] {
  const byName = new Map<string, { rounds: Set<number>; count: number }>();
  for (const appearance of appearances) {
    const current = byName.get(appearance.name) ?? { rounds: new Set<number>(), count: 0 };
    current.count += 1;
    current.rounds.add(appearance.roundNumber);
    byName.set(appearance.name, current);
  }
  const names = [...byName.keys()];
  const namesByKey = new Map<string, string[]>();
  for (const name of names) {
    const key = teamKey(name);
    namesByKey.set(key, [...(namesByKey.get(key) ?? []), name]);
  }
  const makhachkalaNames = names.filter((name) => makhachkalaKey(teamKey(name)));

  return names
    .map((name) => {
      const key = teamKey(name);
      const warnings: string[] = [];
      const latin = latinInsideCyrillic(name);
      if (latin.length > 0) {
        const listed = latin
          .map((char) => `${char} (U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`)
          .join(", ");
        warnings.push(`Latin letter inside a Cyrillic name: ${listed}.`);
      }
      const sameKey = (namesByKey.get(key) ?? []).filter((other) => other !== name);
      if (sameKey.length > 0) {
        warnings.push(`Same key as ${sameKey.join(", ")}.`);
      }
      if (makhachkalaKey(key)) {
        const others = makhachkalaNames.filter((other) => other !== name);
        if (others.length > 0) {
          warnings.push(`Also stored in fixtures as ${others.join(", ")}.`);
        }
      }
      const bucket = byName.get(name)!;
      return {
        name,
        key,
        fixtureCount: bucket.count,
        rounds: [...bucket.rounds].sort((left, right) => left - right),
        warnings,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}
