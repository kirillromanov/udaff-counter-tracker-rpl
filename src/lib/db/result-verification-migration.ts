import { statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import catalog from "./result-verification-schema-catalog.json";

/**
 * Additive result-verification schema change.
 *
 * Prisma's SQLite diff adds the nullable observation columns with ALTER TABLE,
 * but it rebuilds Match to place the three new NOT NULL columns before
 * resultNote. SQLite 3.51 accepts those columns as ordinary ADD COLUMN
 * statements at the end of the table. After that, the same Prisma diff is empty.
 * This script applies only the additive statements and never runs the rebuild.
 *
 * The catalogs are sqlite_master text from the reviewed pre-change database and
 * from that database after these statements. They contain no row data.
 */

export const migrationStatements = [
  `ALTER TABLE "Match" ADD COLUMN "resultProvenance" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "Match" ADD COLUMN "manuallyCorrected" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Match" ADD COLUMN "resultVersion" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "ResultObservation" ADD COLUMN "firstSeenAt" DATETIME`,
  `ALTER TABLE "ResultObservation" ADD COLUMN "lastSeenAt" DATETIME`,
  `CREATE TABLE "ResultAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "previousHome" INTEGER,
    "previousAway" INTEGER,
    "previousState" TEXT NOT NULL,
    "previousResolution" TEXT NOT NULL,
    "previousMarker" BOOLEAN NOT NULL,
    "nextHome" INTEGER,
    "nextAway" INTEGER,
    "nextState" TEXT NOT NULL,
    "nextResolution" TEXT NOT NULL,
    "nextMarker" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResultAudit_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
  `CREATE INDEX "ResultAudit_matchId_idx" ON "ResultAudit"("matchId")`,
] as const;

type CatalogEntry = {
  type: string;
  name: string;
  table: string;
  sql: string | null;
};

const startCatalog = catalog.start as CatalogEntry[];
const targetCatalog = catalog.target as CatalogEntry[];

export class ResultSchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultSchemaMigrationError";
  }
}

export type ResultSchemaMigrationResult = {
  status: "applied" | "already-applied";
};

export type ResultSchemaMigrationOptions = {
  /** Test hook. Rolls the transaction back after this many statements. */
  failAfterStatements?: number;
};

export function applyResultVerificationSchema(
  databasePath: string,
  options: ResultSchemaMigrationOptions = {},
): ResultSchemaMigrationResult {
  const file = requireExistingDatabase(databasePath);
  const current = withDatabase(file, true, readCatalog);
  if (sameCatalog(current, targetCatalog)) {
    return { status: "already-applied" };
  }
  if (!sameCatalog(current, startCatalog)) {
    throw new ResultSchemaMigrationError(
      `Database schema is not the reviewed starting state and is not the reviewed target state. Compared with the start: ${describeCatalogDifference(current, startCatalog)}. Compared with the target: ${describeCatalogDifference(current, targetCatalog)}. Nothing was written.`,
    );
  }
  withDatabase(file, false, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      migrationStatements.forEach((statement, index) => {
        db.exec(statement);
        if (options.failAfterStatements === index + 1) {
          throw new ResultSchemaMigrationError(
            `Induced migration failure after ${index + 1} statement(s). The transaction was rolled back.`,
          );
        }
      });
      const produced = readCatalog(db);
      if (!sameCatalog(produced, targetCatalog)) {
        throw new ResultSchemaMigrationError(
          `Migration statements did not produce the reviewed target schema. Compared with the target: ${describeCatalogDifference(produced, targetCatalog)}. The transaction was rolled back.`,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
  const committed = withDatabase(file, true, readCatalog);
  if (!sameCatalog(committed, targetCatalog)) {
    throw new ResultSchemaMigrationError(
      "The migration transaction committed, but the schema does not match the reviewed target. It was not recorded in a migration history.",
    );
  }
  return { status: "applied" };
}

function requireExistingDatabase(databasePath: string): string {
  if (databasePath.startsWith("file:")) {
    throw new ResultSchemaMigrationError("Database path must be a filesystem path, not a file: URL.");
  }
  if (!path.isAbsolute(databasePath)) {
    throw new ResultSchemaMigrationError(
      "Database path must be an absolute filesystem path. A relative path is refused because Prisma Client and the Prisma CLI resolve file: URLs from different directories.",
    );
  }
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(databasePath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new ResultSchemaMigrationError(`Database file does not exist: ${databasePath}. Refusing to create it.`);
    }
    throw error;
  }
  if (!info.isFile()) {
    throw new ResultSchemaMigrationError(`Database path is not a regular file: ${databasePath}.`);
  }
  if (info.size === 0) {
    throw new ResultSchemaMigrationError(`Database file is empty: ${databasePath}. Refusing to open it.`);
  }
  return databasePath;
}

function withDatabase<T>(file: string, readOnly: boolean, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, {
    readOnly,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function readCatalog(db: DatabaseSync): CatalogEntry[] {
  const rows = db
    .prepare("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master ORDER BY type, name")
    .all() as Array<{ type: string; name: string; tableName: string; sql: string | null }>;
  return rows.map((row) => ({
    type: row.type,
    name: row.name,
    table: row.tableName,
    sql: row.sql,
  }));
}

function sameCatalog(left: CatalogEntry[], right: CatalogEntry[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function describeCatalogDifference(current: CatalogEntry[], expected: CatalogEntry[]): string {
  const key = (entry: CatalogEntry) => `${entry.type}:${entry.name}`;
  const currentEntries = new Map(current.map((entry) => [key(entry), entry]));
  const expectedEntries = new Map(expected.map((entry) => [key(entry), entry]));
  const missing = [...expectedEntries.keys()].filter((name) => !currentEntries.has(name));
  const extra = [...currentEntries.keys()].filter((name) => !expectedEntries.has(name));
  const changed = [...expectedEntries.keys()].filter((name) => {
    const actual = currentEntries.get(name);
    const wanted = expectedEntries.get(name);
    return actual && wanted && (actual.sql !== wanted.sql || actual.table !== wanted.table);
  });
  return `missing ${listNames(missing)}; extra ${listNames(extra)}; changed ${listNames(changed)}`;
}

function listNames(names: string[]): string {
  if (names.length === 0) return "none";
  const shown = names.slice(0, 12).join(", ");
  return names.length > 12 ? `${shown}, and ${names.length - 12} more` : shown;
}
