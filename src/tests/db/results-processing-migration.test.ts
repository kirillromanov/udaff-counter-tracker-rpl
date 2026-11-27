import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyResultsProcessingSchema, migrationStatements } from "@/lib/db/results-processing-migration";

describe("results processing schema migration", () => {
  it("is one additive column with a false default", () => {
    expect(migrationStatements).toEqual([
      `ALTER TABLE "Round" ADD COLUMN "resultsProcessing" BOOLEAN NOT NULL DEFAULT false`,
    ]);
    const text = migrationStatements.join("\n");
    expect(text).not.toMatch(/\b(DROP|INSERT|REPLACE|UPDATE)\b|writable_schema|sqlite_schema|IF NOT EXISTS|accept-data-loss/i);
  });

  it("refuses a relative path without creating a database", () => {
    expect(() => applyResultsProcessingSchema("dev.db")).toThrow(/absolute filesystem path/);
    expect(existsSync(path.resolve("dev.db"))).toBe(false);
    expect(() => applyResultsProcessingSchema("file:/tmp/udaff-not-created.db")).toThrow(/not a file: URL/);
  });

  it("refuses a missing database without creating it", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-switch-missing-"));
    const missing = path.join(directory, "missing.db");
    try {
      expect(() => applyResultsProcessingSchema(missing)).toThrow(/does not exist/);
      expect(existsSync(missing)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses an empty database without writing a SQLite header", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-switch-empty-"));
    const file = path.join(directory, "empty.db");
    writeFileSync(file, Buffer.alloc(0));
    try {
      expect(() => applyResultsProcessingSchema(file)).toThrow(/empty/);
      expect(readFileSync(file).byteLength).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses an unexpected database without changing it", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-switch-other-"));
    const file = path.join(directory, "other.db");
    const created = new DatabaseSync(file);
    created.exec(`CREATE TABLE "Other" ("id" TEXT NOT NULL PRIMARY KEY)`);
    created.close();
    const before = readFileSync(file);
    try {
      expect(() => applyResultsProcessingSchema(file)).toThrow(/not the reviewed starting state/);
      expect(readFileSync(file).equals(before)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
