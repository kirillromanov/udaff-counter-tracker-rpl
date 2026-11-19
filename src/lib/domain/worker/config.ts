import { AUTO_RETRY_MINUTES } from "@/lib/domain/results/poll";

/** Proposed wake cap. It is not applied unless the operator sets WORKER_SCAN_MINUTES. */
export const PROPOSED_SCAN_MINUTES = 60;
export const MIN_SCAN_MINUTES = AUTO_RETRY_MINUTES;
export const MAX_SCAN_MINUTES = 24 * 60;

export type WorkerMode = "plan" | "once" | "supervise";

export interface WorkerConfig {
  mode: WorkerMode;
  enabled: boolean;
  scanMinutes: number | null;
  refusal: "disabled" | "scan-unset" | "scan-invalid" | null;
}

export function readWorkerConfig(env: Record<string, string | undefined>, mode: WorkerMode): WorkerConfig {
  const enabled = env.WORKER_ENABLED === "1";
  const scanMinutes = parseScanMinutes(env.WORKER_SCAN_MINUTES);
  let refusal: WorkerConfig["refusal"] = null;
  if (mode !== "plan" && !enabled) {
    refusal = "disabled";
  } else if (mode === "supervise" && enabled && (env.WORKER_SCAN_MINUTES == null || env.WORKER_SCAN_MINUTES.trim() === "")) {
    refusal = "scan-unset";
  } else if (mode === "supervise" && enabled && scanMinutes == null) {
    refusal = "scan-invalid";
  }
  return { mode, enabled, scanMinutes, refusal };
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

export function workerModeFromArgv(argv: readonly string[]): WorkerMode {
  if (argv.includes("--plan")) {
    return "plan";
  }
  if (argv.includes("--once")) {
    return "once";
  }
  return "supervise";
}
