import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { participantKey } from "@/lib/domain/import/participant-key";
import { roundsSelectedForIngest, roundsWritableByIngest } from "@/lib/domain/results/ingest";
import { buildDiagnosticReport, readonlyDatabaseUrl } from "@/lib/domain/standings/diagnostic-replay";
import type { IdentityCatalog } from "@/lib/domain/participants/resolve-author";

const catalog: IdentityCatalog = {
  participants: [{ id: "p", name: "Hordi Cruyff", normalized: participantKey("Hordi Cruyff") }],
  aliases: [],
  ignored: [{ name: "LAX", normalized: participantKey("LAX") }],
};

const fixture = {
  id: "m1",
  homeTeam: "Ахмат",
  awayTeam: "Оренбург",
  isMatchOfTheRound: false,
  actualHomeGoals: 2 as number | null,
  actualAwayGoals: 1 as number | null,
  resultState: "verified",
  resultConflict: false,
  provenance: "manual",
};

describe("diagnostic replay", () => {
  it("scores a parsed slip without borrowing the baseline", () => {
    const report = buildDiagnosticReport({
      catalog,
      baseline: [{ participantId: "p", name: "Hordi Cruyff", rank: 1, totalPoints: 310 }],
      rounds: [{
        number: 12,
        sourceUrl: "https://example.test/12",
        fetchStatus: "fetched",
        fetchError: null,
        pagesFetched: 1,
        pageErrors: [],
        comments: [{
          id: "c1",
          authorName: "Hordi Cruyff",
          postedAt: new Date("2026-10-23T10:00:00Z"),
          rawText: "23.10.2026 19:30 Ахмат — Оренбург 2-1",
        }],
        fixtures: [fixture],
        scheduleFixtures: [],
      }],
    });

    expect(report.comparison).toBe("complete");
    expect(report.participants[0]).toMatchObject({
      computedPoints: 13,
      baselinePoints: 310,
      delta: -297,
    });
  });

  it("leaves a missing result at zero instead of using the baseline", () => {
    const report = buildDiagnosticReport({
      catalog,
      baseline: [{ participantId: "p", name: "Hordi Cruyff", rank: 1, totalPoints: 310 }],
      rounds: [{
        number: 13,
        sourceUrl: "https://example.test/13",
        fetchStatus: "fetched",
        fetchError: null,
        pagesFetched: 1,
        pageErrors: [],
        comments: [{
          id: "c1",
          authorName: "Hordi Cruyff",
          postedAt: new Date("2026-10-30T10:00:00Z"),
          rawText: "Ахмат - Оренбург 2-1",
        }],
        fixtures: [{ ...fixture, actualHomeGoals: null, actualAwayGoals: null, resultState: "open" }],
        scheduleFixtures: [],
      }],
    });

    expect(report.comparison).toBe("partial");
    expect(report.rounds[0]?.scored).toBe(false);
    expect(report.participants[0]?.computedPoints).toBe(0);
    expect(report.participants[0]?.computedPoints).not.toBe(310);
  });

  it("does not give the scorer a database handle", () => {
    const source = readFileSync("src/lib/domain/standings/diagnostic-replay.ts", "utf8");
    expect(source).not.toContain("prisma");
    expect(readonlyDatabaseUrl("file:./dev.db", "/tmp/prisma")).toBe("file:/tmp/prisma/dev.db?mode=readonly");
    expect(roundsSelectedForIngest(
      [
        { id: "old", standingRole: "archived" },
        { id: "next", standingRole: "operational" },
      ],
      { onlyRoundIds: ["old"] },
    ).map((round) => round.id)).toEqual(["old"]);
    expect(roundsWritableByIngest(
      [
        { id: "old", standingRole: "archived" },
        { id: "next", standingRole: "operational" },
      ],
      ["old"],
    ).map((round) => round.id)).toEqual(["old", "next"]);
  });
});
