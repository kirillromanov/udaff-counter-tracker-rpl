import { AUTO_RETRY_MINUTES } from "@/lib/domain/results/poll";

const MIN_IDLE_MS = 1000;

/**
 * How long the supervised loop waits before looking again.
 * An error waits at least the existing five-minute retry gap.
 * The scan cap is the operator's WORKER_SCAN_MINUTES, not a new result interval.
 */
export function workerSleepMs(input: {
  now: Date;
  scanMinutes: number;
  nextDueAt: Date | null;
  hadError: boolean;
}): number {
  const scanMs = input.scanMinutes * 60_000;
  const retryMs = AUTO_RETRY_MINUTES * 60_000;
  const delta = input.nextDueAt ? input.nextDueAt.getTime() - input.now.getTime() : null;
  if (input.hadError) {
    return Math.min(scanMs, Math.max(retryMs, delta ?? 0));
  }
  if (delta == null) {
    return scanMs;
  }
  if (delta <= 0) {
    return Math.min(scanMs, retryMs);
  }
  return Math.min(scanMs, Math.max(MIN_IDLE_MS, delta));
}
