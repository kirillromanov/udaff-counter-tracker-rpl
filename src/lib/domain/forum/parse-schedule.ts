import { normalizeTeamName } from "@/lib/domain/parser/normalize";

export interface ScheduledFixture {
  kickoffAt: Date | null;
  homeTeam: string;
  awayTeam: string;
  isMatchOfTheRound: boolean;
  rawLine: string;
}

export interface FixtureSchedule {
  fixtures: ScheduledFixture[];
  warnings: string[];
}

const MT = /\(\s*(?:мт|mt)\s*\)/iu;

function cleanSide(value: string): { name: string; matchOfTheRound: boolean } {
  const matchOfTheRound = MT.test(value);
  const name = value
    .replace(MT, "")
    .replace(/[.]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return { name, matchOfTheRound };
}

function tooWordy(value: string): boolean {
  const words = value.split(" ").filter(Boolean);
  return words.length === 0 || words.length > 4;
}

/**
 * Read the dated fixture list from an opening post.
 * Lines look like `26.07.2026 19:30 — Рубин — Краснодар (МТ)` or
 * `16.09.2026 18:30 Спартак – Факел`. Standings rows and prose are ignored.
 * A missing year uses `defaultYear`. Kickoff is stored as UTC, same as comment times.
 */
export function parseFixtureSchedule(text: string, defaultYear = 2026): FixtureSchedule {
  const byPair = new Map<string, ScheduledFixture>();

  for (const raw of text.split("\n")) {
    const line = raw.replace(/[—–―−]/gu, "-").trim();
    const match = line.match(
      /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})\s*-?\s*(.+?)\s+-\s+(.+?)\s*$/u,
    );
    if (!match) {
      continue;
    }
    const home = cleanSide(match[6] ?? "");
    const away = cleanSide(match[7] ?? "");
    if (tooWordy(home.name) || tooWordy(away.name)) {
      continue;
    }
    if (/\d/u.test(home.name) || /\d/u.test(away.name)) {
      continue;
    }
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = match[3] ? Number(match[3]) : defaultYear;
    const kickoffAt = new Date(Date.UTC(year, month - 1, day, Number(match[4]), Number(match[5])));
    if (Number.isNaN(kickoffAt.getTime())) {
      continue;
    }
    const key = `${normalizeTeamName(home.name)}|${normalizeTeamName(away.name)}`;
    if (!key || key === "|") {
      continue;
    }
    const next: ScheduledFixture = {
      kickoffAt,
      homeTeam: home.name,
      awayTeam: away.name,
      isMatchOfTheRound: home.matchOfTheRound || away.matchOfTheRound,
      rawLine: raw.trim(),
    };
    const current = byPair.get(key);
    if (!current) {
      byPair.set(key, next);
      continue;
    }
    const currentHasYear = /\d{4}/u.test(current.rawLine);
    const nextHasYear = Boolean(match[3]);
    byPair.set(key, {
      ...(nextHasYear || !currentHasYear ? next : current),
      isMatchOfTheRound: current.isMatchOfTheRound || next.isMatchOfTheRound,
    });
  }

  const fixtures = [...byPair.values()];
  const warnings: string[] = [];
  if (fixtures.length !== 8) {
    warnings.push(`Expected 8 fixtures in the opening post and found ${fixtures.length}`);
  }
  const marked = fixtures.filter((fixture) => fixture.isMatchOfTheRound);
  if (marked.length === 0) {
    warnings.push("No Match of the Round was marked in the opening post");
  } else if (marked.length > 1) {
    warnings.push("More than one Match of the Round was marked in the opening post");
    for (const fixture of fixtures) {
      fixture.isMatchOfTheRound = false;
    }
  }
  return { fixtures, warnings };
}
