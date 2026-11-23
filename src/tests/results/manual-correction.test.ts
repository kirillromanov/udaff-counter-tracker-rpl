import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("manual result correction on an isolated database", () => {
  let directory = "";
  let databaseUrl = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-correction-"));
    databaseUrl = `file:${path.join(directory, "test.db")}`;
    process.env.DATABASE_URL = databaseUrl;
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

  it("confirms, rejects a stale version, keeps sources, and rolls back without a second score change", async () => {
    const [{ PrismaClient }, { applyManualResult, rollbackManualResult, ResultCorrectionError, recomputeFromSources }, { RoundClosedError }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/results/correction"),
      import("@/lib/domain/rounds/round-lock"),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const season = await db.season.create({ data: { name: "test", slug: "test-correction" } });
    const round = await db.round.create({
      data: { seasonId: season.id, number: 16, name: "16", standingRole: "operational", productionStartedAt: new Date("2026-11-01T00:00:00.000Z"), status: "open" },
    });
    const kickoff = new Date("2026-11-20T16:00:00.000Z");
    const person = await db.participant.create({ data: { name: "Tester", normalizedName: "tester" } });
    await db.seasonParticipant.create({ data: { seasonId: season.id, participantId: person.id } });
    const match = await db.match.create({
      data: {
        roundId: round.id,
        homeTeam: "Ростов",
        awayTeam: "Крылья Советов",
        kickoffAt: kickoff,
        actualHomeGoals: 1,
        actualAwayGoals: 0,
        resultState: "confirmed",
        resultResolution: "provisional",
        resultProvenance: "one-source",
        resultVersion: 3,
      },
    });
    const slip = await db.predictionSet.create({
      data: { roundId: round.id, participantId: person.id, selected: true, status: "accepted" },
    });
    await db.prediction.create({ data: { predictionSetId: slip.id, matchId: match.id, homeGoals: 1, awayGoals: 0 } });
    await db.resultObservation.create({
      data: { source: "sport-ru", sourceKey: "a", homeTeam: "Ростов", awayTeam: "Крылья Советов", homeGoals: 1, awayGoals: 0, role: "primary", matchId: match.id, firstSeenAt: kickoff, lastSeenAt: kickoff },
    });
    await db.resultObservation.create({
      data: { source: "premierliga", sourceKey: "b", homeTeam: "Ростов", awayTeam: "Крылья Советов", homeGoals: 1, awayGoals: 0, role: "fallback", matchId: match.id, firstSeenAt: kickoff, lastSeenAt: kickoff },
    });
    const now = new Date("2026-11-20T20:00:00.000Z");
    const same = await applyManualResult({ matchId: match.id, home: "1", away: "0", version: 3, standingChangeConfirmed: false, reason: "confirmed", now });
    expect(same.recalculated).toBe(false);
    const marked = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(marked.manuallyCorrected).toBe(false);
    expect(marked.resultProvenance).toBe("operator-confirmed");
    expect(marked.resultState).toBe("verified");
    expect(marked.resultVersion).toBe(4);
    await expect(applyManualResult({ matchId: match.id, home: "2", away: "0", version: 3, standingChangeConfirmed: true, reason: "late", now })).rejects.toBeInstanceOf(ResultCorrectionError);
    await expect(applyManualResult({ matchId: match.id, home: "2", away: "", version: 4, standingChangeConfirmed: true, reason: "", now })).rejects.toBeInstanceOf(ResultCorrectionError);
    const unchangedRollback = await rollbackManualResult({ matchId: match.id, version: 4, confirmed: true, reason: "same score", now });
    expect(unchangedRollback.recalculated).toBe(false);
    const back = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(back.manuallyCorrected).toBe(false);
    expect(back.resultProvenance).toBe("two-source");
    expect(back.actualHomeGoals).toBe(1);
    expect(back.autoCheckNextAt).toBeNull();
    const manualAgain = await applyManualResult({ matchId: match.id, home: "2", away: "0", version: back.resultVersion, standingChangeConfirmed: true, reason: "official sheet", now });
    expect(manualAgain.recalculated).toBe(true);
    const sources = await db.resultObservation.findMany({ where: { matchId: match.id }, orderBy: { source: "asc" } });
    expect(sources.map((row) => [row.source, row.homeGoals, row.awayGoals])).toEqual([["premierliga", 1, 0], ["sport-ru", 1, 0]]);
    const current = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    const raced = await Promise.allSettled([
      applyManualResult({ matchId: match.id, home: "3", away: "0", version: current.resultVersion, standingChangeConfirmed: true, reason: "once", now }),
      applyManualResult({ matchId: match.id, home: "3", away: "0", version: current.resultVersion, standingChangeConfirmed: true, reason: "twice", now }),
    ]);
    expect(raced.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const afterRace = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    const rolled = await rollbackManualResult({ matchId: afterRace.id, version: afterRace.resultVersion, confirmed: true, reason: "back", now: new Date("2026-11-20T21:00:00.000Z") });
    expect(rolled.recalculated).toBe(true);
    const restored = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(restored.manuallyCorrected).toBe(false);
    expect(restored.resultState).toBe("verified");
    expect(restored.resultProvenance).toBe("two-source");
    expect(restored.actualHomeGoals).toBe(1);
    const audits = await db.resultAudit.findMany({ where: { matchId: match.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((row) => row.action)).toEqual(["confirm", "rollback", "correct", "correct", "rollback"]);
    expect(audits[0]?.nextMarker).toBe(false);
    expect(audits[2]?.nextMarker).toBe(true);
    expect(audits[0]?.actor).toBe("local-admin");
    const sameAgain = recomputeFromSources([
      { source: "sport-ru", sourceKey: "a", homeGoals: 2, awayGoals: 0, role: "primary", confidence: "high", matchStatus: "finished", completeness: "complete" },
    ]);
    expect(sameAgain.resultState).toBe("confirmed");
    expect(sameAgain.awaitingRecheck).toBe(true);
    const legacy = await db.match.create({
      data: { roundId: round.id, homeTeam: "Old", awayTeam: "Side", resultState: "verified", resultResolution: "verified", actualHomeGoals: 0, actualAwayGoals: 0 },
    });
    const storedLegacy = await db.match.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(storedLegacy.resultProvenance).toBe("");
    expect(storedLegacy.manuallyCorrected).toBe(false);
    expect(await db.resultObservation.count({ where: { matchId: legacy.id } })).toBe(0);
    const closed = await db.round.create({
      data: { seasonId: season.id, number: 14, name: "14", standingRole: "archived", closedAt: new Date("2026-11-01T00:00:00.000Z"), status: "closed" },
    });
    const closedMatch = await db.match.create({
      data: { roundId: closed.id, homeTeam: "A", awayTeam: "B", kickoffAt: kickoff, actualHomeGoals: 1, actualAwayGoals: 0, resultState: "verified" },
    });
    await expect(applyManualResult({ matchId: closedMatch.id, home: "1", away: "0", version: 0, standingChangeConfirmed: false, reason: "", now })).rejects.toBeInstanceOf(RoundClosedError);
    const archived = await db.round.create({
      data: { seasonId: season.id, number: 13, name: "13", standingRole: "archived", productionStartedAt: kickoff, status: "open" },
    });
    const archivedMatch = await db.match.create({
      data: { roundId: archived.id, homeTeam: "A", awayTeam: "B", kickoffAt: kickoff, actualHomeGoals: 1, actualAwayGoals: 0, resultState: "verified" },
    });
    await expect(applyManualResult({ matchId: archivedMatch.id, home: "1", away: "0", version: 0, standingChangeConfirmed: true, reason: "", now })).rejects.toThrow(/archived reference/);
    const later = await db.match.create({
      data: { roundId: round.id, homeTeam: "Later", awayTeam: "Side", kickoffAt: new Date("2026-12-01T16:00:00.000Z"), resultState: "open" },
    });
    await expect(applyManualResult({ matchId: later.id, home: "1", away: "0", version: 0, standingChangeConfirmed: false, reason: "", now })).rejects.toBeInstanceOf(ResultCorrectionError);
    await db.$disconnect();
  });
});
