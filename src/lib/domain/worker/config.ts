import { predictionIntervalMinutes } from "@/lib/domain/import/prediction-schedule";
import { AUTO_RETRY_MINUTES } from "@/lib/domain/results/poll";

/** Historical proposal. The supervise loop does not read it; sleep.ts caps the wait at 60 seconds. */
export const PROPOSED_SCAN_MINUTES = 60;
export const MIN_SCAN_MINUTES = AUTO_RETRY_MINUTES;
export const MAX_SCAN_MINUTES = 24 * 60;

export type WorkerMode = "plan" | "once" | "supervise";

export interface WorkerConfig {
  mode: WorkerMode;
  enabled: boolean;
  /** Optional ceiling on how long to sleep before looking for a newly started round. Not a task due time. */
  scanMinutes: number | null;
  predictionIntervalMinutes: number | null;
  /** Requires WORKER_ENABLED=1 as well. Default off. */
  resultsEnabled: boolean;
  refusal: "disabled" | null;
}

export function readWorkerConfig(env: Record<string, string | undefined>, mode: WorkerMode): WorkerConfig {
  const enabled = env.WORKER_ENABLED === "1";
  const scanMinutes = parseScanMinutes(env.WORKER_SCAN_MINUTES);
  const interval = predictionIntervalMinutes(env);
  let refusal: WorkerConfig["refusal"] = null;
  if (mode !== "plan" && !enabled) {
    refusal = "disabled";
  }
  return {
    mode,
    enabled,
    scanMinutes,
    predictionIntervalMinutes: interval,
    resultsEnabled: enabled && env.WORKER_RESULTS_ENABLED === "1",
    refusal,
  };
}

export function parseScanMinutes(value: string | undefined): number | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  if (!/^\d+$/u.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  if (parsed < MIN_SCAN_MINUTES || parsed > MAX_SCAN_MINUTES) {
    return null;
  }
  return parsed;
}

/** Enabled supervision without the prediction interval cannot schedule fetches. */
export function workerStartupFailure(config: WorkerConfig): "prediction-interval-unset" | null {
  if (config.mode === "supervise" && config.enabled && config.predictionIntervalMinutes == null) {
    return "prediction-interval-unset";
  }
  return null;
}

export function workerModeFromArgv(argv: readonly string[]): WorkerMode {
  if (argv.includes("--plan")) {
    return "plan";
  }
  if (argv.includes("--once")) {
    return "once";
  }
  return "supervise";
}
