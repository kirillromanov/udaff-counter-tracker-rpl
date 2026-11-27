import { writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { attributeComment } from "../src/lib/domain/parser/attribute-blocks";
import { parseComment, rowsForStorage } from "../src/lib/domain/parser/parse-comment";
import { teamKey } from "../src/lib/domain/parser/normalize";
import type { FixtureRef } from "../src/lib/domain/parser/types";

/**
 * Read-only parse of stored comments on a disposable snapshot copy.
 * The script never writes the database. It refuses the live database path.
 *
 *   npx tsx scripts/dump-comment-parses.ts --database /absolute/copy.db --out /absolute/parses.json
 */

function argument(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Pass ${flag} with an absolute path.`);
  }
  if (!path.isAbsolute(value)) {
    throw new Error(`${flag} must be an absolute path.`);
  }
  return value;
}

const databasePath = argument("--database");
const outPath = argument("--out");
const live = path.resolve("prisma/dev.db");
if (path.resolve(databasePath) === live) {
  throw new Error("Refusing the live database path. Pass a disposable copy.");
}

const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
const rounds = db
  .prepare(
    `SELECT r.id, r.number FROM Round r WHERE r.number IN (14, 15, 16) ORDER BY r.number`,
  )
  .all() as Array<{ id: string; number: number }>;

const hasAliases = db
  .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'TeamNameAlias'`)
  .get();
const aliasRows = hasAliases
  ? (db
      .prepare(
        `SELECT t.normalizedName AS key, a.alias AS alias
         FROM TeamNameAlias a JOIN TeamName t ON t.id = a.teamNameId
         ORDER BY a.slot`,
      )
      .all() as Array<{ key: string; alias: string }>)
  : [];
const aliases = new Map<string, string[]>();
for (const row of aliasRows) {
  aliases.set(row.key, [...(aliases.get(row.key) ?? []), row.alias]);
}

const report: unknown[] = [];
for (const round of rounds) {
  const matches = db
    .prepare(
      `SELECT id, homeTeam, awayTeam, isMatchOfTheRound FROM Match WHERE roundId = ? ORDER BY sortOrder`,
    )
    .all(round.id) as Array<{ id: string; homeTeam: string; awayTeam: string; isMatchOfTheRound: number }>;
  const fixtures: FixtureRef[] = matches.map((match) => ({
    id: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeAliases: aliases.get(teamKey(match.homeTeam)) ?? [],
    awayAliases: aliases.get(teamKey(match.awayTeam)) ?? [],
  }));
  const comments = db
    .prepare(
      `SELECT id, externalId, authorName, ingestionStatus, reviewState, reviewNote, rawText
       FROM ForumComment WHERE roundId = ? ORDER BY externalId`,
    )
    .all(round.id) as Array<{
      id: string;
      externalId: string;
      authorName: string;
      ingestionStatus: string;
      reviewState: string;
      reviewNote: string | null;
      rawText: string;
    }>;
  for (const comment of comments) {
    const blocks = attributeComment({
      raw: comment.rawText,
      authorName: comment.authorName,
      roundNumber: round.number,
    });
    report.push({
      round: round.number,
      externalId: comment.externalId,
      authorName: comment.authorName,
      ingestionStatus: comment.ingestionStatus,
      reviewState: comment.reviewState,
      reviewNote: comment.reviewNote,
      matchOfTheRound: matches.filter((match) => match.isMatchOfTheRound === 1).map((match) => match.id),
      blocks: blocks.map((block) => {
        const parsed = parseComment(block.text, fixtures);
        return {
          ownerName: block.ownerName,
          method: block.method,
          review: block.review,
          warnings: [...block.warnings, ...parsed.warnings],
          rows: rowsForStorage(parsed).map((line) => ({
            matchId: line.fixtureId,
            score: `${line.homeGoals}-${line.awayGoals}`,
            markedAsMt: line.markedAsMt,
          })),
        };
      }),
    });
  }
}
db.close();
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`wrote ${report.length} comments`);
