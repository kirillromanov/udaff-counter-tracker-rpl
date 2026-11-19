import { nextScheduledAt, planWorker, type PlanLine, type WorkerRound } from "./plan";
import { readWorkerConfig, type WorkerConfig, type WorkerMode } from "./config";
import { workerSleepMs } from "./sleep";

export interface JobResult {
  failed: boolean;
  busy: boolean;
  closed: boolean;
  nextAt: string | null;
}

export interface CycleCounts {
  processed: number;
  skipped: number;
  errors: number;
  lines: PlanLine[];
  refusal: WorkerConfig["refusal"];
  duplicate: boolean;
  nextDueAt: string | null;
}

export interface CycleDeps {
  now: () => Date;
  loadRounds: () => Promise<readonly WorkerRound[]>;
  refresh: (roundId: string, now: Date) => Promise<JobResult>;
  poll: (roundId: string, now: Date) => Promise<JobResult>;
  acquireInstance: () => Promise<(() => Promise<void>) | null>;
}

export async function runWorkerCycle(config: WorkerConfig, deps: CycleDeps, signal?: AbortSignal): Promise<CycleCounts> {
  if (config.mode !== "plan" && config.refusal) {
    return emptyCounts(config.refusal);
  }
  if (config.mode === "plan") {
    const lines = planWorker(await deps.loadRounds(), deps.now(), undefined, { resultsEnabled: config.resultsEnabled });
    return { ...emptyCounts(null), lines, skipped: lines.length, nextDueAt: stamp(nextScheduledAt(lines, deps.now())) };
  }
  const release = await deps.acquireInstance();
  if (!release) {
    return { ...emptyCounts(null), duplicate: true };
  }
  try {
    const now = deps.now();
    const lines = planWorker(await deps.loadRounds(), now, undefined, { resultsEnabled: config.resultsEnabled });
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    for (const item of lines) {
      if (signal?.aborted) {
        break;
      }
      if (item.disposition !== "run") {
        skipped += 1;
        continue;
      }
      if (item.job === "prediction-refresh" && config.predictionIntervalMinutes == null) {
        skipped += 1;
        item.disposition = "skip";
        item.reason = "prediction-interval-unset";
        continue;
      }
      const result = item.job === "prediction-refresh" ? await deps.refresh(item.roundId, now) : await deps.poll(item.roundId, now);
      if (result.nextAt) {
        item.nextAt = result.nextAt;
      }
      if (result.closed || result.busy) {
        skipped += 1;
        item.disposition = "skip";
        item.reason = result.closed ? "closed" : "busy";
        continue;
      }
      if (result.failed) {
        errors += 1;
        item.reason = "error";
        continue;
      }
      processed += 1;
    }
    return {
      processed,
      skipped,
      errors,
      lines,
      refusal: null,
      duplicate: false,
      nextDueAt: stamp(nextScheduledAt(lines, now)),
    };
  } finally {
    await release();
  }
}

export async function runWorkerLoop(
  config: WorkerConfig,
  deps: CycleDeps,
  options: { signal: AbortSignal; sleep: (ms: number, signal: AbortSignal) => Promise<void> },
): Promise<CycleCounts[]> {
  const reports: CycleCounts[] = [];
  if (config.mode === "plan" || config.refusal) {
    reports.push(await runWorkerCycle(config, deps, options.signal));
    return reports;
  }
  while (!options.signal.aborted) {
    const report = await runWorkerCycle(config, deps, options.signal);
    reports.push(report);
    if (report.duplicate || config.mode === "once") {
      break;
    }
    const now = deps.now();
    const wait = workerSleepMs({
      now,
      nextDueAt: report.nextDueAt ? new Date(report.nextDueAt) : null,
      idleMinutes: config.predictionIntervalMinutes,
      scanMinutes: config.scanMinutes,
    });
    if (wait == null) {
      break;
    }
    await options.sleep(wait, options.signal);
  }
  return reports;
}

export function configForMode(env: Record<string, string | undefined>, mode: WorkerMode): WorkerConfig {
  return readWorkerConfig(env, mode);
}

function emptyCounts(refusal: WorkerConfig["refusal"]): CycleCounts {
  return { processed: 0, skipped: 0, errors: 0, lines: [], refusal, duplicate: false, nextDueAt: null };
}

function stamp(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
