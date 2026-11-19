import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ensureRoundFixtures } from "@/lib/domain/import/ensure-fixtures";
import { selectDuePredictionRoundIds } from "@/lib/domain/import/incremental";
import { selectDueRoundIds } from "@/lib/domain/results/poll";
import { closeProductionRound, reopenProductionRound, startProductionRound } from "@/lib/domain/rounds/round-lock-db";
import type { ForumPost } from "@/lib/domain/forum/types";

const opening = ["Абразцы на шестнадцатый", "Пояснение перед списком.", "20.11.2026 19:30 Ростов — Крылья Советов"].join("\n");

function source(): ForumPost {
  return {
    title: "16-й тур",
    sourceUrl: "https://example.test/16",
    openingText: opening,
    fetchedAt: new Date("2026-11-19T12:00:00.000Z"),
    comments: [],
  };
}

describe("production activation on an isolated database", () => {
  let db: PrismaClient;
  let directory = "";
  let seasonId = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-activation-"));
    const databaseUrl = `file:${path.join(directory, "test.db")}`;
    execFileSync(path.resolve("node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--accept-data-loss"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }, 60_000);

  afterAll(async () => {
    await db?.$disconnect();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts in preparation, allows a manual fixture bootstrap, and skips automatic jobs", async () => {
    const season = await db.season.create({ data: { name: "Isolated", slug: `isolated-${Date.now()}` } });
    seasonId = season.id;
    const round = await db.round.create({
      data: { seasonId, number: 16, name: "Preparation", status: "open", standingRole: "operational" },
    });
    expect(round.productionStartedAt).toBeNull();
    await db.round.update({ where: { id: round.id }, data: { forumUrl: "https://example.test/16" } });
    const fixtures = await ensureRoundFixtures(round.id, source(), {
      db,
      assertMutable: async () => undefined,
    });
    expect(fixtures.created).toBe(true);
    expect(fixtures.createdFixtures).toHaveLength(1);
    const stored = await db.round.findUniqueOrThrow({
      where: { id: round.id },
      include: { matches: true, predictionSets: true, roundScores: true },
    });
    expect(stored.productionStartedAt).toBeNull();
    expect(stored.matches).toHaveLength(1);
    expect(stored.predictionSets).toHaveLength(0);
    expect(stored.roundScores).toHaveLength(0);
    expect(stored.importNotes).toContain("Fixture source: article_body");
    const dueInput = {
      id: stored.id,
      standingRole: stored.standingRole,
      forumUrl: stored.forumUrl,
      nextPredictionFetchAt: null,
      nextPollAt: null,
      productionStartedAt: stored.productionStartedAt,
      matches: stored.matches.map((match) => ({
        kickoffAt: match.kickoffAt,
        actualHomeGoals: match.actualHomeGoals,
        actualAwayGoals: match.actualAwayGoals,
        resultState: match.resultState,
        resultResolution: match.resultResolution,
        resultConflict: match.resultConflict,
        conflictAcknowledgedAt: match.conflictAcknowledgedAt,
      })),
    };
    const now = new Date("2026-11-21T12:00:00.000Z");
    expect(selectDuePredictionRoundIds([dueInput], now, { regularMinutes: 60, liveMinutes: 15 })).toEqual([]);
    expect(selectDueRoundIds([dueInput], now, { regularMinutes: 60, liveMinutes: 15 })).toEqual([]);

    const started = await startProductionRound(round.id, new Date("2026-11-19T18:00:00.000Z"), db);
    expect(started.changed).toBe(true);
    const active = await db.round.findUniqueOrThrow({ where: { id: round.id }, include: { matches: true, roundScores: true } });
    expect(active.productionStartedAt?.toISOString()).toBe("2026-11-19T18:00:00.000Z");
    expect(active.matches).toHaveLength(1);
    expect(active.roundScores).toHaveLength(0);
    expect(JSON.parse(active.closureLog)).toEqual([{ action: "started", at: "2026-11-19T18:00:00.000Z" }]);
    expect(selectDueRoundIds([{ ...dueInput, productionStartedAt: active.productionStartedAt }], now, { regularMinutes: 60, liveMinutes: 15 })).toEqual([
      round.id,
    ]);

    const again = await startProductionRound(round.id, new Date("2026-11-19T19:00:00.000Z"), db);
    expect(again.changed).toBe(false);
    const [first, second] = await Promise.all([
      startProductionRound(round.id, new Date("2026-11-19T20:00:00.000Z"), db),
      startProductionRound(round.id, new Date("2026-11-19T21:00:00.000Z"), db),
    ]);
    expect(first.changed || second.changed).toBe(false);
    const once = await db.round.findUniqueOrThrow({ where: { id: round.id } });
    expect(once.productionStartedAt?.toISOString()).toBe("2026-11-19T18:00:00.000Z");
    expect(JSON.parse(once.closureLog).filter((event: { action: string }) => event.action === "started")).toHaveLength(1);

    await closeProductionRound(round.id, new Date("2026-11-20T12:00:00.000Z"), db);
    const reopened = await reopenProductionRound(round.id, new Date("2026-11-20T13:00:00.000Z"), db);
    expect(reopened.changed).toBe(true);
    const restored = await db.round.findUniqueOrThrow({ where: { id: round.id } });
    expect(restored.closedAt).toBeNull();
    expect(restored.productionStartedAt?.toISOString()).toBe("2026-11-19T18:00:00.000Z");
    expect(selectDueRoundIds([{ ...dueInput, productionStartedAt: restored.productionStartedAt, closedAt: null }], now, {
      regularMinutes: 60,
      liveMinutes: 15,
    })).toEqual([round.id]);
  });

  it("keeps an already activated round active and does not fetch during start", async () => {
    const existing = await db.round.create({
      data: {
        seasonId,
        number: 15,
        name: "Already active",
        status: "open",
        standingRole: "operational",
        forumUrl: "https://example.test/15",
        productionStartedAt: new Date("2026-11-01T00:00:00.000Z"),
        matches: { create: { homeTeam: "Ростов", awayTeam: "Крылья Советов", sortOrder: 1 } },
      },
    });
    const result = await startProductionRound(existing.id, new Date("2026-11-19T18:00:00.000Z"), db);
    expect(result.changed).toBe(false);
    const saved = await db.round.findUniqueOrThrow({ where: { id: existing.id }, include: { matches: true } });
    expect(saved.productionStartedAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(saved.closureLog).toBe("[]");
    expect(saved.matches).toHaveLength(1);
    const starter = readFileSync("src/lib/domain/rounds/round-lock-db.ts", "utf8");
    const body = starter.slice(starter.indexOf("export async function startProductionRound"));
    expect(body).not.toContain("fetchForum");
    expect(body).not.toContain("parseStoredComments");
    expect(body).not.toContain("recalculate");
    const controls = readFileSync("src/app/admin/rounds/[roundId]/round-lock-controls.tsx", "utf8");
    expect(controls).toContain("Start production");
    expect(controls).toContain("hasUnsavedFieldEdits");
    expect(controls).toContain("Save or cancel the open edits before starting production.");
  });
});
