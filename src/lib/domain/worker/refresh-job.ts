import { prisma } from "@/lib/db/prisma";
import { notePredictionRefreshFailure, refreshRoundPredictions } from "@/lib/domain/import/refresh-predictions";
import { refreshRoundResults } from "@/lib/domain/results/poll-run";
import { RoundClosedError } from "@/lib/domain/rounds/round-lock";
import type { JobResult } from "@/lib/domain/worker/cycle";

/** One prediction refresh. A closed round or a held claim does not fetch again. */
export async function refreshPredictionForWorker(roundId: string, now: Date, claimDir: string): Promise<JobResult> {
  try {
    const report = await refreshRoundPredictions(roundId, { now, claimDir });
    return { failed: report.failed, busy: report.busy, closed: false, nextAt: await predictionNext(roundId) };
  } catch (error) {
    if (error instanceof RoundClosedError) {
      return { failed: false, busy: false, closed: true, nextAt: null };
    }
    const message = error instanceof Error ? error.message : "Prediction refresh failed";
    await notePredictionRefreshFailure(roundId, now, message);
    return { failed: true, busy: false, closed: false, nextAt: await predictionNext(roundId) };
  }
}

/**
 * One result check through the existing ingestion and scoring path.
 * The worker calls this only when WORKER_RESULTS_ENABLED=1.
 */
export async function pollResultForWorker(roundId: string): Promise<JobResult> {
  try {
    const report = await refreshRoundResults(roundId, { automatic: true });
    const stored = await prisma.round.findUnique({ where: { id: roundId }, select: { nextPollAt: true } });
    return { failed: false, busy: report.busy, closed: false, nextAt: stored?.nextPollAt?.toISOString() ?? null };
  } catch (error) {
    if (error instanceof RoundClosedError) {
      return { failed: false, busy: false, closed: true, nextAt: null };
    }
    return { failed: true, busy: false, closed: false, nextAt: null };
  }
}

async function predictionNext(roundId: string): Promise<string | null> {
  const stored = await prisma.round.findUnique({ where: { id: roundId }, select: { nextPredictionFetchAt: true } });
  return stored?.nextPredictionFetchAt?.toISOString() ?? null;
}
