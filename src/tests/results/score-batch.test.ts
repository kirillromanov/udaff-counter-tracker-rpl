import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESULT_VERIFICATION_SEASON_SLUG } from "@/lib/domain/results/eligibility";
import { authoritativeScoreChanges, formatDraftScore } from "@/lib/domain/results/score-draft";

describe("score drafts before a shared save", () => {
  it("previews a switch off and does not treat a same-number lock as a score change", () => {
    const changes = authoritativeScoreChanges([
      {
        id: "off",
        name: "Manual Home — Manual Away",
        storedHome: 3,
        storedAway: 0,
        verifiedForStandings: true,
        draftFixed: false,
        draftHome: 1,
        draftAway: 0,
        automaticHome: 1,
        automaticAway: 0,
      },
      {
        id: "same",
        name: "Equal Home — Equal Away",
        storedHome: 1,
        storedAway: 0,
        verifiedForStandings: true,
        draftFixed: true,
        draftHome: 1,
        draftAway: 0,
        automaticHome: 1,
        automaticAway: 0,
      },
    ]);
    expect(changes).toEqual([{
      id: "off",
      name: "Manual Home — Manual Away",
      previousHome: 3,
      previousAway: 0,
      nextHome: 1,
      nextAway: 0,
      needsStandingConfirm: true,
    }]);
    expect(formatDraftScore(3, 0)).toBe("3-0");
    expect(formatDraftScore(null, null)).toBe("none");
  });
});

describe("shared score save on an isolated database", () => {
  let directory = "";
  let databaseUrl = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-score-batch-"));
    databaseUrl = `file:${path.join(directory, "test.db")}`;
    process.env.DATABASE_URL = databaseUrl;
    process.env.WORKER_LOCK_DIR = path.join(directory, "locks");
    execFileSync(path.resolve("node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--accept-data-loss"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, WORKER_LOCK_DIR: path.join(directory, "locks") },
      stdio: "pipe",
    });
  }, 60_000);

  afterAll(() => {
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("saves several fixtures once, rejects a stale fixture without partial writes, and leaves unchanged rows alone", async () => {
    const [{ PrismaClient }, correction, { recalculateRound }, { saveMatrixResults }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/results/correction"),
      import("@/lib/domain/standings/recalculate-round"),
      import("@/lib/domain/import/save-matrix"),
    ]);
    const { saveScoreLockBatch, ResultCorrectionError } = correction;
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const season = await db.season.create({ data: { name: "batch", slug: RESULT_VERIFICATION_SEASON_SLUG } });
    const person = await db.participant.create({ data: { name: "Batch", normalizedName: `batch-${Date.now()}` } });
    await db.seasonParticipant.create({ data: { seasonId: season.id, participantId: person.id } });
    const round = await db.round.create({
      data: { seasonId: season.id, number: 16, name: "16", standingRole: "operational", productionStartedAt: new Date("2026-11-01T00:00:00.000Z"), status: "open" },
    });
    const kickoff = new Date("2026-11-20T16:00:00.000Z");
    const now = new Date("2026-11-23T12:00:00.000Z");
    const provisional = await db.match.create({
      data: { roundId: round.id, sortOrder: 1, homeTeam: "Provisional Home", awayTeam: "Provisional Away", kickoffAt: kickoff, actualHomeGoals: 1, actualAwayGoals: 0, resultState: "confirmed", resultResolution: "provisional", resultProvenance: "one-source", resultVersion: 1 },
    });
    const verified = await db.match.create({
      data: { roundId: round.id, sortOrder: 2, homeTeam: "Verified Home", awayTeam: "Verified Away", kickoffAt: kickoff, actualHomeGoals: 2, actualAwayGoals: 1, resultState: "verified", resultResolution: "verified", resultProvenance: "two-source", resultVersion: 1 },
    });
    const manual = await db.match.create({
      data: { roundId: round.id, sortOrder: 3, homeTeam: "Manual Home", awayTeam: "Manual Away", kickoffAt: kickoff, actualHomeGoals: 3, actualAwayGoals: 0, resultState: "verified", resultResolution: "verified", resultProvenance: "manual", manuallyCorrected: true, resultConflict: true, resultVersion: 2 },
    });
    const untouched = await db.match.create({
      data: { roundId: round.id, sortOrder: 4, homeTeam: "Equal Home", awayTeam: "Equal Away", kickoffAt: kickoff, actualHomeGoals: 1, actualAwayGoals: 0, resultState: "verified", resultResolution: "verified", resultProvenance: "manual", manuallyCorrected: true, resultVersion: 4 },
    });
    const slip = await db.predictionSet.create({
      data: { roundId: round.id, participantId: person.id, selected: true, status: "accepted" },
    });
    await db.prediction.create({ data: { predictionSetId: slip.id, matchId: provisional.id, homeGoals: 1, awayGoals: 0 } });
    async function source(matchId: string, sourceName: string, key: string, homeTeam: string, awayTeam: string, homeGoals: number, awayGoals: number) {
      await db.resultObservation.create({
        data: { source: sourceName, sourceKey: key, homeTeam, awayTeam, homeGoals, awayGoals, role: "primary", matchId, firstSeenAt: now, lastSeenAt: now },
      });
    }
    await source(provisional.id, "sport-ru", "p", "Provisional Home", "Provisional Away", 1, 0);
    await source(verified.id, "sport-ru", "v1", "Verified Home", "Verified Away", 2, 1);
    await source(verified.id, "premierliga", "v2", "Verified Home", "Verified Away", 2, 1);
    await source(manual.id, "sport-ru", "m", "Manual Home", "Manual Away", 1, 0);
    await source(untouched.id, "sport-ru", "e1", "Equal Home", "Equal Away", 1, 0);
    await source(untouched.id, "premierliga", "e2", "Equal Home", "Equal Away", 1, 0);

    let recalculations = 0;
    const recalculate = async (roundId: string) => {
      recalculations += 1;
      await recalculateRound(roundId);
    };
    await expect(saveScoreLockBatch({
      roundId: round.id,
      standingChangeConfirmed: false,
      now,
      recalculate,
      items: [
        { matchId: provisional.id, fixed: true, home: "4", away: "0", version: 1 },
        { matchId: verified.id, fixed: true, home: "0", away: "0", version: 1 },
      ],
    })).rejects.toThrow(/standings should use this corrected score/);
    expect(recalculations).toBe(0);
    expect((await db.match.findUniqueOrThrow({ where: { id: provisional.id } })).actualHomeGoals).toBe(1);
    expect((await db.match.findUniqueOrThrow({ where: { id: verified.id } })).resultVersion).toBe(1);
    expect(await db.resultAudit.count()).toBe(0);

    const saved = await saveScoreLockBatch({
      roundId: round.id,
      standingChangeConfirmed: true,
      now,
      recalculate,
      items: [
        { matchId: provisional.id, fixed: true, home: "4", away: "0", version: 1 },
        { matchId: verified.id, fixed: true, home: "0", away: "0", version: 1 },
        { matchId: manual.id, fixed: true, home: "3", away: "0", version: 2 },
        { matchId: untouched.id, fixed: true, home: "1", away: "0", version: 4 },
      ],
    });
    expect(saved).toEqual({ recalculated: true, changed: 2 });
    expect(recalculations).toBe(1);
    const locked = await db.match.findUniqueOrThrow({ where: { id: provisional.id } });
    const changed = await db.match.findUniqueOrThrow({ where: { id: verified.id } });
    const kept = await db.match.findUniqueOrThrow({ where: { id: manual.id } });
    const same = await db.match.findUniqueOrThrow({ where: { id: untouched.id } });
    expect(locked.actualHomeGoals).toBe(4);
    expect(locked.manuallyCorrected).toBe(true);
    expect(changed.actualHomeGoals).toBe(0);
    expect(changed.resultProvenance).toBe("manual");
    expect(kept.resultVersion).toBe(2);
    expect(same.resultVersion).toBe(4);
    const audits = await db.resultAudit.findMany({ orderBy: { createdAt: "asc" } });
    expect(audits.map((row) => row.matchId).sort()).toEqual([provisional.id, verified.id].sort());

    await db.match.update({ where: { id: verified.id }, data: { resultVersion: { increment: 1 } } });
    const beforeStale = await db.match.findUniqueOrThrow({ where: { id: provisional.id } });
    await expect(saveScoreLockBatch({
      roundId: round.id,
      standingChangeConfirmed: true,
      now,
      recalculate,
      items: [
        { matchId: provisional.id, fixed: true, home: "5", away: "0", version: beforeStale.resultVersion },
        { matchId: verified.id, fixed: true, home: "1", away: "1", version: changed.resultVersion },
      ],
    })).rejects.toBeInstanceOf(ResultCorrectionError);
    expect(recalculations).toBe(1);
    const afterStale = await db.match.findUniqueOrThrow({ where: { id: provisional.id } });
    expect(afterStale.actualHomeGoals).toBe(4);
    expect(afterStale.resultVersion).toBe(beforeStale.resultVersion);
    expect(await db.resultAudit.count({ where: { matchId: provisional.id } })).toBe(1);

    const released = await saveScoreLockBatch({
      roundId: round.id,
      standingChangeConfirmed: true,
      now,
      recalculate,
      items: [{ matchId: manual.id, fixed: false, home: "3", away: "0", version: 2 }],
    });
    expect(released.recalculated).toBe(true);
    expect(recalculations).toBe(2);
    const automatic = await db.match.findUniqueOrThrow({ where: { id: manual.id } });
    expect(automatic.manuallyCorrected).toBe(false);
    expect(automatic.actualHomeGoals).toBe(1);
    expect(automatic.actualAwayGoals).toBe(0);
    expect(automatic.resultProvenance).toBe("");

    await expect(saveMatrixResults()).rejects.toThrow(/Fix score/);
    await db.$disconnect();
  });
});
