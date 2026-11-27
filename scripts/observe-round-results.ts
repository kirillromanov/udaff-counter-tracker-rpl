import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { teamKey } from "../src/lib/domain/parser/normalize";
import { observeRoundDecisions } from "../src/lib/domain/results/observe";
import { RESULT_ADAPTERS, interpretSourcePage } from "../src/lib/domain/results/sources";
import type { SourceFetchResult } from "../src/lib/domain/results/types";

/**
 * Read-only rehearsal of one round's result check.
 * Opens the given database read-only. Does not write matches, observations,
 * fetch logs, source health, scores, audits, or claims.
 *
 *   npx tsx scripts/observe-round-results.ts --database /absolute/path/dev.db --round 15
 *   npx tsx scripts/observe-round-results.ts --database /absolute/path/dev.db --round 15 --fixtures /absolute/path/fetches.json
 *
 * This process does not read DATABASE_URL or .env.
 */

function argument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (!value || value.startsWith("-")) {
    return undefined;
  }
  return value;
}

function requireAbsoluteDatabase(value: string | undefined): string {
  if (!value) {
    throw new Error("Pass --database with an absolute path to an existing SQLite file.");
  }
  if (value.startsWith("file:")) {
    throw new Error("Database path must be a filesystem path, not a file: URL.");
  }
  if (!path.isAbsolute(value)) {
    throw new Error("Database path must be absolute.");
  }
  return value;
}

async function liveFetches(): Promise<SourceFetchResult[]> {
  const fetches: SourceFetchResult[] = [];
  for (const adapter of RESULT_ADAPTERS) {
    if (adapter.load) {
      fetches.push(await adapter.load());
      continue;
    }
    try {
      const response = await fetch(adapter.url, {
        headers: { "user-agent": "udaff-counter-tracker/0.1", accept: "text/html" },
        signal: AbortSignal.timeout(20_000),
      });
      const html = await response.text();
      fetches.push(interpretSourcePage(adapter, response.ok, html, response.ok ? null : `HTTP ${response.status}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      fetches.push(interpretSourcePage(adapter, false, "", message));
    }
  }
  return fetches;
}

function readOnly<T>(file: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5_000 });
  try {
    db.exec("PRAGMA query_only = ON");
    return read(db);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const databasePath = requireAbsoluteDatabase(argument(argv, "--database"));
  const roundNumber = Number(argument(argv, "--round"));
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new Error("Pass --round with a positive round number.");
  }
  const fixturesPath = argument(argv, "--fixtures");
  const fetches = fixturesPath
    ? JSON.parse(readFileSync(fixturesPath, "utf8")) as SourceFetchResult[]
    : await liveFetches();
  const report = readOnly(databasePath, (db) => {
    const round = db.prepare(
      `SELECT r.id, r.number FROM "Round" r JOIN "Season" s ON s.id = r.seasonId WHERE r.number = ? AND s.slug = 'rpl-demo-2026'`,
    ).get(roundNumber) as { id: string; number: number } | undefined;
    if (!round) {
      throw new Error(`Round ${roundNumber} was not found in season rpl-demo-2026.`);
    }
    const matches = db.prepare(
      `SELECT id, homeTeam, awayTeam, actualHomeGoals, actualAwayGoals FROM "Match" WHERE roundId = ? ORDER BY sortOrder`,
    ).all(round.id) as Array<{
      id: string;
      homeTeam: string;
      awayTeam: string;
      actualHomeGoals: number | null;
      actualAwayGoals: number | null;
    }>;
    const aliasRows = db.prepare(
      `SELECT t.normalizedName AS key, a.alias AS alias FROM "TeamName" t JOIN "TeamNameAlias" a ON a.teamNameId = t.id ORDER BY a.slot`,
    ).all() as Array<{ key: string; alias: string }>;
    const aliases = new Map<string, string[]>();
    for (const row of aliasRows) {
      const list = aliases.get(row.key) ?? [];
      list.push(row.alias);
      aliases.set(row.key, list);
    }
    const health = db.prepare(
      `SELECT source, degraded, consecutiveFailures, lastSuccessAt, lastError FROM "ResultSourceHealth" ORDER BY source`,
    ).all() as Array<{ source: string; degraded: number; consecutiveFailures: number; lastSuccessAt: string | null; lastError: string | null }>;
    const decisions = observeRoundDecisions({
      roundNumber: round.number,
      fixtures: matches.map((match) => ({
        ...match,
        homeAliases: aliases.get(teamKey(match.homeTeam)) ?? [],
        awayAliases: aliases.get(teamKey(match.awayTeam)) ?? [],
      })),
      fetches,
    });
    return { ...decisions, storedHealth: health };
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
