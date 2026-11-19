/** Safety floor so a configured gap cannot become a tight loop. This is not the business cadence. */
export const MIN_PREDICTION_INTERVAL_MINUTES = 5;
export const MAX_PREDICTION_INTERVAL_MINUTES = 24 * 60;

/**
 * Proposed gap after a prediction attempt. It is not applied unless
 * PREDICTION_REFRESH_INTERVAL_MINUTES is set by the operator.
 */
export const PROPOSED_PREDICTION_INTERVAL_MINUTES = 60;

export function predictionIntervalMinutes(env: Record<string, string | undefined>): number | null {
  return parseIntervalMinutes(env.PREDICTION_REFRESH_INTERVAL_MINUTES);
}

export function parseIntervalMinutes(value: string | undefined): number | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  if (!/^\d+$/u.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  if (parsed < MIN_PREDICTION_INTERVAL_MINUTES || parsed > MAX_PREDICTION_INTERVAL_MINUTES) {
    return null;
  }
  return parsed;
}

/** The next prediction fetch. Success and failure use the same explicit gap. Result attempts are not an input. */
export function nextPredictionFetchAtAfterAttempt(checkedAt: Date, intervalMinutes: number): Date {
  return new Date(checkedAt.getTime() + intervalMinutes * 60_000);
}
