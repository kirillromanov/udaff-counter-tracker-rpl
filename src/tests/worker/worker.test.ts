import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireClaim } from "@/lib/domain/worker/claims";
import { readWorkerConfig, workerStartupFailure } from "@/lib/domain/worker/config";
import { runWorkerCycle, runWorkerLoop, workerReportIsQuiet, type CycleDeps } from "@/lib/domain/worker/cycle";
import { emitWorkerLine, formatWorkerLine } from "@/lib/domain/worker/log";
import { RESULT_VERIFICATION_SEASON_SLUG } from "@/lib/domain/results/eligibility";
import { planWorker, type WorkerRound } from "@/lib/domain/worker/plan";
import { nextPredictionFetchAtAfterAttempt } from "@/lib/domain/import/prediction-schedule";
import { RECHECK_MS, workerSleepMs } from "@/lib/domain/worker/sleep";
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
    seasonSlug: "other-season",
    standingRole: "operational",
    forumUrl: "https://example.test/round",
    nextPollAt: null,
    nextPredictionFetchAt: null,
    closedAt: null,
    productionStartedAt: started,
    resultsProcessing: true,
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
    expect(line([active], "result-check")).toMatchObject({ eligible: true, disposition: "skip", reason: "results-disabled" });
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
    expect(line([exhausted], "prediction-refresh").disposition).toBe("run");
    expect(line([exhausted], "result-check").reason).toBe("exhausted");
    const split = round({ nextPredictionFetchAt: new Date("2026-11-21T00:00:00.000Z") });
    expect(line([split], "prediction-refresh")).toMatchObject({ reason: "not-due", nextAt: "2026-11-21T00:00:00.000Z" });
    expect(line([split], "result-check")).toMatchObject({
      eligible: true,
      reason: "results-disabled",
      nextAt: "2026-11-20T16:00:00.000Z",
    });
    const verified = round({ matches: [fixture({ resultState: "verified", resultResolution: "verified", actualHomeGoals: 1, actualAwayGoals: 0 })] });
    expect(line([verified], "prediction-refresh").reason).toBe("stopped");
    expect(line([verified], "result-check").reason).toBe("stopped");
    const enabledResults = planWorker(
      [
        round(),
        round({ id: "official-15", number: 15, seasonSlug: RESULT_VERIFICATION_SEASON_SLUG }),
        round({ id: "official-16", number: 16, seasonSlug: RESULT_VERIFICATION_SEASON_SLUG }),
        round({ id: "official-17", number: 17, seasonSlug: RESULT_VERIFICATION_SEASON_SLUG }),
        round({ id: "other-16", number: 16, seasonSlug: "other-season" }),
        round({ id: "closed", number: 14, closedAt: now }),
        round({ id: "archived", number: 13, standingRole: "archived", productionStartedAt: null }),
      ],
      now,
      intervals,
      { resultsEnabled: true },
    );
    const job = (id: string, name: "prediction-refresh" | "result-check") =>
      enabledResults.find((item) => item.roundId === id && item.job === name);
    expect(job("round-15", "result-check")).toMatchObject({ disposition: "skip", reason: "outside-result-scope" });
    expect(job("round-15", "prediction-refresh")?.disposition).toBe("run");
    expect(job("official-15", "result-check")).toMatchObject({ disposition: "skip", reason: "outside-result-scope" });
    expect(job("official-15", "prediction-refresh")?.disposition).toBe("run");
    expect(job("official-16", "result-check")).toMatchObject({ disposition: "run", reason: "due" });
    expect(job("official-17", "result-check")).toMatchObject({ disposition: "run", reason: "due" });
    expect(job("other-16", "result-check")).toMatchObject({ disposition: "skip", reason: "outside-result-scope" });
    expect(job("other-16", "prediction-refresh")?.disposition).toBe("run");
    expect(job("closed", "result-check")).toMatchObject({ disposition: "skip", reason: "closed" });
    expect(job("archived", "result-check")?.reason).toBe("archived");
    const switchedOff = planWorker(
      [round({ id: "held", number: 16, seasonSlug: RESULT_VERIFICATION_SEASON_SLUG, resultsProcessing: false })],
      now,
      intervals,
      { resultsEnabled: true },
    );
    expect(switchedOff.find((item) => item.job === "result-check")).toMatchObject({
      eligible: true,
      disposition: "skip",
      reason: "round-switch-off",
    });
    expect(line([round({ number: 16, seasonSlug: RESULT_VERIFICATION_SEASON_SLUG, resultsProcessing: true })], "result-check").reason).toBe("results-disabled");
    expect(job("round-15", "prediction-refresh")?.nextAt).not.toBe(job("round-15", "result-check")?.nextAt);
  });

  it("does not add a prediction deadline or a score requirement", () => {
    const text = readFileSync("src/lib/domain/worker/plan.ts", "utf8");
    expect(text).not.toContain("recalculateRound");
    expect(text).not.toContain("deadline");
    expect(line([round({ matches: [fixture()] })], "prediction-refresh").eligible).toBe(true);
  });
});

describe("worker operating modes", () => {
  const enabled = { WORKER_ENABLED: "1", PREDICTION_REFRESH_INTERVAL_MINUTES: "60" };
  const idle = { failed: false, busy: false, closed: false, nextAt: new Date(now.getTime() + 60 * 60_000).toISOString() };

  function deps(refresh: CycleDeps["refresh"], load: CycleDeps["loadRounds"] = async () => [round()], poll: CycleDeps["poll"] = async () => {
    throw new Error("result poll");
  }): CycleDeps {
    return {
      now: () => now,
      loadRounds: load,
      refresh,
      poll,
      acquireInstance: async () => async () => undefined,
    };
  }

  it("leaves processing off unless WORKER_ENABLED is exactly 1", async () => {
    expect(readWorkerConfig({}, "supervise").refusal).toBe("disabled");
    expect(readWorkerConfig({ WORKER_ENABLED: "true" }, "once").refusal).toBe("disabled");
    expect(readWorkerConfig({ WORKER_RESULTS_ENABLED: "1" }, "once")).toMatchObject({ refusal: "disabled", resultsEnabled: false });
    expect(readWorkerConfig(enabled, "supervise")).toMatchObject({ refusal: null, resultsEnabled: false, predictionIntervalMinutes: 60 });
    expect(readWorkerConfig({ ...enabled, WORKER_RESULTS_ENABLED: "1" }, "once").resultsEnabled).toBe(true);
    const refresh = async () => {
      throw new Error("refresh");
    };
    const report = await runWorkerCycle(readWorkerConfig({}, "once"), deps(refresh, async () => {
      throw new Error("load");
    }));
    expect(report).toMatchObject({ processed: 0, errors: 0, refusal: "disabled" });
  });

  it("does not invent a prediction interval or enable results from the worker flag alone", async () => {
    expect(readWorkerConfig({ WORKER_ENABLED: "1" }, "supervise").predictionIntervalMinutes).toBeNull();
    expect(readWorkerConfig({ WORKER_ENABLED: "1", PREDICTION_REFRESH_INTERVAL_MINUTES: "1" }, "once").predictionIntervalMinutes).toBeNull();
    expect(readWorkerConfig({ WORKER_ENABLED: "1" }, "once").resultsEnabled).toBe(false);
    expect(readWorkerConfig({}, "plan").refusal).toBeNull();
    let called = 0;
    const skipped = await runWorkerCycle(readWorkerConfig({ WORKER_ENABLED: "1" }, "once"), deps(async () => {
      called += 1;
      return idle;
    }));
    expect(called).toBe(0);
    expect(skipped.lines.find((item) => item.job === "prediction-refresh")?.reason).toBe("prediction-interval-unset");
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
      "15:result-check:results-disabled",
      "14:prediction-refresh:closed",
      "14:result-check:closed",
    ]);
  });

  it("runs one prediction refresh and does not execute a due result check", async () => {
    const seen: string[] = [];
    const polled: string[] = [];
    const report = await runWorkerCycle(readWorkerConfig(enabled, "once"), deps(async (roundId) => {
      seen.push(roundId);
      return idle;
    }, async () => [round()], async (roundId) => {
      polled.push(roundId);
      return idle;
    }));
    expect(seen).toEqual(["round-15"]);
    expect(polled).toEqual([]);
    expect(report.processed).toBe(1);
    expect(report.lines.find((item) => item.job === "result-check")?.reason).toBe("results-disabled");
  });

  it("polls a due result only when the result flag is on", async () => {
    const polled: string[] = [];
    const report = await runWorkerCycle(readWorkerConfig({ ...enabled, WORKER_RESULTS_ENABLED: "1" }, "once"), deps(async () => {
      throw new Error("prediction");
    }, async () => [round({
      id: "round-16",
      number: 16,
      seasonSlug: RESULT_VERIFICATION_SEASON_SLUG,
      nextPredictionFetchAt: new Date("2026-11-21T00:00:00.000Z"),
    })], async (roundId) => {
      polled.push(roundId);
      return { ...idle, nextAt: new Date(now.getTime() + 5 * 60_000).toISOString() };
    }));
    expect(polled).toEqual(["round-16"]);
    expect(report.processed).toBe(1);
    expect(report.lines.find((item) => item.job === "prediction-refresh")?.reason).toBe("not-due");
  });

  it("does not poll round 15 of this season or round 16 of another season", async () => {
    const polled: string[] = [];
    const seen: string[] = [];
    const report = await runWorkerCycle(readWorkerConfig({ ...enabled, WORKER_RESULTS_ENABLED: "1" }, "once"), deps(async (roundId) => {
      seen.push(roundId);
      return idle;
    }, async () => [
      round({ id: "early", number: 15, seasonSlug: RESULT_VERIFICATION_SEASON_SLUG }),
      round({ id: "other", number: 16, seasonSlug: "other-season", nextPredictionFetchAt: new Date("2026-11-21T00:00:00.000Z") }),
    ], async (roundId) => {
      polled.push(roundId);
      return idle;
    }));
    expect(polled).toEqual([]);
    expect(seen).toEqual(["early"]);
    expect(report.lines.find((item) => item.roundId === "early" && item.job === "result-check")?.reason).toBe("outside-result-scope");
    expect(report.lines.find((item) => item.roundId === "other" && item.job === "result-check")?.reason).toBe("outside-result-scope");
    expect(report.lines.find((item) => item.roundId === "early" && item.job === "prediction-refresh")?.disposition).toBe("run");
  });

  it("rechecks within 60 seconds after a failure instead of sleeping the prediction interval", async () => {
    const sleeps: number[] = [];
    const reports: string[] = [];
    const controller = new AbortController();
    let calls = 0;
    const nextAt = new Date(now.getTime() + 60 * 60_000).toISOString();
    await runWorkerLoop(readWorkerConfig(enabled, "supervise"), deps(async () => {
      calls += 1;
      return { failed: true, busy: false, closed: false, nextAt };
    }), {
      signal: controller.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
        controller.abort();
      },
      onReport: () => reports.push("report"),
    });
    expect(calls).toBe(1);
    expect(reports).toEqual(["report"]);
    expect(sleeps).toEqual([RECHECK_MS]);
    expect(workerSleepMs({ now, nextDueAt: new Date(now.getTime() + 10 * 60_000), scanMinutes: null })).toBe(RECHECK_MS);
    expect(workerSleepMs({ now, nextDueAt: new Date(now.getTime() + 20_000), scanMinutes: null })).toBe(20_000);
  });

  it("caps the wait at the recheck bound even when a scan cap is longer", async () => {
    const sleeps: number[] = [];
    const controller = new AbortController();
    const nextAt = new Date(now.getTime() + 30 * 60_000).toISOString();
    await runWorkerLoop(readWorkerConfig({ ...enabled, WORKER_SCAN_MINUTES: "60" }, "supervise"), deps(async () => ({ ...idle, nextAt })), {
      signal: controller.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
        controller.abort();
      },
    });
    expect(sleeps).toEqual([RECHECK_MS]);
  });

  it("runs one overdue fetch after several missed intervals and does not fetch on the recheck", async () => {
    let clock = new Date("2026-11-20T12:00:00.000Z");
    let storedNext = new Date("2026-11-20T08:00:00.000Z");
    let fetches = 0;
    let inFlight = false;
    const sequence: string[] = [];
    const controller = new AbortController();
    await runWorkerLoop(readWorkerConfig(enabled, "supervise"), {
      now: () => clock,
      loadRounds: async () => [
        round({ nextPredictionFetchAt: storedNext }),
        round({ id: "closed", number: 14, closedAt: clock, nextPredictionFetchAt: storedNext }),
      ],
      acquireInstance: async () => async () => undefined,
      refresh: async (roundId) => {
        if (inFlight) {
          throw new Error("overlap");
        }
        if (roundId !== "round-15") {
          throw new Error("unexpected round");
        }
        inFlight = true;
        fetches += 1;
        storedNext = nextPredictionFetchAtAfterAttempt(clock, 60);
        inFlight = false;
        return { failed: false, busy: false, closed: false, nextAt: storedNext.toISOString(), detail: "0 new, 1 unchanged" };
      },
      poll: async () => {
        throw new Error("result poll");
      },
    }, {
      signal: controller.signal,
      onStart: () => sequence.push("start"),
      onReport: (report) => sequence.push(workerReportIsQuiet(report) ? "quiet" : "report"),
      sleep: async (ms) => {
        sequence.push("sleep");
        expect(ms).toBeLessThanOrEqual(RECHECK_MS);
        clock = new Date(clock.getTime() + ms);
        if (sequence.filter((item) => item === "sleep").length >= 2) {
          controller.abort();
        }
      },
    });
    expect(fetches).toBe(1);
    expect(storedNext.toISOString()).toBe("2026-11-20T13:00:00.000Z");
    expect(sequence).toEqual(["start", "report", "sleep", "quiet", "sleep"]);
  });

  it("emits a cycle line immediately and refuses a missing prediction interval", () => {
    const lines: string[] = [];
    emitWorkerLine(formatWorkerLine("cycle", { processed: 1, results: false, nextDueAt: "2026-11-20T13:00:00.000Z" }), (text) => lines.push(text));
    expect(lines).toEqual([expect.stringMatching(/worker cycle processed=1 results=false nextDueAt=2026-11-20T13:00:00.000Z\n$/)]);
    expect(workerStartupFailure(readWorkerConfig({ WORKER_ENABLED: "1" }, "supervise"))).toBe("prediction-interval-unset");
    expect(workerStartupFailure(readWorkerConfig(enabled, "supervise"))).toBeNull();
    expect(workerStartupFailure(readWorkerConfig({}, "supervise"))).toBeNull();
  });

  it("stops on abort without another cycle and rejects a second instance", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    let reports = 0;
    await runWorkerLoop(readWorkerConfig(enabled, "supervise"), deps(async () => {
      calls += 1;
      return { failed: false, busy: false, closed: false, nextAt: null };
    }), {
      signal: controller.signal,
      sleep: async () => undefined,
      onReport: () => {
        reports += 1;
      },
    });
    expect(reports).toBe(0);
    expect(calls).toBe(0);
    const duplicate = await runWorkerCycle(readWorkerConfig(enabled, "once"), {
      ...deps(async () => {
        calls += 1;
        return { failed: false, busy: false, closed: false, nextAt: null };
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
    process.env.PREDICTION_REFRESH_INTERVAL_MINUTES = "60";
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
      const [{ PrismaClient }, { refreshPredictionForWorker }, { refreshRoundPredictions }, { loadWorkerRounds }, { runWorkerCycle }, { readWorkerConfig: readConfig }, { notePredictionRefreshFailure }, { refreshRoundResults }, { acquireClaim: acquire }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/worker/refresh-job"),
      import("@/lib/domain/import/refresh-predictions"),
      import("@/lib/domain/worker/load"),
      import("@/lib/domain/worker/cycle"),
      import("@/lib/domain/worker/config"),
      import("@/lib/domain/import/refresh-predictions"),
      import("@/lib/domain/results/poll-run"),
      import("@/lib/domain/worker/claims"),
    ]);
    void notePredictionRefreshFailure;
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const season = await db.season.create({ data: { name: "Isolated", slug: `worker-${Date.now()}` } });
      await db.standingsCheckpoint.create({
        data: { seasonId: season.id, afterRoundNumber: 13, source: "manual", label: "baseline", rawText: "BASELINE_SENTINEL" },
      });
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
      expect((await db.round.findUniqueOrThrow({ where: { id: stored.id } })).nextPredictionFetchAt?.toISOString()).toBe("2026-11-20T19:00:00.000Z");
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
      const failedAt = new Date("2026-11-20T18:10:00.000Z");
      await notePredictionRefreshFailure(stored.id, failedAt, "source unavailable");
      expect((await db.round.findUniqueOrThrow({ where: { id: stored.id } })).nextPredictionFetchAt?.toISOString()).toBe("2026-11-20T19:10:00.000Z");
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
      const heldResult = await acquire(process.env.WORKER_LOCK_DIR ?? "", `result-${stored.id}`);
      const blockedResult = await refreshRoundResults(stored.id, { automatic: true });
      expect(blockedResult.busy).toBe(true);
      expect(blockedResult.recalculated).toBe(false);
      await heldResult?.();
      expect(await db.match.findFirstOrThrow({ where: { roundId: stored.id } })).toMatchObject({ autoCheckAttempts: 0 });

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
        poll: async () => {
          throw new Error("result poll");
        },
      });
      const after = await db.$queryRawUnsafe<{ data_version: bigint | number }[]>("PRAGMA data_version");
      expect(after[0]?.data_version).toBe(before[0]?.data_version);
      expect(planned.lines.find((item) => item.job === "result-check")?.reason).toBe("results-disabled");
      expect(planned.lines.find((item) => item.job === "prediction-refresh")?.nextAt).not.toBe(
        planned.lines.find((item) => item.job === "result-check")?.nextAt,
      );
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
      await expect(refreshRoundResults(stored.id, { automatic: true })).rejects.toMatchObject({ name: "RoundClosedError" });
      expect(await db.roundScore.count()).toBe(0);
      expect(await db.standingsCheckpoint.findFirstOrThrow({ where: { seasonId: season.id } })).toMatchObject({ rawText: "BASELINE_SENTINEL" });
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
    expect(agent).toContain("<true/>");
    expect(agent).toContain("<key>ThrottleInterval</key>");
    expect(agent).toContain("launchctl bootout");
    expect(readFileSync("scripts/worker-service.sh", "utf8")).toContain("exit 1");
    expect(readFileSync("scripts/worker-service.sh", "utf8")).not.toContain("exit 0");
    expect(service).not.toContain("worker");
    expect(pkg.scripts.start).toBe("next start");
    expect(pkg.scripts["worker:plan"]).toBe("tsx scripts/worker.ts --plan");
    expect(readFileSync("scripts/worker-service.sh", "utf8")).not.toContain("WORKER_ENABLED=1");
    expect(readFileSync("src/lib/domain/worker/cycle.ts", "utf8")).not.toContain("pollDueRounds");
    expect(readFileSync("src/lib/domain/worker/refresh-job.ts", "utf8")).not.toContain("recalculateRound");
  });
});
