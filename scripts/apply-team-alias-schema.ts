import { applyTeamAliasSchema } from "../src/lib/db/team-alias-migration";

/**
 * Apply the reviewed additive team-spelling tables.
 * This process does not read DATABASE_URL or .env.
 *
 *   npx tsx scripts/apply-team-alias-schema.ts --database /absolute/path/dev.db
 */
function databaseArgument(argv: string[]): string {
  const index = argv.indexOf("--database");
  const value = index === -1 ? undefined : argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error("Pass --database with an absolute path to the existing SQLite file.");
  }
  return value;
}

try {
  const result = applyTeamAliasSchema(databaseArgument(process.argv.slice(2)));
  console.log(result.status === "already-applied" ? "already applied" : "applied");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
