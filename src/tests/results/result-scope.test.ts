import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RESULT_VERIFICATION_FIRST_ROUND,
  RESULT_VERIFICATION_SEASON_SLUG,
  ResultScopeError,
  resultVerificationApplies,
} from "@/lib/domain/results/eligibility";
import { resultLabelForRound } from "@/lib/domain/results/result-label";

describe("result verification scope", () => {
  it("starts at round 16 of this season and nowhere else", () => {
    expect(RESULT_VERIFICATION_SEASON_SLUG).toBe("rpl-demo-2026");
    expect(RESULT_VERIFICATION_FIRST_ROUND).toBe(16);
    expect(resultVerificationApplies({ seasonSlug: RESULT_VERIFICATION_SEASON_SLUG, number: 15 })).toBe(false);
    expect(resultVerificationApplies({ seasonSlug: RESULT_VERIFICATION_SEASON_SLUG, number: 16 })).toBe(true);
    expect(resultVerificationApplies({ seasonSlug: RESULT_VERIFICATION_SEASON_SLUG, number: 17 })).toBe(true);
    expect(resultVerificationApplies({ seasonSlug: "other-season", number: 16 })).toBe(false);
    expect(resultVerificationApplies({ seasonSlug: "other-season", number: 17 })).toBe(false);
  });

  it("keeps the stored phase label when the new workflow does not apply", () => {
    const legacyManual = {
      resultProvenance: "",
      manuallyCorrected: false,
      resultConflict: false,
      resultState: "manual",
    };
    expect(resultLabelForRound(false, legacyManual, "Source verified")).toBe("Source verified");
    expect(resultLabelForRound(true, legacyManual, "Source verified")).toBe("older manual score");
    const verified = {
      resultProvenance: "",
      manuallyCorrected: false,
      resultConflict: false,
      resultState: "verified",
    };
    expect(resultLabelForRound(false, verified, "Source verified")).toBe("Source verified");
  });
});

describe("result verification scope on an isolated database", () => {
  let directory = "";
  let databaseUrl = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-result-scope-"));
    databaseUrl = `file:${path.join(directory, "test.db")}`;
    process.env.DATABASE_URL = databaseUrl;
    process.env.WORKER_LOCK_DIR = directory;
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

  it("refuses rounds before 16 and another season, and allows this season from round 16", async () => {
    const [{ PrismaClient }, { applyManualResult, saveScoreLockBatch }, { refreshRoundResults, pollDueRounds }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/results/correction"),
      import("@/lib/domain/results/poll-run"),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const kickoff = new Date("2026-11-20T16:00:00.000Z");
    const now = new Date("2026-11-20T20:00:00.000Z");
    const official = await db.season.create({ data: { name: "RPL Demo 2026", slug: RESULT_VERIFICATION_SEASON_SLUG } });
    const other = await db.season.create({ data: { name: "Other", slug: "other-season" } });
    const early = await db.round.create({
      data: {
        seasonId: official.id,
        number: 15,
        standingRole: "operational",
        productionStartedAt: kickoff,
        status: "open",
        pollStatus: "scheduled",
        nextPollAt: new Date("2026-11-20T18:00:00.000Z"),
      },
    });
    const foreign = await db.round.create({
      data: {
        seasonId: other.id,
        number: 16,
        standingRole: "operational",
        productionStartedAt: kickoff,
        status: "open",
        pollStatus: "scheduled",
        nextPollAt: new Date("2026-11-20T18:00:00.000Z"),
      },
    });
    const earlyMatch = await db.match.create({
      data: {
        roundId: early.id,
        homeTeam: "Early Home",
        awayTeam: "Early Away",
        kickoffAt: kickoff,
        actualHomeGoals: 1,
        actualAwayGoals: 0,
        resultState: "verified",
        resultResolution: "verified",
        resultVersion: 2,
      },
    });
    const foreignMatch = await db.match.create({
      data: {
        roundId: foreign.id,
        homeTeam: "Other Home",
        awayTeam: "Other Away",
        kickoffAt: kickoff,
        actualHomeGoals: 1,
        actualAwayGoals: 0,
        resultState: "verified",
        resultResolution: "verified",
      },
    });
    const beforeEarly = await db.round.findUniqueOrThrow({ where: { id: early.id } });
    const beforeForeign = await db.round.findUniqueOrThrow({ where: { id: foreign.id } });
    await expect(pollDueRounds({ forceRoundId: early.id, now })).rejects.toBeInstanceOf(ResultScopeError);
    await pollDueRounds({ now });
    const afterEarly = await db.round.findUniqueOrThrow({ where: { id: early.id } });
    const afterForeign = await db.round.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(afterEarly.pollStatus).toBe(beforeEarly.pollStatus);
    expect(afterEarly.nextPollAt?.toISOString()).toBe(beforeEarly.nextPollAt?.toISOString());
    expect(afterEarly.lastPolledAt).toBeNull();
    expect(afterForeign.pollStatus).toBe(beforeForeign.pollStatus);
    expect(afterForeign.nextPollAt?.toISOString()).toBe(beforeForeign.nextPollAt?.toISOString());

    await expect(refreshRoundResults(early.id, { fetches: [] })).rejects.toBeInstanceOf(ResultScopeError);
    await expect(applyManualResult({
      matchId: earlyMatch.id,
      home: "4",
      away: "4",
      version: 2,
      standingChangeConfirmed: true,
      reason: "must not write",
      now,
    })).rejects.toBeInstanceOf(ResultScopeError);
    await expect(saveScoreLockBatch({
      roundId: early.id,
      standingChangeConfirmed: true,
      now,
      items: [{ matchId: earlyMatch.id, fixed: true, home: "4", away: "4", version: 2 }],
    })).rejects.toBeInstanceOf(ResultScopeError);
    await expect(applyManualResult({
      matchId: foreignMatch.id,
      home: "4",
      away: "4",
      version: 0,
      standingChangeConfirmed: true,
      reason: "other season",
      now,
    })).rejects.toBeInstanceOf(ResultScopeError);

    const keptEarly = await db.match.findUniqueOrThrow({ where: { id: earlyMatch.id } });
    const keptForeign = await db.match.findUniqueOrThrow({ where: { id: foreignMatch.id } });
    expect(keptEarly).toMatchObject({ actualHomeGoals: 1, actualAwayGoals: 0, resultState: "verified", resultProvenance: "", manuallyCorrected: false, resultVersion: 2 });
    expect(keptForeign).toMatchObject({ actualHomeGoals: 1, actualAwayGoals: 0, resultState: "verified", resultProvenance: "", manuallyCorrected: false });
    expect(await db.resultAudit.count()).toBe(0);

    const later = await db.round.create({
      data: { seasonId: official.id, number: 17, standingRole: "operational", productionStartedAt: kickoff, status: "open" },
    });
    const current = await db.round.create({
      data: { seasonId: official.id, number: 16, standingRole: "operational", productionStartedAt: kickoff, status: "open" },
    });
    const currentMatch = await db.match.create({
      data: {
        roundId: current.id,
        homeTeam: "Current Home",
        awayTeam: "Current Away",
        kickoffAt: kickoff,
        actualHomeGoals: 1,
        actualAwayGoals: 0,
        resultState: "confirmed",
        resultResolution: "provisional",
      },
    });
    const laterMatch = await db.match.create({
      data: {
        roundId: later.id,
        homeTeam: "Later Home",
        awayTeam: "Later Away",
        kickoffAt: kickoff,
        actualHomeGoals: 0,
        actualAwayGoals: 0,
        resultState: "confirmed",
        resultResolution: "provisional",
      },
    });
    const savedCurrent = await applyManualResult({
      matchId: currentMatch.id,
      home: "2",
      away: "1",
      version: 0,
      standingChangeConfirmed: false,
      reason: "round 16",
      now,
      deferRecalculation: true,
    });
    const savedLater = await applyManualResult({
      matchId: laterMatch.id,
      home: "3",
      away: "0",
      version: 0,
      standingChangeConfirmed: false,
      reason: "round 17",
      now,
      deferRecalculation: true,
    });
    expect(savedCurrent.scoreChanged).toBe(true);
    expect(savedLater.scoreChanged).toBe(true);
    expect(await db.match.findUniqueOrThrow({ where: { id: currentMatch.id } })).toMatchObject({ actualHomeGoals: 2, actualAwayGoals: 1, manuallyCorrected: true });
    expect(await db.match.findUniqueOrThrow({ where: { id: laterMatch.id } })).toMatchObject({ actualHomeGoals: 3, actualAwayGoals: 0, manuallyCorrected: true });
    expect((await db.match.findUniqueOrThrow({ where: { id: earlyMatch.id } })).actualHomeGoals).toBe(1);
    await db.$disconnect();
  });
});
