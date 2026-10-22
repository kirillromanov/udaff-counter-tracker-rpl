import { describe, expect, it } from "vitest";
import {
  fixtureBlocksPolling,
  fixturePhase,
  isPollDue,
  planRoundPoll,
  selectDueRoundIds,
  sourceHealthSummary,
  strongestSuccessfulSource,
  type PollFixture,
} from "@/lib/domain/results/poll";

const now = new Date("2026-10-22T18:00:00Z");
const intervals = { regularMinutes: 60, liveMinutes: 15 };

function fixture(overrides: Partial<PollFixture> = {}): PollFixture {
  return {
    kickoffAt: new Date("2026-10-22T16:00:00Z"),
    actualHomeGoals: null,
    actualAwayGoals: null,
    resultState: "open",
    resultResolution: "",
    resultConflict: false,
    conflictAcknowledgedAt: null,
    ...overrides,
  };
}

describe("fixture poll phases", () => {
  it("moves from scheduled to live, then unverified, verified, or conflict review", () => {
    expect(fixturePhase(fixture({ kickoffAt: new Date("2026-10-22T20:00:00Z") }), now)).toBe("scheduled");
    expect(fixturePhase(fixture(), now)).toBe("live");
    expect(fixturePhase(fixture({ liveReported: true, kickoffAt: new Date("2026-10-22T20:00:00Z") }), now)).toBe("live");
    expect(fixturePhase(fixture({ actualHomeGoals: 2, actualAwayGoals: 2, resultState: "confirmed", resultResolution: "provisional" }), now)).toBe("finished-unverified");
    expect(fixturePhase(fixture({ actualHomeGoals: 2, actualAwayGoals: 2, resultState: "verified", resultResolution: "verified" }), now)).toBe("finished-verified");
    expect(fixturePhase(fixture({ actualHomeGoals: 2, actualAwayGoals: 2, resultState: "manual" }), now)).toBe("finished-verified");
    expect(fixturePhase(fixture({ actualHomeGoals: 2, actualAwayGoals: 2, resultState: "verified", resultResolution: "conflict-review", resultConflict: true }), now)).toBe("conflict-review");
  });
});

describe("round finalization", () => {
  const verified = fixture({ actualHomeGoals: 3, actualAwayGoals: 1, resultState: "verified", resultResolution: "verified" });
  const unverified = fixture({ actualHomeGoals: 1, actualAwayGoals: 1, resultState: "confirmed", resultResolution: "provisional" });
  const conflict = fixture({ actualHomeGoals: 2, actualAwayGoals: 2, resultState: "verified", resultResolution: "conflict-review", resultConflict: true });
  const acknowledged = { ...conflict, conflictAcknowledgedAt: now };
  const upcoming = fixture({ kickoffAt: new Date("2026-10-22T21:30:00Z") });

  it("keeps polling while a score is unverified or a conflict is open", () => {
    expect(fixtureBlocksPolling(unverified, now)).toBe(true);
    expect(fixtureBlocksPolling(conflict, now)).toBe(true);
    expect(fixtureBlocksPolling(acknowledged, now)).toBe(false);
    expect(planRoundPoll([verified, unverified], now, intervals)).toMatchObject({
      active: true,
      pollStatus: "scheduled",
      reason: expect.stringMatching(/verified/),
    });
    const disputed = planRoundPoll([verified, conflict], now, intervals);
    expect(disputed.active).toBe(true);
    expect(disputed.reason).toMatch(/acknowledged/);
    expect(disputed.nextPollAt?.toISOString()).toBe(new Date(now.getTime() + 15 * 60_000).toISOString());
  });

  it("stops when every fixture is verified, or the remaining conflict is acknowledged", () => {
    expect(planRoundPoll([verified, verified], now, intervals)).toEqual({
      pollStatus: "finalized",
      active: false,
      nextPollAt: null,
      reason: "All fixtures are final. Unresolved conflicts are absent or acknowledged.",
    });
    expect(planRoundPoll([verified, acknowledged], now, intervals).active).toBe(false);
    expect(planRoundPoll([verified, upcoming], now, intervals).active).toBe(true);
  });

  it("checks at kickoff when that is sooner than the hourly gap, and skips a round that is not due", () => {
    const soon = fixture({ kickoffAt: new Date("2026-10-22T18:20:00Z") });
    const waiting = planRoundPoll([soon], now, intervals);
    expect(waiting.nextPollAt?.toISOString()).toBe("2026-10-22T18:20:00.000Z");
    expect(planRoundPoll([upcoming], now, intervals).nextPollAt?.toISOString()).toBe("2026-10-22T19:00:00.000Z");
    expect(waiting.pollStatus).toBe("scheduled");
    const rounds = [
      { id: "due", nextPollAt: new Date("2026-10-22T17:00:00Z"), matches: [unverified] },
      { id: "later", nextPollAt: new Date("2026-10-22T19:00:00Z"), matches: [unverified] },
      { id: "done", nextPollAt: null, matches: [verified] },
    ];
    expect(selectDueRoundIds(rounds, now, intervals)).toEqual(["due"]);
    expect(selectDueRoundIds(rounds, now, intervals, "later")).toEqual(["due", "later"]);
    expect(selectDueRoundIds(rounds, now, intervals, "done")).toEqual(["due"]);
    expect(isPollDue(planRoundPoll([verified], now, intervals), null, now, true)).toBe(false);
  });

  it("records the strongest successful source and a health summary", () => {
    expect(strongestSuccessfulSource([
      { source: "sport-ru", status: "failed" },
      { source: "football-data", status: "ok" },
      { source: "premierliga", status: "ok" },
      { source: "footbolno", status: "ok" },
    ])).toBe("premierliga");
    expect(sourceHealthSummary([{ source: "sport-ru", status: "failed", error: "HTTP 503" }, { source: "premierliga", status: "ok", error: null }])).toBe(
      "sport-ru failed: HTTP 503; premierliga ok",
    );
  });
});
