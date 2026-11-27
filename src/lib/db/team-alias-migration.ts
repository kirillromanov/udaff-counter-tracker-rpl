import { statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import catalog from "./team-alias-schema-catalog.json";

/**
 * Additive team-spelling tables.
 *
 * Prisma's schema adds TeamName and TeamNameAlias. Those are new tables, so
 * this script creates them and does not rebuild Match or update existing rows.
 * The catalogs are sqlite_master text from the reviewed database before and
 * after these statements. They contain no row data.
 */

export const migrationStatements = [
  `CREATE TABLE "TeamName" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE "TeamNameAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamNameId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamNameAlias_teamNameId_fkey" FOREIGN KEY ("teamNameId") REFERENCES "TeamName" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
  `CREATE UNIQUE INDEX "TeamName_normalizedName_key" ON "TeamName"("normalizedName")`,
  `CREATE UNIQUE INDEX "TeamNameAlias_normalized_key" ON "TeamNameAlias"("normalized")`,
  `CREATE INDEX "TeamNameAlias_teamNameId_idx" ON "TeamNameAlias"("teamNameId")`,
  `CREATE UNIQUE INDEX "TeamNameAlias_teamNameId_slot_key" ON "TeamNameAlias"("teamNameId", "slot")`,
] as const;

type CatalogEntry = {
  type: string;
  name: string;
  table: string;
  sql: string | null;
};

const startCatalog = catalog.start as CatalogEntry[];
const targetCatalog = catalog.target as CatalogEntry[];

export class TeamAliasSchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamAliasSchemaMigrationError";
  }
}

export type TeamAliasSchemaMigrationResult = {
  status: "applied" | "already-applied";
};

export function applyTeamAliasSchema(databasePath: string): TeamAliasSchemaMigrationResult {
  const file = requireExistingDatabase(databasePath);
  const current = withDatabase(file, true, readCatalog);
  if (sameCatalog(current, targetCatalog)) {
    return { status: "already-applied" };
  }
  if (!sameCatalog(current, startCatalog)) {
    throw new TeamAliasSchemaMigrationError(
      `Database schema is not the reviewed starting state and is not the reviewed target state. Compared with the start: ${describeCatalogDifference(current, startCatalog)}. Compared with the target: ${describeCatalogDifference(current, targetCatalog)}. Nothing was written.`,
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
        throw new TeamAliasSchemaMigrationError(
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
    throw new TeamAliasSchemaMigrationError(
      "The migration transaction committed, but the schema does not match the reviewed target.",
    );
  }
  return { status: "applied" };
}

function requireExistingDatabase(databasePath: string): string {
  if (databasePath.startsWith("file:")) {
    throw new TeamAliasSchemaMigrationError("Database path must be a filesystem path, not a file: URL.");
  }
  if (!path.isAbsolute(databasePath)) {
    throw new TeamAliasSchemaMigrationError(
      "Database path must be an absolute filesystem path. A relative path is refused because Prisma Client and the Prisma CLI resolve file: URLs from different directories.",
    );
  }
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(databasePath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new TeamAliasSchemaMigrationError(`Database file does not exist: ${databasePath}. Refusing to create it.`);
    }
    throw error;
  }
  if (!info.isFile()) {
    throw new TeamAliasSchemaMigrationError(`Database path is not a regular file: ${databasePath}.`);
  }
  if (info.size === 0) {
    throw new TeamAliasSchemaMigrationError(`Database file is empty: ${databasePath}. Refusing to open it.`);
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
