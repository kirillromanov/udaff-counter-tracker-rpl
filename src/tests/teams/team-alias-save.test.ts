import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("saving team spellings", () => {
  let directory = "";
  let databaseUrl = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-team-alias-"));
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

  it("writes only the spelling tables", async () => {
    const [{ PrismaClient }, { saveTeamAliases }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/teams/save-aliases"),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const season = await db.season.create({ data: { name: "Spellings", slug: `spellings-${Date.now()}` } });
      const round = await db.round.create({
        data: {
          seasonId: season.id,
          number: 16,
          status: "open",
          standingRole: "operational",
          matches: { create: [{ homeTeam: "Локомотив", awayTeam: "Динамо Мх", sortOrder: 1 }, { homeTeam: "Крылья Советов", awayTeam: "Динамо", sortOrder: 2 }] },
        },
      });
      const comment = await db.forumComment.create({
        data: {
          roundId: round.id,
          externalId: "1",
          sourceUrl: "https://example.test/spellings",
          authorName: "neofit",
          postedAt: new Date("2026-11-27T10:00:00.000Z"),
          rawHtml: "<p>x</p>",
          rawText: "Локомотив — Махачкала 1-1",
          ingestionStatus: "flagged",
          reviewState: "flagged",
        },
      });
      const person = await db.participant.create({ data: { name: "neofit", normalizedName: "neofit" } });
      const set = await db.predictionSet.create({
        data: { roundId: round.id, participantId: person.id, forumCommentId: comment.id, source: "import", status: "flagged" },
      });
      const beforeComment = comment.updatedAt.toISOString();
      const beforeSet = set.updatedAt.toISOString();

      await saveTeamAliases([
        { name: "Динамо Мх", aliases: ["Махачкала", "Динамо Махачкала", ""] },
        { name: "Динамо", aliases: ["", "", ""] },
      ]);
      expect(await db.teamNameAlias.count()).toBe(2);
      expect((await db.forumComment.findUniqueOrThrow({ where: { id: comment.id } })).updatedAt.toISOString()).toBe(beforeComment);
      expect((await db.predictionSet.findUniqueOrThrow({ where: { id: set.id } })).updatedAt.toISOString()).toBe(beforeSet);
      expect(await db.prediction.count()).toBe(0);

      await expect(saveTeamAliases([{ name: "Динамо Мх", aliases: ["Динамо", "", ""] }])).rejects.toThrow(/Динамо/);
      expect(await db.teamNameAlias.count()).toBe(2);
    } finally {
      await db.$disconnect();
    }
  });
});