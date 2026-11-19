import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFixtureSchedule } from "@/lib/domain/forum/parse-schedule";
import { planFixtureCreate } from "@/lib/domain/import/ensure-fixtures";
import { selectDuePredictionRoundIds } from "@/lib/domain/import/incremental";
import { parseComment, rowsForStorage } from "@/lib/domain/parser/parse-comment";
import { cellText } from "@/lib/domain/import/save-matrix";
import { cleanMatrixTotalLabel, roundLayerLabel } from "@/lib/domain/review/operator-status";
import { assertOpen } from "@/lib/domain/rounds/round-lock";
import { countsTowardProduction, OPERATIONAL_ROUND } from "@/lib/domain/standings/round-role";

const opening = "20.11.2026 19:30 Ростов — Крылья Советов";
const comment = "20.11.2026 19:30 Ростов — Крылья Советов 1:0";

describe("open draft review without fixtures", () => {
  it("keeps a saved prediction comment unstored until the opening-post fixture exists", () => {
    expect(rowsForStorage(parseComment(comment, []))).toEqual([]);
    const schedule = parseFixtureSchedule(opening);
    expect(planFixtureCreate(0, schedule)).toBe("create");
    expect(planFixtureCreate(8, schedule)).toBe("keep");
    expect(planFixtureCreate(0, parseFixtureSchedule("no schedule here"))).toBe("none");

    const fixtures = schedule.fixtures.map((fixture, index) => ({
      id: `fixture-${index}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
    }));
    const rows = rowsForStorage(parseComment(comment, fixtures));
    expect(rows).toEqual([
      expect.objectContaining({ fixtureId: "fixture-0", homeGoals: 1, awayGoals: 0 }),
    ]);
    expect(cellText(rows[0]?.homeGoals, rows[0]?.awayGoals, false)).toBe("1-0");
  });

  it("calls an open round Draft and still shows a stored cell while the total is preliminary", () => {
    expect(roundLayerLabel("open", 0, OPERATIONAL_ROUND)).toBe("Draft");
    expect(roundLayerLabel("open", 0)).toBe("Draft");
    expect(countsTowardProduction(OPERATIONAL_ROUND, 15, 13)).toBe(true);
    expect(
      cleanMatrixTotalLabel({
        reviewOnly: false,
        confirmed: false,
        counted: 0,
        fixtureCount: 0,
        storedTotal: null,
        calculatedTotal: 0,
      }),
    ).toBe("preliminary");
    expect(
      cleanMatrixTotalLabel({
        reviewOnly: false,
        confirmed: false,
        counted: 0,
        fixtureCount: 1,
        storedTotal: null,
        calculatedTotal: 0,
      }),
    ).toBe("preliminary");
    expect(cellText(1, 0, false)).toBe("1-0");
  });

  it("creates missing fixtures before parsing and still refuses a closed round", () => {
    const refresh = readFileSync("src/lib/domain/import/refresh-predictions.ts", "utf8");
    const ensureAt = refresh.indexOf("ensureRoundFixtures");
    const parseAt = refresh.indexOf("parseStoredComments");
    expect(ensureAt).toBeGreaterThan(-1);
    expect(parseAt).toBeGreaterThan(ensureAt);
    expect(refresh.indexOf("assertRoundMutable")).toBeLessThan(ensureAt);

    const creator = readFileSync("src/lib/domain/import/ensure-fixtures.ts", "utf8");
    expect(creator.indexOf("assertRoundMutable")).toBeLessThan(creator.indexOf("match.createMany"));

    expect(() => assertOpen(new Date("2026-11-19T12:00:00.000Z"))).toThrow(/Тур закрыт/);
    expect(
      selectDuePredictionRoundIds(
        [
          {
            id: "round-15",
            standingRole: OPERATIONAL_ROUND,
            forumUrl: "https://example.test/15",
            nextPredictionFetchAt: new Date("2026-11-19T12:00:00.000Z"),
            closedAt: new Date("2026-11-19T12:00:00.000Z"),
            matches: [],
          },
        ],
        new Date("2026-11-19T13:00:00.000Z"),
        { regularMinutes: 60, liveMinutes: 15 },
        "round-15",
      ),
    ).toEqual([]);
  });
});
