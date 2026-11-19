import { prisma } from "../src/lib/db/prisma";

/**
 * Existing operational rounds stay eligible for automatic checks.
 * Archived rounds stay unset. A later new round is left in preparation.
 * This does not write a start event, and it does not touch fixtures or scores.
 */
async function main(): Promise<void> {
  const updated = await prisma.$executeRaw`
    UPDATE Round
    SET productionStartedAt = createdAt
    WHERE standingRole = 'operational' AND productionStartedAt IS NULL
  `;
  console.log(`operational rounds marked already started: ${updated}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
