/**
 * Wait until the next persisted prediction or result time.
 * A missing time uses the explicit prediction interval or the optional scan cap.
 * Neither value rewrites a task's due time.
 */
export function workerSleepMs(input: {
  now: Date;
  nextDueAt: Date | null;
  idleMinutes: number | null;
  scanMinutes: number | null;
}): number | null {
  const cap = input.scanMinutes == null ? null : input.scanMinutes * 60_000;
  if (input.nextDueAt) {
    const delta = input.nextDueAt.getTime() - input.now.getTime();
    if (delta > 0) {
      return cap == null ? delta : Math.min(cap, delta);
    }
  }
  const idle = input.idleMinutes == null ? null : input.idleMinutes * 60_000;
  const fallback = idle ?? cap;
  return fallback;
}