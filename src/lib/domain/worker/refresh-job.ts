import { notePredictionRefreshFailure, refreshRoundPredictions } from "@/lib/domain/import/refresh-predictions";
import { RoundClosedError } from "@/lib/domain/rounds/round-lock";

export interface WorkerRefreshResult {
  failed: boolean;
  busy: boolean;
  closed: boolean;
}

/** One prediction refresh. A closed round or a held claim does not fetch again. */
export async function refreshPredictionForWorker(roundId: string, now: Date, claimDir: string): Promise<WorkerRefreshResult> {
  try {
    const report = await refreshRoundPredictions(roundId, { now, claimDir });
    return { failed: report.failed, busy: report.busy, closed: false };
  } catch (error) {
    if (error instanceof RoundClosedError) {
      return { failed: false, busy: false, closed: true };
    }
    const message = error instanceof Error ? error.message : "Prediction refresh failed";
    await notePredictionRefreshFailure(roundId, now, message);
    return { failed: true, busy: false, closed: false };
  }
}
