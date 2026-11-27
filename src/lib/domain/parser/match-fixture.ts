import type { FixtureRef } from "./types";
import { matchTokens, normalizeTeamName, sameTokens } from "./normalize";

/**
 * Forum nicknames that should compare equal to the full club token.
 * "Динамо Мх" is Dynamo Makhachkala. "Кр Советов" is Krylia Sovetov.
 * Two-letter cuts are aliases, not a general prefix rule.
 */
const TOKEN_ALIASES: Record<string, string> = {
  мх: "махачкала",
  кр: "крылья",
};

export interface FixtureMatch {
  fixtureId: string;
  label: string;
  confidence: number;
  swapped: boolean;
  ambiguous: boolean;
}

function aliasTokens(value: string): string {
  return normalizeTeamName(value)
    .split(" ")
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .join(" ");
}

function tokenPairScore(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length >= 3 && longer.startsWith(shorter)) {
    return 0.86;
  }
  return 0;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = previous[j] ?? 0;
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      previous[j] = Math.min((previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + 1, diagonal + cost);
      diagonal = saved;
    }
  }
  return previous[right.length] ?? 0;
}

export function teamSimilarity(left: string, right: string): number {
  const a = aliasTokens(left);
  const b = aliasTokens(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const aTokens = a.split(" ");
  const bTokens = b.split(" ");
  const [shorter, longer] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  const longerSet = new Set(longer);
  if (shorter.every((token) => longerSet.has(token)) && Math.max(...shorter.map((token) => token.length)) >= 4) {
    return 0.75 + 0.2 * (shorter.length / longer.length);
  }

  if (aTokens.length === bTokens.length) {
    const aligned = aTokens.map((token, index) => tokenPairScore(token, bTokens[index] ?? ""));
    if (aligned.every((score) => score > 0)) {
      return aligned.reduce((total, score) => total + score, 0) / aligned.length;
    }
  }

  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function labelsOf(fixture: FixtureRef, side: "home" | "away"): string[] {
  const canonical = side === "home" ? fixture.homeTeam : fixture.awayTeam;
  const extra = side === "home" ? fixture.homeAliases : fixture.awayAliases;
  return [canonical, ...(extra ?? [])];
}

function exactLabel(slip: string, label: string): boolean {
  return sameTokens(matchTokens(slip), matchTokens(label));
}

/**
 * An exact spelling scores 1. "Динамо Махачкала" equals that spelling and
 * does not equal "Динамо", so the longer name is not given to Dynamo Moscow.
 * A shorter side that is not an exact spelling still uses the older
 * similarity score, which is how "Динамо — Акрон" stays Dynamo Makhachkala.
 */
function scoreSide(slip: string, labels: readonly string[]): number {
  if (labels.some((label) => exactLabel(slip, label))) {
    return 1;
  }
  const scores = labels.map((label) => teamSimilarity(slip, label));
  return scores.length === 0 ? 0 : Math.max(...scores);
}

function pairScore(home: string, away: string, fixture: FixtureRef): number {
  return (scoreSide(home, labelsOf(fixture, "home")) + scoreSide(away, labelsOf(fixture, "away"))) / 2;
}

export function matchFixture(
  homeName: string | null,
  awayName: string | null,
  fixtures: FixtureRef[],
): FixtureMatch | null {
  if (!homeName || !awayName) {
    return null;
  }

  const ranked = fixtures
    .map((fixture) => {
      const direct = pairScore(homeName, awayName, fixture);
      const swapped = pairScore(awayName, homeName, fixture);
      const useSwap = swapped > direct;
      return {
        fixtureId: fixture.id,
        label: `${fixture.homeTeam} — ${fixture.awayTeam}`,
        confidence: useSwap ? swapped * 0.9 : direct,
        swapped: useSwap,
      };
    })
    .sort((left, right) => right.confidence - left.confidence);

  const best = ranked[0];
  if (!best || best.confidence < 0.72) {
    return null;
  }
  const second = ranked[1];
  const ambiguous = Boolean(
    second && second.confidence >= 0.72 && best.confidence - second.confidence < 0.05,
  );
  return { ...best, ambiguous };
}
