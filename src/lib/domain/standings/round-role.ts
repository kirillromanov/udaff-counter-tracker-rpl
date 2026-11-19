/** Rounds covered by the trusted baseline. Kept for diagnostics and excluded from production standings. */
export const ARCHIVED_ROUND = "archived";

/** Rounds after the trusted baseline. Their finalized points are added to that baseline. */
export const OPERATIONAL_ROUND = "operational";

export type StandingRole = typeof ARCHIVED_ROUND | typeof OPERATIONAL_ROUND;

export function standingRoleForRound(roundNumber: number, baselineAfterRound: number | null): StandingRole {
  if (baselineAfterRound != null && roundNumber <= baselineAfterRound) {
    return ARCHIVED_ROUND;
  }
  return OPERATIONAL_ROUND;
}

/**
 * A round enters production standings only when it is operational, activated, and later than the trusted baseline.
 * An archived round stays out even if its number is past the baseline.
 * An operational round at or before the baseline stays out so those points are not added twice.
 * A preparation round (productionStartedAt null) stays out. Omitted means already activated, which matches rounds
 * backfilled at migration. Closed is not an argument: a closed activated round still counts.
 */
const ASSUME_STARTED = new Date(0);

export function countsTowardProduction(
  role: string,
  roundNumber: number,
  baselineAfterRound: number | null,
  productionStartedAt: Date | null | undefined = ASSUME_STARTED,
): boolean {
  if (role !== OPERATIONAL_ROUND) {
    return false;
  }
  if (productionStartedAt === null) {
    return false;
  }
  if (baselineAfterRound == null) {
    return true;
  }
  return roundNumber > baselineAfterRound;
}

export function standingRoleLabel(role: string): "Archived reference" | "Production" {
  return role === ARCHIVED_ROUND ? "Archived reference" : "Production";
}
