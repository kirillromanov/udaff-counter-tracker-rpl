import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { acquireClaim, workerLockDirectory } from "@/lib/domain/worker/claims";
import { workerModeFromArgv } from "@/lib/domain/worker/config";
import { configForMode, runWorkerCycle, runWorkerLoop, type CycleCounts } from "@/lib/domain/worker/cycle";
import { loadWorkerRounds } from "@/lib/domain/worker/load";
import { formatWorkerLine } from "@/lib/domain/worker/log";
import { pollResultForWorker, refreshPredictionForWorker } from "@/lib/domain/worker/refresh-job";

try {
  loadEnvFile();
} catch {
  // The web server loads .env. This script also runs when that file is absent.
}

function printReport(report: CycleCounts): void {
  if (report.refusal) {
    console.log(formatWorkerLine("refused", { reason: report.refusal }));
    return;
  }
  if (report.duplicate) {
    console.log(formatWorkerLine("stop", { reason: "duplicate-worker" }));
    return;
  }
  console.log(
    formatWorkerLine("cycle", {
      processed: report.processed,
      skipped: report.skipped,
      errors: report.errors,
      nextDueAt: report.nextDueAt,
    }),
  );
  for (const line of report.lines) {
    console.log(
      formatWorkerLine(line.disposition, {
        round: line.number,
        job: line.job,
        eligible: line.eligible,
        reason: line.reason,
        nextAt: line.nextAt,
      }),
    );
  }
}

async function main(): Promise<number> {
  const mode = workerModeFromArgv(process.argv.slice(2));
  const config = configForMode(process.env, mode);
  const claimDir = workerLockDirectory();
  if (mode !== "plan" && !config.refusal) {
    process.env.WORKER_LOCK_DIR = claimDir;
  }
  console.log(
    formatWorkerLine("start", {
      mode,
      enabled: config.enabled,
      results: config.resultsEnabled,
      predictionIntervalMinutes: config.predictionIntervalMinutes,
    }),
  );
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
    const reports = await runWorkerLoop(config, deps, {
      signal: controller.signal,
      sleep: (ms, signal) => new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      }),
    });
    for (const report of reports) {
      printReport(report);
    }
    const last = reports.at(-1);
    const reason = controller.signal.aborted ? "signal" : last?.duplicate ? "duplicate-worker" : "complete";
    console.log(formatWorkerLine("stop", { reason }));
    return 0;
  }
  const report = await runWorkerCycle(config, deps);
  printReport(report);
  console.log(formatWorkerLine("stop", { reason: report.refusal ?? (report.duplicate ? "duplicate-worker" : "complete") }));
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error(formatWorkerLine("stop", { reason: "failed" }));
    console.error(error instanceof Error ? error.name : "Error");
    await prisma.$disconnect();
    process.exit(1);
  });
