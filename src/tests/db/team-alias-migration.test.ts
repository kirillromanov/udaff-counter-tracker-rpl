import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyTeamAliasSchema, migrationStatements } from "@/lib/db/team-alias-migration";

describe("team alias schema migration", () => {
  it("creates only the new spelling tables", () => {
    const text = migrationStatements.join("\n");
    expect(text).toContain('CREATE TABLE "TeamName"');
    expect(text).toContain('CREATE TABLE "TeamNameAlias"');
    expect(text).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
    expect(text).not.toMatch(/\b(DROP TABLE|ALTER TABLE|INSERT INTO|REPLACE INTO)\b|writable_schema|accept-data-loss/i);
    expect(migrationStatements.every((statement) => statement.startsWith("CREATE "))).toBe(true);
  });

  it("refuses a relative path, a file URL, and a missing file", () => {
    expect(() => applyTeamAliasSchema("dev.db")).toThrow(/absolute filesystem path/);
    expect(existsSync(path.resolve("dev.db"))).toBe(false);
    expect(() => applyTeamAliasSchema("file:/tmp/udaff-team-alias-not-created.db")).toThrow(/not a file: URL/);
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-team-alias-missing-"));
    try {
      const missing = path.join(directory, "missing.db");
      expect(() => applyTeamAliasSchema(missing)).toThrow(/does not exist/);
      expect(existsSync(missing)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses a database that is not the reviewed catalog", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-team-alias-other-"));
    const file = path.join(directory, "other.db");
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE "Note" ("id" TEXT NOT NULL PRIMARY KEY)');
    db.close();
    try {
      expect(() => applyTeamAliasSchema(file)).toThrow(/not the reviewed starting state/);
      const check = new DatabaseSync(file, { readOnly: true });
      expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'TeamName'").get()).toBeUndefined();
      check.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("team alias schema on a disposable snapshot copy", () => {
  const source = process.env.TEAM_ALIAS_SNAPSHOT;
  const enabled = source && path.isAbsolute(source);

  it.skipIf(!enabled)("applies once and leaves original tables unchanged", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-team-alias-proof-"));
    const file = path.join(directory, "copy.db");
    copyFileSync(source ?? "", file);
    try {
      expect(applyTeamAliasSchema(file).status).toBe("applied");
      expect(applyTeamAliasSchema(file).status).toBe("already-applied");
      const db = new DatabaseSync(file, { readOnly: true });
      expect(db.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM TeamName").get()).toMatchObject({ count: 0 });
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
