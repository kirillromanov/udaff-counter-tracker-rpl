import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ForumPost } from "@/lib/domain/forum/types";

const source = process.env.PREDICTION_IDEMPOTENCY_SNAPSHOT;

describe.skipIf(!source)("repeated refresh of a private round snapshot", () => {
  let directory = "";

  afterAll(() => {
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves round 15 prediction ids and protected comments", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-snapshot-"));
    const databaseUrl = `file:${path.join(directory, "snapshot.db")}`;
    execFileSync("sqlite3", [source ?? "", `.backup '${path.join(directory, "snapshot.db")}'`], { stdio: "pipe" });
    execFileSync("sqlite3", [path.join(directory, "snapshot.db"), "PRAGMA integrity_check;"], { stdio: "pipe" });
    process.env.DATABASE_URL = databaseUrl;
    process.env.WORKER_LOCK_DIR = path.join(directory, "locks");
    process.env.PREDICTION_REFRESH_INTERVAL_MINUTES = "60";
    delete process.env.WORKER_ENABLED;
    delete process.env.WORKER_RESULTS_ENABLED;

    const [{ PrismaClient }, { refreshRoundPredictions }, { EDIT_TIME_UNKNOWN_NOTE }] = await Promise.all([
      import("@prisma/client"),
      import("@/lib/domain/import/refresh-predictions"),
      import("@/lib/domain/import/fixture-deadline"),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const round = await db.round.findFirstOrThrow({ where: { number: 15 } });
      const beforePredictions = await db.prediction.findMany({
        where: { predictionSet: { roundId: round.id } },
        orderBy: { id: "asc" },
      });
      const beforeSets = await db.predictionSet.findMany({ where: { roundId: round.id }, orderBy: { id: "asc" } });
      const comments = await db.forumComment.findMany({ where: { roundId: round.id }, orderBy: { externalId: "asc" } });
      const protectedBefore = await db.forumComment.findMany({
        where: { roundId: round.id, externalId: { in: ["5707", "5713", "5714"] } },
        include: { predictionSets: { include: { predictions: true } } },
      });
      const scores = await db.roundScore.count();
      const attempts = await db.match.findMany({ where: { roundId: round.id }, orderBy: { sortOrder: "asc" } });
      const checkpoints = await db.standingsCheckpoint.count();
      const checkpointRows = await db.standingsCheckpointRow.count();
      const otherRounds = await db.round.findMany({
        where: { number: { not: 15 } },
        select: { id: true, number: true, nextPredictionFetchAt: true, lastPredictionFetchAt: true },
      });

      const post: ForumPost = {
        title: round.name ?? "15",
        sourceUrl: round.forumUrl ?? "",
        openingText: round.sourceSnapshot ?? "",
        fetchedAt: new Date("2026-11-20T08:00:00.000Z"),
        comments: comments.flatMap((comment) => comment.externalId ? [{
          externalId: comment.externalId,
          authorName: comment.authorName,
          postedAt: comment.postedAt,
          rawHtml: comment.rawHtml,
          rawText: comment.rawText,
        }] : []),
      };
      const run = () => refreshRoundPredictions(round.id, {
        now: new Date("2026-11-20T08:00:00.000Z"),
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => post,
      });
      const first = await run();
      const second = await run();
      expect(first.failed).toBe(false);
      expect(second.failed).toBe(false);
      expect(first.counts.new).toBe(0);
      expect(second.counts.unchanged).toBe(comments.length);

      const afterPredictions = await db.prediction.findMany({
        where: { predictionSet: { roundId: round.id } },
        orderBy: { id: "asc" },
      });
      expect(afterPredictions.map((row) => ({
        id: row.id,
        setId: row.predictionSetId,
        matchId: row.matchId,
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
        ignored: row.ignored,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }))).toEqual(beforePredictions.map((row) => ({
        id: row.id,
        setId: row.predictionSetId,
        matchId: row.matchId,
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
        ignored: row.ignored,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })));
      const afterSets = await db.predictionSet.findMany({ where: { roundId: round.id }, orderBy: { id: "asc" } });
      expect(afterSets.map((set) => ({
        id: set.id,
        selected: set.selected,
        manuallyEdited: set.manuallyEdited,
        selection: set.selection,
        source: set.source,
        status: set.status,
        createdAt: set.createdAt.toISOString(),
        updatedAt: set.updatedAt.toISOString(),
      }))).toEqual(beforeSets.map((set) => ({
        id: set.id,
        selected: set.selected,
        manuallyEdited: set.manuallyEdited,
        selection: set.selection,
        source: set.source,
        status: set.status,
        createdAt: set.createdAt.toISOString(),
        updatedAt: set.updatedAt.toISOString(),
      })));

      const protectedAfter = await db.forumComment.findMany({
        where: { roundId: round.id, externalId: { in: ["5707", "5713", "5714"] } },
        include: { predictionSets: { include: { predictions: true } } },
      });
      for (const externalId of ["5707", "5713"]) {
        const before = protectedBefore.find((comment) => comment.externalId === externalId);
        const after = protectedAfter.find((comment) => comment.externalId === externalId);
        expect(after?.reviewNote).toBe(EDIT_TIME_UNKNOWN_NOTE);
        expect(after?.predictionSets.map((set) => set.id)).toEqual(before?.predictionSets.map((set) => set.id));
        expect(after?.predictionSets.flatMap((set) => set.predictions.map((row) => row.id)).sort())
          .toEqual(before?.predictionSets.flatMap((set) => set.predictions.map((row) => row.id)).sort());
      }
      const comment5714 = protectedAfter.filter((comment) => comment.externalId === "5714");
      expect(comment5714).toHaveLength(1);
      expect(comment5714[0]?.predictionSets).toHaveLength(1);
      expect(comment5714[0]?.predictionSets[0]?.id).toBe(
        protectedBefore.find((comment) => comment.externalId === "5714")?.predictionSets[0]?.id,
      );

      expect(await db.roundScore.count()).toBe(scores);
      expect(await db.standingsCheckpoint.count()).toBe(checkpoints);
      expect(await db.standingsCheckpointRow.count()).toBe(checkpointRows);
      const attemptsAfter = await db.match.findMany({ where: { roundId: round.id }, orderBy: { sortOrder: "asc" } });
      expect(attemptsAfter.map((match) => [match.autoCheckAttempts, match.autoCheckNextAt?.toISOString() ?? null]))
        .toEqual(attempts.map((match) => [match.autoCheckAttempts, match.autoCheckNextAt?.toISOString() ?? null]));
      for (const other of otherRounds) {
        const current = await db.round.findUniqueOrThrow({ where: { id: other.id } });
        expect(current.nextPredictionFetchAt?.toISOString() ?? null).toBe(other.nextPredictionFetchAt?.toISOString() ?? null);
        expect(current.lastPredictionFetchAt?.toISOString() ?? null).toBe(other.lastPredictionFetchAt?.toISOString() ?? null);
      }

      const closed = await db.round.findFirstOrThrow({ where: { number: 14 } });
      const closedPrediction = await db.prediction.findFirstOrThrow({ where: { predictionSet: { roundId: closed.id } } });
      await expect(refreshRoundPredictions(closed.id, {
        claimDir: process.env.WORKER_LOCK_DIR,
        fetchPost: async () => post,
      })).rejects.toMatchObject({ name: "RoundClosedError" });
      expect(await db.prediction.findUnique({ where: { id: closedPrediction.id } })).toMatchObject({
        homeGoals: closedPrediction.homeGoals,
        awayGoals: closedPrediction.awayGoals,
      });
    } finally {
      await db.$disconnect();
    }
  });
});
