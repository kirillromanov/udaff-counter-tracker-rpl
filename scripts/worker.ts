import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { acquireClaim, workerLockDirectory } from "@/lib/domain/worker/claims";
import { workerModeFromArgv, workerStartupFailure } from "@/lib/domain/worker/config";
import { configForMode, runWorkerCycle, runWorkerLoop, workerReportIsQuiet, type CycleCounts } from "@/lib/domain/worker/cycle";
import { loadWorkerRounds } from "@/lib/domain/worker/load";
import { emitWorkerLine, formatWorkerLine } from "@/lib/domain/worker/log";
import { RECHECK_MS } from "@/lib/domain/worker/sleep";
import { pollResultForWorker, refreshPredictionForWorker } from "@/lib/domain/worker/refresh-job";

try {
  loadEnvFile();
} catch {
  // The web server loads .env. This script also runs when that file is absent.
}

function emit(event: string, fields: Record<string, string | number | boolean | null> = {}): void {
  emitWorkerLine(formatWorkerLine(event, fields));
}

function printReport(report: CycleCounts, mode: "plan" | "once" | "supervise", resultsEnabled: boolean): void {
  if (mode === "supervise" && workerReportIsQuiet(report)) {
    return;
  }
  if (report.refusal) {
    emit("refused", { reason: report.refusal, results: resultsEnabled });
    return;
  }
  if (report.duplicate) {
    emit("stop", { reason: "duplicate-worker" });
    return;
  }
  emit("cycle", {
    processed: report.processed,
    skipped: report.skipped,
    errors: report.errors,
    nextDueAt: report.nextDueAt,
    ...(report.overdueMs >= RECHECK_MS ? { overdueMs: report.overdueMs } : {}),
    results: resultsEnabled,
  });
  for (const line of report.lines) {
    if (mode === "supervise" && line.disposition !== "run" && line.reason !== "error") {
      continue;
    }
    emit(line.disposition, {
      round: line.number,
      job: line.job,
      eligible: line.eligible,
      reason: line.reason,
      nextAt: line.nextAt,
      ...(line.outcome ? { outcome: line.outcome } : {}),
    });
  }
}

async function main(): Promise<number> {
  const mode = workerModeFromArgv(process.argv.slice(2));
  const config = configForMode(process.env, mode);
  const claimDir = workerLockDirectory();
  if (mode !== "plan" && !config.refusal) {
    process.env.WORKER_LOCK_DIR = claimDir;
  }
  const startupFailure = workerStartupFailure(config);
  emit("start", {
    mode,
    enabled: config.enabled,
    results: config.resultsEnabled,
    predictionIntervalMinutes: config.predictionIntervalMinutes,
  });
  if (startupFailure) {
    emit("stop", { reason: startupFailure });
    return 1;
  }
  const deps = {
    now: () => new Date(),
    loadRounds: loadWorkerRounds,
    acquireInstance: () => acquireClaim(claimDir, "worker-instance"),
    refresh: (roundId: string, now: Date) => refreshPredictionForWorker(roundId, now, claimDir),
    poll: (roundId: string) => pollResultForWorker(roundId),
  };
  if (mode === "supervise" && !config.refusal) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    let duplicate = false;
    await runWorkerLoop(config, deps, {
      signal: controller.signal,
      sleep: (ms, signal) => new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      }),
      onStart: ({ due }) => emit("cycle-start", { due, results: config.resultsEnabled }),
      onReport: (report) => {
        duplicate = report.duplicate;
        printReport(report, "supervise", config.resultsEnabled);
      },
    });
    const reason = controller.signal.aborted ? "signal" : duplicate ? "duplicate-worker" : "complete";
    emit("stop", { reason });
    return 0;
  }
  const report = await runWorkerCycle(config, deps, undefined, {
    onStart: ({ due }) => emit("cycle-start", { due, results: config.resultsEnabled }),
  });
  printReport(report, mode, config.resultsEnabled);
  emit("stop", { reason: report.refusal ?? (report.duplicate ? "duplicate-worker" : "complete") });
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    emit("stop", { reason: "failed", error: error instanceof Error ? error.name : "Error" });
    await prisma.$disconnect();
    process.exit(1);
  });
