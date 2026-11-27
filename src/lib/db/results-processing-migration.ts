import { statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import catalog from "./results-processing-schema-catalog.json";

/**
 * Additive per-round result switch.
 *
 * One BOOLEAN column on Round, default false. SQLite adds it with ALTER TABLE
 * and does not rebuild the table. Existing rows stay false. There is no backfill.
 *
 * The catalogs are sqlite_master text from the reviewed database and from that
 * database after the statement. They contain no row data.
 */

export const migrationStatements = [
  `ALTER TABLE "Round" ADD COLUMN "resultsProcessing" BOOLEAN NOT NULL DEFAULT false`,
] as const;

type CatalogEntry = {
  type: string;
  name: string;
  table: string;
  sql: string | null;
};

const startCatalog = catalog.start as CatalogEntry[];
const targetCatalog = catalog.target as CatalogEntry[];

export class ResultsProcessingSchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultsProcessingSchemaMigrationError";
  }
}

export type ResultsProcessingSchemaMigrationResult = {
  status: "applied" | "already-applied";
};

export function applyResultsProcessingSchema(databasePath: string): ResultsProcessingSchemaMigrationResult {
  const file = requireExistingDatabase(databasePath);
  const current = withDatabase(file, true, readCatalog);
  if (sameCatalog(current, targetCatalog)) {
    return { status: "already-applied" };
  }
  if (!sameCatalog(current, startCatalog)) {
    throw new ResultsProcessingSchemaMigrationError(
      `Database schema is not the reviewed starting state or the reviewed target. Compared with the start: ${describeCatalogDifference(current, startCatalog)}. Refusing to change it.`,
    );
  }
  withDatabase(file, false, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migrationStatements) {
        db.exec(statement);
      }
      const produced = readCatalog(db);
      if (!sameCatalog(produced, targetCatalog)) {
        throw new ResultsProcessingSchemaMigrationError(
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
    throw new ResultsProcessingSchemaMigrationError(
      "The migration transaction committed, but the schema does not match the reviewed target.",
    );
  }
  return { status: "applied" };
}

function requireExistingDatabase(databasePath: string): string {
  if (databasePath.startsWith("file:")) {
    throw new ResultsProcessingSchemaMigrationError("Database path must be a filesystem path, not a file: URL.");
  }
  if (!path.isAbsolute(databasePath)) {
    throw new ResultsProcessingSchemaMigrationError(
      "Database path must be an absolute filesystem path. A relative path is refused because Prisma Client and the Prisma CLI resolve file: URLs from different directories.",
    );
  }
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(databasePath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new ResultsProcessingSchemaMigrationError(`Database file does not exist: ${databasePath}. Refusing to create it.`);
    }
    throw error;
  }
  if (!info.isFile()) {
    throw new ResultsProcessingSchemaMigrationError(`Database path is not a regular file: ${databasePath}.`);
  }
  if (info.size === 0) {
    throw new ResultsProcessingSchemaMigrationError(`Database file is empty: ${databasePath}. Refusing to open it.`);
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
  const list = (names: string[]) => (names.length === 0 ? "none" : names.slice(0, 12).join(", "));
  return `missing ${list(missing)}; extra ${list(extra)}; changed ${list(changed)}`;
}
