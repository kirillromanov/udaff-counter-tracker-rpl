import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SourceFetchResult, SourceRole } from "@/lib/domain/results/types";

function row(source: string, role: SourceRole, homeTeam: string, awayTeam: string, homeGoals: number, awayGoals: number, sourceKey: string) {
  return {
    source,
    sourceKey,
    roundNumber: 16,
    homeTeam,
    awayTeam,
    homeGoals,
    awayGoals,
    role,
    confidence: "high" as const,
    matchStatus: "finished" as const,
    completeness: "complete" as const,
  };
}

function fetched(source: string, role: SourceRole, results: SourceFetchResult["results"]): SourceFetchResult {
  return { source, role, url: `https://example.test/${source}`, status: "ok", results, error: null };
}

describe("verified manually replacement", () => {
  let directory = "";
  let databaseUrl = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-replace-"));
    databaseUrl = `file:${path.join(directory, "test.db")}`;
    process.env.DATABASE_URL = databaseUrl;
    process.env.WORKER_LOCK_DIR = path.join(directory, "locks");
    delete process.env.WORKER_RESULTS_ENABLED;
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

  it("replaces a confirmed score only when two sources agree, once, with an audit and a note", async () => {
    const [{ PrismaClient }, { refreshRoundResults }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/results/poll-run"),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const season = await db.season.create({ data: { name: "replace", slug: "replace" } });
    const person = await db.participant.create({ data: { name: "Reviewer", normalizedName: "reviewer-replace" } });
    await db.seasonParticipant.create({ data: { seasonId: season.id, participantId: person.id } });
    const kickoff = new Date("2026-11-20T16:00:00.000Z");
    const round = await db.round.create({
      data: { seasonId: season.id, number: 16, name: "16", standingRole: "operational", productionStartedAt: kickoff, status: "open" },
    });
    const replaced = await db.match.create({
      data: {
        roundId: round.id,
        homeTeam: "Ростов",
        awayTeam: "Крылья Советов",
        kickoffAt: kickoff,
        actualHomeGoals: 1,
        actualAwayGoals: 0,
        resultState: "verified",
        resultResolution: "verified",
        resultProvenance: "operator-confirmed",
        resultNote: "Operator verified the score already on screen.",
      },
    });
    const held = await db.match.create({
      data: {
        roundId: round.id,
        sortOrder: 2,
        homeTeam: "Динамо",
        awayTeam: "Зенит",
        kickoffAt: kickoff,
        actualHomeGoals: 1,
        actualAwayGoals: 0,
        resultState: "verified",
        resultResolution: "verified",
        resultProvenance: "operator-confirmed",
      },
    });
    const slip = await db.predictionSet.create({
      data: { roundId: round.id, participantId: person.id, selected: true, status: "accepted" },
    });
    await db.prediction.create({ data: { predictionSetId: slip.id, matchId: replaced.id, homeGoals: 1, awayGoals: 0 } });
    const fetches = [
      fetched("sport-ru", "primary", [
        row("sport-ru", "primary", "Ростов", "Крылья Советов", 2, 0, "rostov"),
        row("sport-ru", "primary", "Динамо", "Зенит", 4, 0, "dynamo"),
      ]),
      fetched("premierliga", "fallback", [
        row("premierliga", "fallback", "Ростов", "Крылья Советов", 2, 0, "rostov"),
      ]),
    ];
    const first = await refreshRoundResults(round.id, { fetches });
    expect(first.recalculated).toBe(true);
    expect(first.updated).toBe(1);
    const changed = await db.match.findUniqueOrThrow({ where: { id: replaced.id } });
    expect(changed.actualHomeGoals).toBe(2);
    expect(changed.actualAwayGoals).toBe(0);
    expect(changed.resultProvenance).toBe("two-source");
    expect(changed.resultNote).toBe("Verified manually 1-0 was replaced by two sources with 2-0.");
    const kept = await db.match.findUniqueOrThrow({ where: { id: held.id } });
    expect(kept.actualHomeGoals).toBe(1);
    expect(kept.actualAwayGoals).toBe(0);
    expect(kept.resultConflict).toBe(true);
    expect(kept.resultProvenance).toBe("operator-confirmed");
    const audits = await db.resultAudit.findMany({ orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      matchId: replaced.id,
      action: "replace",
      actor: "automatic",
      previousHome: 1,
      previousAway: 0,
      nextHome: 2,
      nextAway: 0,
      nextMarker: false,
    });
    const second = await refreshRoundResults(round.id, { fetches });
    expect(second.recalculated).toBe(false);
    expect(second.updated).toBe(0);
    expect(await db.resultAudit.count()).toBe(1);
    const again = await db.match.findUniqueOrThrow({ where: { id: replaced.id } });
    expect(again.resultNote).toBe(changed.resultNote);
    expect(again.actualHomeGoals).toBe(2);
    expect(again.resultVersion).toBe(changed.resultVersion);
    await db.$disconnect();
  });
});
