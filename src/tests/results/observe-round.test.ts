import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { observeRoundDecisions } from "@/lib/domain/results/observe";
import type { SourceFetchResult } from "@/lib/domain/results/types";

const directories: string[] = [];

afterAll(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function disposable(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "udaff-observe-"));
  directories.push(directory);
  return directory;
}

describe("observe-only result rehearsal", () => {
  it("reports the would-be score without choosing an ambiguous name", () => {
    const report = observeRoundDecisions({
      roundNumber: 16,
      fixtures: [{
        id: "makh",
        homeTeam: "Локомотив",
        awayTeam: "Динамо Мx",
        homeAliases: [],
        awayAliases: ["Динамо Махачкала"],
        actualHomeGoals: null,
        actualAwayGoals: null,
      }],
      fetches: [{
        source: "sport-ru",
        role: "primary",
        url: "https://example.test/sport",
        status: "ok",
        error: null,
        results: [{
          source: "sport-ru",
          sourceKey: "one",
          roundNumber: 16,
          homeTeam: "Локомотив",
          awayTeam: "Динамо Махачкала",
          homeGoals: 1,
          awayGoals: 2,
          role: "primary",
          confidence: "high",
          matchStatus: "finished",
          completeness: "complete",
        }],
      }],
    });
    expect(report.fixtures[0]).toMatchObject({
      source: "sport-ru",
      homeGoals: 1,
      awayGoals: 2,
      outcome: "provisional",
      nameMatch: "alias",
    });
    expect(report.ambiguous).toEqual([]);
  });

  it("writes nothing when the operator command reads a disposable database", () => {
    const directory = disposable();
    const database = path.join(directory, "copy.db");
    const fixtures = path.join(directory, "fetches.json");
    const db = new DatabaseSync(database);
    db.exec(`
      CREATE TABLE "Season" ("id" TEXT PRIMARY KEY, "slug" TEXT);
      CREATE TABLE "Round" ("id" TEXT PRIMARY KEY, "seasonId" TEXT, "number" INTEGER);
      CREATE TABLE "Match" ("id" TEXT PRIMARY KEY, "roundId" TEXT, "sortOrder" INTEGER, "homeTeam" TEXT, "awayTeam" TEXT, "actualHomeGoals" INTEGER, "actualAwayGoals" INTEGER);
      CREATE TABLE "TeamName" ("id" TEXT PRIMARY KEY, "normalizedName" TEXT);
      CREATE TABLE "TeamNameAlias" ("id" TEXT PRIMARY KEY, "teamNameId" TEXT, "slot" INTEGER, "alias" TEXT);
      CREATE TABLE "ResultSourceHealth" ("source" TEXT PRIMARY KEY, "degraded" BOOLEAN, "consecutiveFailures" INTEGER, "lastSuccessAt" DATETIME, "lastError" TEXT);
      INSERT INTO "Season" VALUES ('s', 'rpl-demo-2026');
      INSERT INTO "Round" VALUES ('r', 's', 15);
      INSERT INTO "Match" VALUES ('m', 'r', 1, 'Ростов', 'Крылья Советов', 2, 1);
      INSERT INTO "ResultSourceHealth" VALUES ('football-data', 1, 28, NULL, 'missing key');
    `);
    db.close();
    const fetches: SourceFetchResult[] = [{
      source: "sport-ru",
      role: "primary",
      url: "https://example.test/sport",
      status: "ok",
      error: null,
      results: [{
        source: "sport-ru",
        sourceKey: "r15",
        roundNumber: 15,
        homeTeam: "Ростов",
        awayTeam: "Крылья Советов",
        homeGoals: 2,
        awayGoals: 1,
        role: "primary",
        confidence: "high",
        matchStatus: "finished",
        completeness: "complete",
      }],
    }];
    writeFileSync(fixtures, JSON.stringify(fetches));
    const before = readFileSync(database);
    const output = execFileSync(path.resolve("node_modules/.bin/tsx"), [
      "scripts/observe-round-results.ts",
      "--database",
      database,
      "--round",
      "15",
      "--fixtures",
      fixtures,
    ], { cwd: process.cwd(), encoding: "utf8" });
    const after = readFileSync(database);
    expect(createHash("sha256").update(after).digest("hex")).toBe(createHash("sha256").update(before).digest("hex"));
    const report = JSON.parse(output) as { fixtures: Array<{ agreesWithStored: boolean; outcome: string }> };
    expect(report.fixtures[0]?.agreesWithStored).toBe(true);
    expect(report.fixtures[0]?.outcome).toBe("provisional");
    const check = new DatabaseSync(database, { readOnly: true });
    expect((check.prepare(`SELECT COUNT(*) AS n FROM "Match"`).get() as { n: number }).n).toBe(1);
    expect((check.prepare(`SELECT actualHomeGoals AS n FROM "Match"`).get() as { n: number }).n).toBe(2);
    check.close();
  });
});
