import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectDuePredictionRoundIds } from "@/lib/domain/import/incremental";
import { selectDueRoundIds, type PollFixture } from "@/lib/domain/results/poll";
import {
  CLOSED_ROUND_MESSAGE,
  RoundClosedError,
  appendClosureLog,
  assertOpen,
  assertTargetOpen,
  closureWarning,
  planClose,
  planReopen,
  productionLockLabel,
  writableRoundIds,
} from "@/lib/domain/rounds/round-lock";
import { countsTowardProduction } from "@/lib/domain/standings/round-role";

const at = new Date("2026-11-08T18:00:00.000Z");
const openProduction = { standingRole: "operational", closedAt: null, closureLog: "[]" };

function fixture(): PollFixture {
  return {
    kickoffAt: new Date("2026-11-08T14:00:00.000Z"),
    actualHomeGoals: null,
    actualAwayGoals: null,
    resultState: "open",
    resultResolution: "",
    resultConflict: false,
    conflictAcknowledgedAt: null,
    autoCheckAttempts: 2,
    autoCheckNextAt: new Date("2026-11-08T17:00:00.000Z"),
  };
}

describe("round lock transitions", () => {
  it("closes a production round and reopens it without touching other fields", () => {
    const closed = planClose(openProduction, at);
    expect(closed.changed).toBe(true);
    expect(closed.closedAt?.toISOString()).toBe(at.toISOString());
    expect(JSON.parse(closed.closureLog)).toEqual([{ action: "closed", at: at.toISOString() }]);

    const again = planClose({ ...openProduction, closedAt: closed.closedAt, closureLog: closed.closureLog }, new Date("2026-11-08T19:00:00.000Z"));
    expect(again.changed).toBe(false);
    expect(again.closedAt?.toISOString()).toBe(at.toISOString());
    expect(again.closureLog).toBe(closed.closureLog);
    expect(Object.keys(closed).sort()).toEqual(["changed", "closedAt", "closureLog"]);

    const reopened = planReopen({ ...openProduction, closedAt: closed.closedAt, closureLog: closed.closureLog }, new Date("2026-11-08T20:00:00.000Z"));
    expect(reopened.changed).toBe(true);
    expect(reopened.closedAt).toBeNull();
    expect(JSON.parse(reopened.closureLog)).toEqual([
      { action: "closed", at: at.toISOString() },
      { action: "reopened", at: "2026-11-08T20:00:00.000Z" },
    ]);
    const idle = planReopen(openProduction, at);
    expect(idle.changed).toBe(false);
    expect(idle.closureLog).toBe("[]");
  });

  it("leaves an existing open round open and refuses to close an archived round", () => {
    expect(planClose(openProduction, at).changed).toBe(true);
    expect(() => planClose({ standingRole: "archived", closedAt: null, closureLog: "[]" }, at)).toThrow(/production round/);
    expect(productionLockLabel("operational", null)).toBe("Production");
    expect(productionLockLabel("operational", at)).toBe("Closed");
    expect(productionLockLabel("archived", null)).toBe("Archived reference");
  });

  it("rejects a closed-round mutation with the operator message", () => {
    expect(() => assertOpen(at)).toThrow(RoundClosedError);
    expect(() => assertOpen(at)).toThrow(CLOSED_ROUND_MESSAGE);
    expect(() => assertOpen(null)).not.toThrow();
    expect(() => assertTargetOpen("round-14", new Set(["round-14"]))).toThrow(CLOSED_ROUND_MESSAGE);
    expect(writableRoundIds(["round-13", "round-14"], new Set(["round-14"]))).toEqual(["round-13"]);
  });

  it("compares close-button edits against saved values, including an unselected menu", () => {
    const controls = readFileSync("src/app/admin/rounds/[roundId]/round-lock-controls.tsx", "utf8");
    expect(controls).toContain("hasUnsavedFieldEdits");
    expect(controls).not.toContain("defaultSelected");
  });

  it("warns about incomplete data and does not invent a completion step", () => {
    expect(closureWarning({ unverifiedFixtures: 0, unresolvedReviews: 0 })).toBeNull();
    expect(closureWarning({ unverifiedFixtures: 4, unresolvedReviews: 1 })).toContain("does not complete or change");
  });

  it("keeps a closed production round in season totals", () => {
    expect(countsTowardProduction("operational", 14, 13)).toBe(true);
    expect(countsTowardProduction("archived", 13, 13)).toBe(false);
  });

  it("labels a closed production round Closed without changing its standing contribution", () => {
    expect(productionLockLabel("operational", null)).toBe("Production");
    expect(productionLockLabel("operational", at)).toBe("Closed");
    expect(productionLockLabel("archived", null)).toBe("Archived reference");
    expect(productionLockLabel("archived", at)).toBe("Archived reference");
    expect(countsTowardProduction("operational", 14, 13)).toBe(true);

    const seasonPage = readFileSync("src/app/admin/seasons/[seasonId]/page.tsx", "utf8");
    expect(seasonPage).toContain("productionLockLabel(round.standingRole, round.closedAt)");
    expect(seasonPage).toContain(">Status<");
    expect(seasonPage).not.toContain("standingRoleLabel");

    const actions = readFileSync("src/app/admin/rounds/[roundId]/workflow-actions.ts", "utf8");
    const closeBody = actions.slice(actions.indexOf("export async function closeRoundAction"));
    const reopenStart = closeBody.indexOf("export async function reopenRoundAction");
    expect(closeBody.slice(0, reopenStart)).toContain("revalidateSeasonRoundList(round.seasonId)");
    expect(closeBody.slice(reopenStart)).toContain("revalidateSeasonRoundList(round.seasonId)");
    expect(actions).toContain("revalidatePath(`/admin/seasons/${seasonId}`)");
  });

  it("does not schedule or force a closed round, and reopening keeps the stored retry time", () => {
    const rounds = [
      { id: "open", nextPollAt: new Date("2026-11-08T17:00:00.000Z"), standingRole: "operational", matches: [fixture()] },
      { id: "closed", nextPollAt: new Date("2026-11-08T17:00:00.000Z"), standingRole: "operational", closedAt: at, matches: [fixture()] },
    ];
    expect(selectDueRoundIds(rounds, new Date("2026-11-08T18:00:00.000Z"), { regularMinutes: 60, liveMinutes: 15 })).toEqual(["open"]);
    expect(selectDueRoundIds(rounds, new Date("2026-11-08T18:00:00.000Z"), { regularMinutes: 60, liveMinutes: 15 }, "closed")).toEqual(["open"]);
    expect(
      selectDuePredictionRoundIds(
        [
          { id: "open", standingRole: "operational", forumUrl: "https://example.test/open", nextPredictionFetchAt: new Date("2026-11-08T17:00:00.000Z"), matches: [fixture()] },
          { id: "closed", standingRole: "operational", forumUrl: "https://example.test/closed", nextPredictionFetchAt: new Date("2026-11-08T17:00:00.000Z"), closedAt: at, matches: [fixture()] },
        ],
        new Date("2026-11-08T18:00:00.000Z"),
        { regularMinutes: 60, liveMinutes: 15 },
        "closed",
      ),
    ).toEqual(["open"]);
    const attempts = 2;
    const nextPollAt = fixture().autoCheckNextAt;
    const reopened = planReopen({ ...openProduction, closedAt: at, closureLog: appendClosureLog("[]", "closed", at) }, new Date("2026-11-08T20:00:00.000Z"));
    expect(reopened.changed).toBe(true);
    expect(attempts).toBe(2);
    expect(nextPollAt?.toISOString()).toBe("2026-11-08T17:00:00.000Z");
  });
});
