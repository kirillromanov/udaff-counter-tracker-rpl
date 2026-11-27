import { applyResultsProcessingSchema } from "../src/lib/db/results-processing-migration";

/**
 * Apply the reviewed per-round result switch.
 * This process does not read DATABASE_URL or .env.
 *
 *   npx tsx scripts/apply-results-processing-schema.ts --database /absolute/path/dev.db
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
  const result = applyResultsProcessingSchema(databaseArgument(process.argv.slice(2)));
  console.log(result.status === "already-applied" ? "already applied" : "applied");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
