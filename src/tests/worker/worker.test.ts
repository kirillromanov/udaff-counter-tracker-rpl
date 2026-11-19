import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireClaim } from "@/lib/domain/worker/claims";
import { readWorkerConfig } from "@/lib/domain/worker/config";
import { runWorkerCycle, runWorkerLoop, type CycleDeps } from "@/lib/domain/worker/cycle";
import { planWorker, type WorkerRound } from "@/lib/domain/worker/plan";
import { workerSleepMs } from "@/lib/domain/worker/sleep";
import type { PollFixture } from "@/lib/domain/results/poll";

const now = new Date("2026-11-20T18:00:00.000Z");
const kickoff = new Date("2026-11-20T14:00:00.000Z");
const started = new Date("2026-11-01T00:00:00.000Z");
const intervals = { regularMinutes: 60, liveMinutes: 15 };

function fixture(overrides: Partial<PollFixture> = {}): PollFixture {
  return {
    kickoffAt: kickoff,
    actualHomeGoals: null,
    actualAwayGoals: null,
    resultState: "open",
    resultResolution: "",
    resultConflict: false,
    conflictAcknowledgedAt: null,
    autoCheckAttempts: 0,
    autoCheckKickoffAt: kickoff,
    autoCheckNextAt: null,
    ...overrides,
  };
}

function round(overrides: Partial<WorkerRound> = {}): WorkerRound {
  return {
    id: "round-15",
    number: 15,
    standingRole: "operational",
    forumUrl: "https://example.test/round",
    nextPollAt: null,
    nextPredictionFetchAt: null,
    closedAt: null,
    productionStartedAt: started,
    matches: [fixture()],
    ...overrides,
  };
}

function line(rounds: WorkerRound[], job: "prediction-refresh" | "result-check") {
  const found = planWorker(rounds, now, intervals).find((item) => item.roundId === rounds[0]?.id && item.job === job);
  if (!found) {
    throw new Error(`missing ${job}`);
  }
  return found;
}

describe("worker eligibility", () => {
  it("skips preparation and closed rounds and keeps an unscored production round eligible", () => {
    const preparing = round({ id: "preparing", number: 16, productionStartedAt: null });
    const closed = round({ id: "closed", number: 14, closedAt: now });
    const active = round();
    expect(line([preparing], "prediction-refresh")).toMatchObject({ eligible: false, disposition: "skip", reason: "preparation" });
    expect(line([preparing], "result-check")).toMatchObject({ eligible: false, reason: "preparation" });
    expect(line([closed], "prediction-refresh")).toMatchObject({ eligible: false, reason: "closed" });
    expect(line([closed], "result-check")).toMatchObject({ eligible: false, reason: "closed" });
    expect(line([active], "prediction-refresh")).toMatchObject({ eligible: true, disposition: "run", reason: "due" });
    expect(line([active], "result-check")).toMatchObject({ eligible: true, disposition: "skip", reason: "scoring-decision" });
  });

  it("skips archived rounds and does not treat a missing prediction as ineligible", () => {
    const archived = round({ standingRole: "archived", productionStartedAt: null });
    expect(line([archived], "prediction-refresh").reason).toBe("archived");
    expect(line([archived], "result-check").reason).toBe("archived");
    expect(line([round()], "prediction-refresh").eligible).toBe(true);
  });

  it("follows the existing kickoff, retry, and verified-result rules", () => {
    const laterKickoff = new Date("2026-11-20T20:00:00.000Z");
    const future = round({
      nextPredictionFetchAt: new Date("2026-11-20T21:00:00.000Z"),
      matches: [fixture({ kickoffAt: laterKickoff, autoCheckKickoffAt: laterKickoff })],
    });
    expect(line([future], "prediction-refresh").reason).toBe("not-due");
    expect(line([future], "result-check").reason).toBe("not-due");
    const unsetClock = round({ matches: [fixture({ kickoffAt: laterKickoff, autoCheckKickoffAt: laterKickoff })] });
    expect(line([unsetClock], "prediction-refresh")).toMatchObject({ eligible: true, reason: "due" });
    expect(line([unsetClock], "result-check").reason).toBe("not-due");
    const waiting = round({
      nextPredictionFetchAt: new Date("2026-11-20T18:30:00.000Z"),
      matches: [fixture({ autoCheckAttempts: 1, autoCheckNextAt: new Date("2026-11-20T18:30:00.000Z") })],
    });
    expect(line([waiting], "prediction-refresh").reason).toBe("not-due");
    const retryDue = round({
      nextPredictionFetchAt: new Date("2026-11-20T17:00:00.000Z"),
      matches: [fixture({ autoCheckAttempts: 1, autoCheckNextAt: new Date("2026-11-20T17:00:00.000Z") })],
    });
    expect(line([retryDue], "prediction-refresh").disposition).toBe("run");
    const exhausted = round({ matches: [fixture({ autoCheckAttempts: 10 })] });
    expect(line([exhausted], "prediction-refresh").reason).toBe("exhausted");
    expect(line([exhausted], "result-check").eligible).toBe(false);
    const verified = round({ matches: [fixture({ resultState: "verified", resultResolution: "verified", actualHomeGoals: 1, actualAwayGoals: 0 })] });
    expect(line([verified], "prediction-refresh").reason).toBe("stopped");
    expect(line([verified], "result-check").reason).toBe("stopped");
  });

  it("does not add a prediction deadline or a score requirement", () => {
    const text = readFileSync("src/lib/domain/worker/plan.ts", "utf8");
    expect(text).not.toContain("recalculateRound");
    expect(text).not.toContain("deadline");
    expect(line([round({ matches: [fixture()] })], "prediction-refresh").eligible).toBe(true);
  });
});

describe("worker operating modes", () => {
  const enabled = { WORKER_ENABLED: "1", WORKER_SCAN_MINUTES: "60" };

  function deps(refresh: CycleDeps["refresh"], load: CycleDeps["loadRounds"] = async () => [round()]): CycleDeps {
    return {
      now: () => now,
      loadRounds: load,
      refresh,
      acquireInstance: async () => async () => undefined,
    };
  }

  it("leaves processing off unless WORKER_ENABLED is exactly 1", async () => {
    expect(readWorkerConfig({}, "supervise").refusal).toBe("disabled");
    expect(readWorkerConfig({ WORKER_ENABLED: "true" }, "once").refusal).toBe("disabled");
    expect(readWorkerConfig(enabled, "supervise").refusal).toBeNull();
    const refresh = async () => {
      throw new Error("refresh");
    };
    const report = await runWorkerCycle(readWorkerConfig({}, "once"), deps(refresh, async () => {
      throw new Error("load");
    }));
    expect(report).toMatchObject({ processed: 0, errors: 0, refusal: "disabled" });
  });

  it("refuses the supervised loop when the scan cap is missing or too small", () => {
    expect(readWorkerConfig({ WORKER_ENABLED: "1" }, "supervise").refusal).toBe("scan-unset");
    expect(readWorkerConfig({ WORKER_ENABLED: "1", WORKER_SCAN_MINUTES: "1" }, "supervise").refusal).toBe("scan-invalid");
    expect(readWorkerConfig({ WORKER_ENABLED: "1" }, "once").refusal).toBeNull();
    expect(readWorkerConfig({}, "plan").refusal).toBeNull();
  });

  it("plans without refresh, claims, or a second pass", async () => {
    let loaded = 0;
    const report = await runWorkerCycle(readWorkerConfig({}, "plan"), deps(async () => {
      throw new Error("refresh");
    }, async () => {
      loaded += 1;
      return [round(), round({ id: "closed", number: 14, closedAt: now })];
    }));
    expect(loaded).toBe(1);
    expect(report.lines.map((item) => `${item.number}:${item.job}:${item.reason}`)).toEqual([
      "15:prediction-refresh:due",
      "15:result-check:scoring-decision",
      "14:prediction-refresh:closed",
      "14:result-check:closed",
    ]);
  });

  it("runs one prediction refresh and does not execute a due result check", async () => {
    const seen: string[] = [];
    const report = await runWorkerCycle(readWorkerConfig(enabled, "once"), deps(async (roundId) => {
      seen.push(roundId);
      return { failed: false, busy: false, closed: false };
    }));
    expect(seen).toEqual(["round-15"]);
    expect(report.processed).toBe(1);
    expect(report.lines.find((item) => item.job === "result-check")?.reason).toBe("scoring-decision");
  });

  it("waits out the existing retry gap after a source failure", async () => {
    const sleeps: number[] = [];
    const controller = new AbortController();
    let calls = 0;
    await runWorkerLoop(readWorkerConfig(enabled, "supervise"), deps(async () => {
      calls += 1;
      return { failed: true, busy: false, closed: false };
    }), {
      signal: controller.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
        controller.abort();
      },
    });
    expect(calls).toBe(1);
    expect(sleeps).toEqual([5 * 60_000]);
    expect(workerSleepMs({ now, scanMinutes: 60, nextDueAt: new Date(now.getTime() + 10 * 60_000), hadError: false })).toBe(10 * 60_000);
  });

  it("uses the explicit scan cap when a successful refresh leaves the next check in the past", async () => {
    const sleeps: number[] = [];
    const controller = new AbortController();
    await runWorkerLoop(readWorkerConfig(enabled, "supervise"), deps(async () => ({ failed: false, busy: false, closed: false })), {
      signal: controller.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
        controller.abort();
      },
    });
    expect(sleeps).toEqual([60 * 60_000]);
  });

  it("stops on abort without another cycle and rejects a second instance", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const stopped = await runWorkerLoop(readWorkerConfig(enabled, "supervise"), deps(async () => {
      calls += 1;
      return { failed: false, busy: false, closed: false };
    }), { signal: controller.signal, sleep: async () => undefined });
    expect(stopped).toEqual([]);
    expect(calls).toBe(0);
    const duplicate = await runWorkerCycle(readWorkerConfig(enabled, "once"), {
      ...deps(async () => {
        calls += 1;
        return { failed: false, busy: false, closed: false };
      }),
      acquireInstance: async () => null,
    });
    expect(duplicate.duplicate).toBe(true);
    expect(calls).toBe(0);
  });
});

describe("worker claims", () => {
  it("recovers a claim whose owner is gone and keeps a live owner", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "udaff-worker-lock-"));
    try {
      const held = await acquireClaim(directory, "worker-instance", { pid: 424242, alive: () => true });
      expect(await acquireClaim(directory, "worker-instance", { alive: (pid) => pid === 424242 })).toBeNull();
      const recovered = await acquireClaim(directory, "worker-instance", { alive: () => false });
      expect(recovered).not.toBeNull();
      await held?.();
      await recovered?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("worker on an isolated database", () => {
  let directory = "";
  let databaseUrl = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-worker-db-"));
    databaseUrl = `file:${path.join(directory, "test.db")}`;
    process.env.DATABASE_URL = databaseUrl;
    process.env.WORKER_LOCK_DIR = path.join(directory, "locks");
    execFileSync(path.resolve("node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--accept-data-loss"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  }, 60_000);

  afterAll(() => {
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refreshes once, skips a closed write, and does not score or duplicate", async () => {
      const [{ PrismaClient }, { refreshPredictionForWorker }, { refreshRoundPredictions }, { loadWorkerRounds }, { runWorkerCycle }, { readWorkerConfig: readConfig }, { notePredictionRefreshFailure }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/worker/refresh-job"),
      import("@/lib/domain/import/refresh-predictions"),
      import("@/lib/domain/worker/load"),
      import("@/lib/domain/worker/cycle"),
      import("@/lib/domain/worker/config"),
      import("@/lib/domain/import/refresh-predictions"),
    ]);
    void notePredictionRefreshFailure;
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const season = await db.season.create({ data: { name: "Isolated", slug: `worker-${Date.now()}` } });
      const stored = await db.round.create({
        data: {
          seasonId: season.id,
          number: 15,
          forumUrl: "https://example.test/round",
          standingRole: "operational",
          productionStartedAt: started,
          matches: {
            create: [{ homeTeam: "Ростов", awayTeam: "Крылья Советов", kickoffAt: kickoff, sortOrder: 1, autoCheckKickoffAt: kickoff }],
          },
        },
        include: { matches: true },
      });
      const post = {
        title: "15",
        sourceUrl: "https://example.test/round",
        openingText: "Абразцы\n20.11.2026 21:00 Ростов — Крылья Советов",
        fetchedAt: now,
        comments: [{ externalId: "c-1", authorName: "Алексей", postedAt: now, rawHtml: "note", rawText: "SECRET_COMMENT" }],
      };
      let fetches = 0;
      const first = await refreshRoundPredictions(stored.id, {
        now,
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => {
          fetches += 1;
          return post;
        },
      });
      expect(first.busy).toBe(false);
      expect(first.failed).toBe(false);
      const second = await refreshRoundPredictions(stored.id, {
        now,
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => {
          fetches += 1;
          return post;
        },
      });
      expect(second.failed).toBe(false);
      expect(fetches).toBe(2);
      expect(await db.forumComment.count({ where: { roundId: stored.id } })).toBe(1);
      expect(await db.match.count({ where: { roundId: stored.id } })).toBe(1);
      expect(await db.roundScore.count({ where: { roundId: stored.id } })).toBe(0);
      const attempts = await db.match.findFirstOrThrow({ where: { roundId: stored.id } });
      expect(attempts.autoCheckAttempts).toBe(0);
      expect(attempts.homeTeam).toBe("Ростов");

      await expect(refreshRoundPredictions(stored.id, {
        now,
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => {
          throw new Error("source unavailable");
        },
      })).rejects.toThrow("source unavailable");
      await notePredictionRefreshFailure(stored.id, now, "source unavailable");
      expect(await db.match.findFirstOrThrow({ where: { roundId: stored.id } })).toMatchObject({ autoCheckAttempts: 0 });
      expect(await db.forumComment.count({ where: { roundId: stored.id } })).toBe(1);

      let startedFetch = false;
      let releaseFetch: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      const overlapping = refreshRoundPredictions(stored.id, {
        now,
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => {
          startedFetch = true;
          await gate;
          return post;
        },
      });
      while (!startedFetch) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const busy = await refreshRoundPredictions(stored.id, {
        now,
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => {
          throw new Error("second fetch");
        },
      });
      expect(busy.busy).toBe(true);
      releaseFetch();
      await overlapping;

      const before = await db.$queryRawUnsafe<{ data_version: bigint | number }[]>("PRAGMA data_version");
      const planned = await runWorkerCycle(readConfig({}, "plan"), {
        now: () => now,
        loadRounds: loadWorkerRounds,
        refresh: async () => {
          throw new Error("network");
        },
        acquireInstance: async () => {
          throw new Error("claim");
        },
      });
      const after = await db.$queryRawUnsafe<{ data_version: bigint | number }[]>("PRAGMA data_version");
      expect(after[0]?.data_version).toBe(before[0]?.data_version);
      expect(planned.lines.find((item) => item.job === "result-check")?.reason).toBe("scoring-decision");
      expect(JSON.stringify(planned)).not.toContain("SECRET_COMMENT");

      const late = await refreshRoundPredictions(stored.id, {
        now,
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => {
          await db.round.update({ where: { id: stored.id }, data: { closedAt: now } });
          return post;
        },
      }).catch((error: unknown) => error);
      expect(late).toMatchObject({ name: "RoundClosedError" });
      expect(await db.forumComment.count({ where: { roundId: stored.id } })).toBe(1);
      const workerClosed = await refreshPredictionForWorker(stored.id, now, process.env.WORKER_LOCK_DIR ?? "");
      expect(workerClosed.closed).toBe(true);
      expect(await db.roundScore.count()).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });
});

describe("worker scripts stay out of web startup", () => {
  const agent = readFileSync("scripts/worker-agent.sh", "utf8");
  const service = readFileSync("scripts/dev-up.sh", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  it("installs a separate agent without loading it", () => {
    const install = agent.split("install)")[1]?.split("start)")[0] ?? "";
    expect(install).toContain("Wrote");
    expect(install).not.toContain("launchctl");
    expect(agent).toContain('LABEL="com.udaff.counter-tracker.worker"');
    expect(agent).toContain("launchctl bootstrap");
    expect(agent).toContain("<key>SuccessfulExit</key>");
    expect(service).not.toContain("worker");
    expect(pkg.scripts.start).toBe("next start");
    expect(pkg.scripts["worker:plan"]).toBe("tsx scripts/worker.ts --plan");
    expect(readFileSync("scripts/worker-service.sh", "utf8")).not.toContain("WORKER_ENABLED=1");
    expect(readFileSync("src/lib/domain/worker/cycle.ts", "utf8")).not.toContain("pollDueRounds");
    expect(readFileSync("src/lib/domain/worker/refresh-job.ts", "utf8")).not.toContain("recalculateRound");
  });
});
