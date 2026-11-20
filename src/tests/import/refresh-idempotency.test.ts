import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ForumPost } from "@/lib/domain/forum/types";

const kickoff = new Date("2026-11-20T18:00:00.000Z");
const postedAt = new Date("2026-11-20T07:00:00.000Z");

function line(score: string): string {
  return `20.11.2026 21:00 Ростов — Крылья Советов ${score}`;
}

function comment(externalId: string, text: string, html = "<p>note</p>"): ForumPost["comments"][number] {
  return { externalId, authorName: "Пиночет", postedAt, rawHtml: html, rawText: text };
}

function thread(comments: ForumPost["comments"], htmlNote = "note"): ForumPost {
  return {
    title: "15",
    sourceUrl: "https://example.test/round",
    openingText: "Абразцы\n20.11.2026 21:00 Ростов — Крылья Советов",
    fetchedAt: new Date("2026-11-20T11:00:00.000Z"),
    comments: comments.map((item) => ({ ...item, rawHtml: item.rawHtml === "<p>note</p>" ? `<div>${htmlNote}</div>${item.rawHtml}` : item.rawHtml })),
  };
}

describe("prediction refresh idempotency", () => {
  let directory = "";
  let databaseUrl = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-idempotent-"));
    databaseUrl = `file:${path.join(directory, "test.db")}`;
    process.env.DATABASE_URL = databaseUrl;
    process.env.WORKER_LOCK_DIR = path.join(directory, "locks");
    process.env.PREDICTION_REFRESH_INTERVAL_MINUTES = "60";
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

  it("keeps prediction rows across identical refreshes and supported recoveries", async () => {
    const [{ PrismaClient }, { createParticipant }, { refreshRoundPredictions }, { parseStoredComments }, { acquireClaim }, { EDIT_TIME_UNKNOWN_NOTE, EDIT_AFTER_KICKOFF_NOTE }, { MANUAL_PREDICTION_NOTE }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/participants/registry"),
      import("@/lib/domain/import/refresh-predictions"),
      import("@/lib/domain/import/persist-import"),
      import("@/lib/domain/worker/claims"),
      import("@/lib/domain/import/fixture-deadline"),
      import("@/lib/domain/import/incremental"),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await createParticipant("Пиночет");
      const season = await db.season.create({ data: { name: "Isolated", slug: `idempotent-${Date.now()}` } });
      await db.standingsCheckpoint.create({
        data: { seasonId: season.id, afterRoundNumber: 13, source: "manual", label: "baseline", rawText: "BASELINE" },
      });
      const round = await db.round.create({
        data: {
          seasonId: season.id,
          number: 15,
          forumUrl: "https://example.test/round",
          standingRole: "operational",
          productionStartedAt: new Date("2026-11-19T12:00:00.000Z"),
          status: "open",
          matches: { create: [{ homeTeam: "Ростов", awayTeam: "Крылья Советов", kickoffAt: kickoff, sortOrder: 1, autoCheckAttempts: 0 }] },
        },
      });
      await db.roundScore.create({
        data: {
          roundId: round.id,
          participantId: (await db.participant.findFirstOrThrow({ where: { name: "Пиночет" } })).id,
          totalPoints: 4,
          matchPoints: 4,
          roundBonusPoints: 0,
          exactCount: 1,
          neighborCount: 0,
          diffCount: 0,
          outcomeCount: 0,
          missCount: 0,
          breakdownJson: "{}",
        },
      });

      const fetch = (post: ForumPost) => refreshRoundPredictions(round.id, {
        now: new Date("2026-11-20T12:00:00.000Z"),
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => post,
      });
      const first = await fetch(thread([comment("100", line("2-1"))]));
      expect(first.failed).toBe(false);
      const created = await db.prediction.findMany({
        where: { predictionSet: { roundId: round.id } },
        include: { predictionSet: true },
      });
      expect(created).toHaveLength(1);
      expect(created[0]?.homeGoals).toBe(2);
      const predictionId = created[0]?.id ?? "";
      const setId = created[0]?.predictionSetId ?? "";
      const predictionUpdatedAt = created[0]?.updatedAt.toISOString();
      const setUpdatedAt = created[0]?.predictionSet.updatedAt.toISOString();
      const setCreatedAt = created[0]?.predictionSet.createdAt.toISOString();

      await db.forumComment.updateMany({ where: { roundId: round.id }, data: { ingestionStatus: "new" } });
      const second = await fetch(thread([comment("100", line("2-1"))], "wrapper-only"));
      expect(second.counts.unchanged).toBe(1);
      const again = await db.prediction.findUniqueOrThrow({ where: { id: predictionId }, include: { predictionSet: true } });
      expect(again.predictionSetId).toBe(setId);
      expect(again.homeGoals).toBe(2);
      expect(again.awayGoals).toBe(1);
      expect(again.updatedAt.toISOString()).toBe(predictionUpdatedAt);
      expect(again.createdAt.toISOString()).toBe(created[0]?.createdAt.toISOString());
      expect(again.predictionSet.updatedAt.toISOString()).toBe(setUpdatedAt);
      expect(again.predictionSet.createdAt.toISOString()).toBe(setCreatedAt);
      expect(again.predictionSet.selected).toBe(created[0]?.predictionSet.selected);
      expect(again.predictionSet.manuallyEdited).toBe(false);
      expect(again.predictionSet.source).toBe("import");

      await db.forumComment.updateMany({ where: { roundId: round.id }, data: { ingestionStatus: "updated" } });
      await fetch(thread([comment("100", line("2-1"))]));
      const historical = await db.prediction.findUniqueOrThrow({ where: { id: predictionId } });
      expect(historical.homeGoals).toBe(2);
      expect(historical.updatedAt.toISOString()).toBe(predictionUpdatedAt);
      const labeled = await db.forumComment.findFirstOrThrow({ where: { externalId: "100" } });
      expect(labeled.reviewNote).not.toBe(EDIT_TIME_UNKNOWN_NOTE);

      const added = await fetch(thread([comment("100", line("2-1")), comment("200", line("1-0"))]));
      expect(added.counts.new).toBe(1);
      const both = await db.prediction.findMany({ where: { predictionSet: { roundId: round.id } }, orderBy: { createdAt: "asc" } });
      expect(both.map((row) => row.id)).toContain(predictionId);
      const secondId = both.find((row) => row.id !== predictionId)?.id ?? "";
      expect(secondId).not.toBe("");
      await fetch(thread([comment("100", line("2-1")), comment("200", line("1-0"))]));
      const bothAgain = await db.prediction.findMany({ where: { predictionSet: { roundId: round.id } } });
      expect(bothAgain.map((row) => row.id).sort()).toEqual([predictionId, secondId].sort());

      await db.forumComment.create({
        data: {
          roundId: round.id,
          externalId: "300",
          sourceUrl: "https://example.test/round",
          authorName: "Пиночет",
          postedAt,
          rawHtml: "<p>pending</p>",
          rawText: line("0-0"),
          ingestionStatus: "new",
          reviewState: "stored",
        },
      });
      await fetch(thread([comment("100", line("2-1")), comment("200", line("1-0")), comment("300", line("0-0"))]));
      const recovered = await db.prediction.findFirstOrThrow({ where: { predictionSet: { forumComment: { externalId: "300" } } } });
      await fetch(thread([comment("100", line("2-1")), comment("200", line("1-0")), comment("300", line("0-0"))]));
      expect(await db.prediction.findUnique({ where: { id: recovered.id } })).toMatchObject({ homeGoals: 0, awayGoals: 0 });

      const bare = await db.round.create({
        data: {
          seasonId: season.id,
          number: 16,
          forumUrl: "https://example.test/bare",
          standingRole: "operational",
          productionStartedAt: new Date("2026-11-19T12:00:00.000Z"),
          forumComments: {
            create: {
              externalId: "400",
              sourceUrl: "https://example.test/bare",
              authorName: "Пиночет",
              postedAt,
              rawHtml: "<p>x</p>",
              rawText: line("4-0"),
              ingestionStatus: "new",
            },
          },
        },
      });
      await parseStoredComments(bare.id);
      expect(await db.prediction.count({ where: { predictionSet: { roundId: bare.id } } })).toBe(0);
      const match = await db.match.create({
        data: { roundId: bare.id, homeTeam: "Ростов", awayTeam: "Крылья Советов", kickoffAt: kickoff, sortOrder: 1 },
      });
      await parseStoredComments(bare.id);
      const afterFixtures = await db.prediction.findFirstOrThrow({ where: { predictionSet: { roundId: bare.id } } });
      expect(afterFixtures.matchId).toBe(match.id);
      await parseStoredComments(bare.id, { force: true });
      expect(await db.prediction.findUnique({ where: { id: afterFixtures.id } })).toMatchObject({ homeGoals: 4, awayGoals: 0 });

      const editedHtml = `<div class="comment-meta"><a href="#comment-100">20/11/2026 at 10:00</a> edited 20/11/2026 at 12:00</div><p>${line("3-1")}</p>`;
      await fetch(thread([comment("100", line("3-1"), editedHtml), comment("200", line("1-0")), comment("300", line("0-0"))]));
      expect(await db.prediction.findUnique({ where: { id: predictionId } })).toMatchObject({ homeGoals: 3, awayGoals: 1 });

      const lateHtml = `<div class="comment-meta"><a href="#comment-200">20/11/2026 at 10:00</a> edited 20/11/2026 at 22:00</div><p>${line("9-9")}</p>`;
      const beforeLate = await db.prediction.findUniqueOrThrow({ where: { id: secondId } });
      await fetch(thread([
        comment("100", line("3-1"), editedHtml),
        comment("200", line("9-9"), lateHtml),
        comment("300", line("0-0")),
      ]));
      expect(await db.prediction.findUnique({ where: { id: secondId } })).toMatchObject({
        homeGoals: beforeLate.homeGoals,
        awayGoals: beforeLate.awayGoals,
      });
      expect((await db.forumComment.findFirstOrThrow({ where: { externalId: "200" } })).reviewNote).toBe(EDIT_AFTER_KICKOFF_NOTE);

      const unknownBefore = await db.prediction.findUniqueOrThrow({ where: { id: recovered.id } });
      await fetch(thread([
        comment("100", line("3-1"), editedHtml),
        comment("200", line("9-9"), lateHtml),
        comment("300", line("5-5")),
      ]));
      expect(await db.prediction.findUnique({ where: { id: recovered.id } })).toMatchObject({
        homeGoals: unknownBefore.homeGoals,
        awayGoals: unknownBefore.awayGoals,
      });
      expect((await db.forumComment.findFirstOrThrow({ where: { externalId: "300" } })).reviewNote).toBe(EDIT_TIME_UNKNOWN_NOTE);
      await fetch(thread([
        comment("100", line("3-1"), editedHtml),
        comment("200", line("9-9"), lateHtml),
        comment("300", line("5-5")),
      ]));
      expect((await db.forumComment.findFirstOrThrow({ where: { externalId: "300" } })).reviewNote).toBe(EDIT_TIME_UNKNOWN_NOTE);
      expect(await db.prediction.findUnique({ where: { id: recovered.id } })).toMatchObject({
        homeGoals: unknownBefore.homeGoals,
      });

      const participant = await db.participant.findFirstOrThrow({ where: { name: "Пиночет" } });
      const manualComment = await db.forumComment.create({
        data: {
          roundId: round.id,
          externalId: "500",
          sourceUrl: "https://example.test/round",
          authorName: "Пиночет",
          postedAt,
          rawHtml: "<p>manual</p>",
          rawText: line("2-2"),
          ingestionStatus: "unchanged",
        },
      });
      const manualSet = await db.predictionSet.create({
        data: {
          roundId: round.id,
          participantId: participant.id,
          forumCommentId: manualComment.id,
          source: "manual",
          rawComment: line("2-2"),
          status: "accepted",
          selected: true,
          selection: "manual",
          manuallyEdited: true,
          predictions: { create: [{ matchId: (await db.match.findFirstOrThrow({ where: { roundId: round.id } })).id, homeGoals: 2, awayGoals: 2 }] },
        },
        include: { predictions: true },
      });
      await fetch(thread([
        comment("100", line("3-1"), editedHtml),
        comment("200", line("9-9"), lateHtml),
        comment("300", line("5-5")),
        comment("500", line("8-8")),
      ]));
      expect(await db.prediction.findUnique({ where: { id: manualSet.predictions[0]?.id } })).toMatchObject({ homeGoals: 2, awayGoals: 2 });
      expect((await db.forumComment.findFirstOrThrow({ where: { externalId: "500" } })).reviewNote).toBe(MANUAL_PREDICTION_NOTE);
      expect((await db.predictionSet.findUniqueOrThrow({ where: { id: manualSet.id } })).manuallyEdited).toBe(true);

      const closed = await db.round.create({
        data: {
          seasonId: season.id,
          number: 14,
          forumUrl: "https://example.test/closed",
          standingRole: "operational",
          productionStartedAt: new Date("2026-11-01T00:00:00.000Z"),
          closedAt: new Date("2026-11-02T00:00:00.000Z"),
          matches: { create: [{ homeTeam: "Ростов", awayTeam: "Крылья Советов", kickoffAt: kickoff, sortOrder: 1 }] },
        },
        include: { matches: true },
      });
      const closedSet = await db.predictionSet.create({
        data: { roundId: closed.id, participantId: participant.id, source: "import", rawComment: line("1-1"), status: "accepted" },
      });
      const closedPrediction = await db.prediction.create({
        data: { predictionSetId: closedSet.id, matchId: closed.matches[0]?.id ?? "", homeGoals: 1, awayGoals: 1 },
      });
      await expect(refreshRoundPredictions(closed.id, {
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => thread([comment("900", line("0-1"))]),
      })).rejects.toMatchObject({ name: "RoundClosedError" });
      expect(await db.prediction.findUnique({ where: { id: closedPrediction.id } })).toMatchObject({ homeGoals: 1, awayGoals: 1 });

      const held = await acquireClaim(process.env.WORKER_LOCK_DIR ?? "", `prediction-${round.id}`);
      const busy = await refreshRoundPredictions(round.id, {
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => {
          throw new Error("should not fetch");
        },
      });
      expect(busy.busy).toBe(true);
      await held?.();

      expect(await db.roundScore.count()).toBe(1);
      expect(await db.match.findFirstOrThrow({ where: { roundId: round.id } })).toMatchObject({ autoCheckAttempts: 0 });
      expect(await db.standingsCheckpoint.findFirstOrThrow()).toMatchObject({ rawText: "BASELINE" });
    } finally {
      await db.$disconnect();
    }
  });
});
