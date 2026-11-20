/**
 * Local eligibility recheck. This is not the prediction-fetch interval and
 * not a result retry. A sleeping Mac can delay the timer; the cap only limits
 * how long an executing process waits before reading the clocks again.
 */
export const RECHECK_MS = 60_000;

/**
 * Wait at most one recheck before reading wall-clock time and persisted due
 * times again. A sooner due time waits only until that time. An overdue or
 * empty schedule waits one recheck, not the prediction interval.
 */
export function workerSleepMs(input: {
  now: Date;
  nextDueAt: Date | null;
  scanMinutes: number | null;
}): number {
  let cap = RECHECK_MS;
  if (input.scanMinutes != null) {
    cap = Math.min(cap, input.scanMinutes * 60_000);
  }
  if (input.nextDueAt) {
    const delta = input.nextDueAt.getTime() - input.now.getTime();
    if (delta > 0) {
      return Math.min(cap, delta);
    }
  }
  return cap;
}
