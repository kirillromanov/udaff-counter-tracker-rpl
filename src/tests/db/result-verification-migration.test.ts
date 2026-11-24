import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  applyResultVerificationSchema,
  migrationStatements,
} from "@/lib/db/result-verification-migration";

const addedColumns = new Set([
  "resultProvenance",
  "manuallyCorrected",
  "resultVersion",
  "firstSeenAt",
  "lastSeenAt",
]);

describe("result verification schema migration", () => {
  it("uses only additive statements from the reviewed schema", () => {
    const text = migrationStatements.join("\n");
    expect(text).toContain(`"resultProvenance" TEXT NOT NULL DEFAULT ''`);
    expect(text).toContain(`"manuallyCorrected" BOOLEAN NOT NULL DEFAULT false`);
    expect(text).toContain(`"resultVersion" INTEGER NOT NULL DEFAULT 0`);
    expect(text).toContain(`"firstSeenAt" DATETIME`);
    expect(text).toContain(`"lastSeenAt" DATETIME`);
    expect(text).toContain(`CONSTRAINT "ResultAudit_matchId_fkey"`);
    expect(text).toContain("ON DELETE CASCADE ON UPDATE CASCADE");
    expect(migrationStatements.map((statement) => statement.trimStart().split(/\s+/, 2).join(" "))).toEqual([
      `ALTER TABLE`,
      `ALTER TABLE`,
      `ALTER TABLE`,
      `ALTER TABLE`,
      `ALTER TABLE`,
      `CREATE TABLE`,
      `CREATE INDEX`,
    ]);
    expect(text).not.toMatch(/\b(DROP|INSERT|REPLACE)\b|writable_schema|sqlite_schema|IF NOT EXISTS|accept-data-loss/i);
  });

  it("refuses a relative path without creating a database", () => {
    expect(() => applyResultVerificationSchema("dev.db")).toThrow(/absolute filesystem path/);
    expect(existsSync(path.resolve("dev.db"))).toBe(false);
    expect(() => applyResultVerificationSchema("file:/tmp/udaff-not-created.db")).toThrow(/not a file: URL/);
  });

  it("refuses a missing database without creating it", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-schema-missing-"));
    const missing = path.join(directory, "missing.db");
    try {
      expect(() => applyResultVerificationSchema(missing)).toThrow(/does not exist/);
      expect(existsSync(missing)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses an empty database without writing a SQLite header", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-schema-empty-"));
    const file = path.join(directory, "empty.db");
    writeFileSync(file, Buffer.alloc(0));
    try {
      expect(() => applyResultVerificationSchema(file)).toThrow(/empty/);
      expect(readFileSync(file).byteLength).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses an unexpected database without changing it", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-schema-other-"));
    const file = path.join(directory, "other.db");
    const created = new DatabaseSync(file);
    created.exec(`CREATE TABLE "Other" ("id" TEXT NOT NULL PRIMARY KEY)`);
    created.close();
    const before = readFileSync(file);
    try {
      expect(() => applyResultVerificationSchema(file)).toThrow(/not the reviewed starting state/);
      expect(readFileSync(file).equals(before)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

const backupPath = process.env.RESULT_SCHEMA_BACKUP;

describe.skipIf(!backupPath)("result verification schema migration on a backup copy", () => {
  const source = backupPath ?? "";
  const directories: string[] = [];

  afterAll(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  });

  function disposableCopy(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-schema-copy-"));
    directories.push(directory);
    const copy = path.join(directory, "copy.db");
    copyFileSync(source, copy);
    return copy;
  }

  it("applies once, reports a second run, and leaves original business values unchanged", () => {
    const sourceStat = statSync(source);
    const copy = disposableCopy();
    const beforeRows = businessSnapshot(copy);
    const beforeForeignKeys = foreignKeyViolations(copy);
    expect(integrity(copy)).toBe("ok");

    expect(applyResultVerificationSchema(copy)).toEqual({ status: "applied" });
    expect(applyResultVerificationSchema(copy)).toEqual({ status: "already-applied" });

    expect(businessSnapshot(copy)).toEqual(beforeRows);
    expect(foreignKeyViolations(copy)).toEqual(beforeForeignKeys);
    expect(integrity(copy)).toBe("ok");
    expect(neutralDefaults(copy)).toEqual({
      provenance: 0,
      corrected: 0,
      version: 0,
      observationTimes: 0,
      audits: 0,
    });
    expect(statSync(source).mtimeMs).toBe(sourceStat.mtimeMs);
    expect(statSync(source).size).toBe(sourceStat.size);
    expect(prismaDiff(copy)).toMatch(/empty migration/);
    expect(prismaDiff(copy)).not.toMatch(/DROP TABLE|new_Match|RedefineTables/);
  }, 30_000);

  it("lets Prisma read the migrated copy", async () => {
    const copy = disposableCopy();
    applyResultVerificationSchema(copy);
    const db = new PrismaClient({ datasources: { db: { url: `file:${copy}` } } });
    try {
      const matches = await db.match.count();
      const sample = await db.match.findFirst({
        orderBy: { id: "asc" },
        select: { resultProvenance: true, manuallyCorrected: true, resultVersion: true, resultState: true },
      });
      const observation = await db.resultObservation.findFirst({
        orderBy: { id: "asc" },
        select: { firstSeenAt: true, lastSeenAt: true },
      });
      expect(matches).toBe(120);
      expect(sample).toMatchObject({
        resultProvenance: "",
        manuallyCorrected: false,
        resultVersion: 0,
        resultState: "verified",
      });
      expect(observation?.firstSeenAt).toBeNull();
      expect(observation?.lastSeenAt).toBeNull();
      expect(await db.resultAudit.count()).toBe(0);
      expect(await db.round.count()).toBe(15);
      expect(await db.standingsCheckpoint.count()).toBe(2);
    } finally {
      await db.$disconnect();
    }
  }, 30_000);

  it("refuses a partial schema without finishing it", () => {
    const copy = disposableCopy();
    const db = new DatabaseSync(copy);
    db.exec(`ALTER TABLE "Match" ADD COLUMN "resultProvenance" TEXT NOT NULL DEFAULT ''`);
    db.close();
    const before = readFileSync(copy);
    expect(() => applyResultVerificationSchema(copy)).toThrow(/not the reviewed starting state/);
    expect(readFileSync(copy).equals(before)).toBe(true);
    const names = columnNames(copy, "Match");
    expect(names).toContain("resultProvenance");
    expect(names).not.toContain("manuallyCorrected");
    expect(names).not.toContain("resultVersion");
  }, 30_000);

  it("refuses an incompatible ResultAudit definition", () => {
    const copy = disposableCopy();
    const db = new DatabaseSync(copy);
    db.exec(`CREATE TABLE "ResultAudit" ("id" TEXT NOT NULL PRIMARY KEY)`);
    db.close();
    const before = readFileSync(copy);
    expect(() => applyResultVerificationSchema(copy)).toThrow(/not the reviewed starting state/);
    expect(readFileSync(copy).equals(before)).toBe(true);
    const definition = schemaSql(copy, "ResultAudit");
    expect(definition).toBe(`CREATE TABLE "ResultAudit" ("id" TEXT NOT NULL PRIMARY KEY)`);
  }, 30_000);

  it("rolls back an induced failure and can then apply cleanly", () => {
    const copy = disposableCopy();
    const beforeRows = businessSnapshot(copy);
    const beforeSchema = schemaSql(copy, "Match");
    expect(() => applyResultVerificationSchema(copy, { failAfterStatements: 1 })).toThrow(/rolled back/);
    expect(schemaSql(copy, "Match")).toBe(beforeSchema);
    expect(columnNames(copy, "Match")).not.toContain("resultProvenance");
    expect(businessSnapshot(copy)).toEqual(beforeRows);
    expect(applyResultVerificationSchema(copy)).toEqual({ status: "applied" });
    expect(applyResultVerificationSchema(copy)).toEqual({ status: "already-applied" });
    expect(businessSnapshot(copy)).toEqual(beforeRows);
  }, 30_000);
});

function businessSnapshot(file: string): Record<string, string> {
  return withRead(file, (db) => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const snapshot: Record<string, string> = {};
    for (const table of tables) {
      if (table.name === "ResultAudit") continue;
      const columns = (db.prepare(`PRAGMA table_info("${table.name}")`).all() as Array<{ name: string }>)
        .map((column) => column.name)
        .filter((name) => !addedColumns.has(name));
      const quoted = columns.map((column) => `"${column}"`).join(", ");
      const order = columns.includes("id") ? `"id"` : quoted;
      const rows = db.prepare(`SELECT ${quoted} FROM "${table.name}" ORDER BY ${order}`).all();
      const hash = createHash("sha256");
      hash.update(JSON.stringify(columns));
      hash.update("\n");
      for (const row of rows) {
        hash.update(JSON.stringify(row));
        hash.update("\n");
      }
      snapshot[table.name] = `${rows.length}:${hash.digest("hex")}`;
    }
    return snapshot;
  });
}

function foreignKeyViolations(file: string): unknown[] {
  return withRead(file, (db) => db.prepare("PRAGMA foreign_key_check").all());
}

function integrity(file: string): string {
  return withRead(file, (db) => {
    const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    return row.integrity_check;
  });
}

function neutralDefaults(file: string): {
  provenance: number;
  corrected: number;
  version: number;
  observationTimes: number;
  audits: number;
} {
  return withRead(file, (db) => ({
    provenance: count(db, `SELECT COUNT(*) AS n FROM "Match" WHERE "resultProvenance" != ''`),
    corrected: count(db, `SELECT COUNT(*) AS n FROM "Match" WHERE "manuallyCorrected" != 0`),
    version: count(db, `SELECT COUNT(*) AS n FROM "Match" WHERE "resultVersion" != 0`),
    observationTimes: count(
      db,
      `SELECT COUNT(*) AS n FROM "ResultObservation" WHERE "firstSeenAt" IS NOT NULL OR "lastSeenAt" IS NOT NULL`,
    ),
    audits: count(db, `SELECT COUNT(*) AS n FROM "ResultAudit"`),
  }));
}

function columnNames(file: string, table: string): string[] {
  return withRead(file, (db) =>
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

function schemaSql(file: string, name: string): string | null {
  return withRead(file, (db) => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string | null } | undefined;
    return row?.sql ?? null;
  });
}

function prismaDiff(file: string): string {
  return execFileSync(
    path.resolve("node_modules/.bin/prisma"),
    ["migrate", "diff", "--from-url", `file:${file}`, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { n: number };
  return row.n;
}

function withRead<T>(file: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5_000 });
  try {
    return read(db);
  } finally {
    db.close();
  }
}
