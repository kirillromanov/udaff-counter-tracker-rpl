import { describe, expect, it } from "vitest";
import {
  fixtureBlocksPolling,
  effectiveNextCheck,
  fixturePhase,
  isPollDue,
  nextPollAfterCheck,
  planRoundPoll,
  resultCheckAt,
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
      reason: expect.stringMatching(/2 часа после начала/),
    });
    const disputed = planRoundPoll([verified, conflict], now, intervals);
    expect(disputed.active).toBe(true);
    expect(disputed.nextPollAt?.toISOString()).toBe("2026-10-22T18:00:00.000Z");
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

  it("checks two hours after kickoff, not four, and skips a round that is not due", () => {
    const soon = fixture({ kickoffAt: new Date("2026-10-22T18:20:00Z") });
    const waiting = planRoundPoll([soon], now, intervals);
    expect(waiting.nextPollAt?.toISOString()).toBe("2026-10-22T20:20:00.000Z");
    expect(waiting.nextPollAt?.toISOString()).not.toBe("2026-10-22T22:20:00.000Z");
    expect(planRoundPoll([upcoming], now, intervals).nextPollAt?.toISOString()).toBe("2026-10-22T23:30:00.000Z");
    expect(waiting.pollStatus).toBe("scheduled");
    const rounds = [
      { id: "due", nextPollAt: new Date("2026-10-22T17:00:00Z"), matches: [fixture({ kickoffAt: new Date("2026-10-22T10:00:00Z") })] },
      { id: "later", nextPollAt: new Date("2026-10-22T19:00:00Z"), matches: [fixture({ kickoffAt: new Date("2026-10-22T21:00:00Z") })] },
      { id: "done", nextPollAt: null, matches: [verified] },
    ];
    expect(selectDueRoundIds(rounds, now, intervals)).toEqual(["due"]);
    expect(selectDueRoundIds(rounds, now, intervals, "later")).toEqual(["due", "later"]);
    expect(selectDueRoundIds(rounds, now, intervals, "done")).toEqual(["due"]);
    const archived = { id: "old", nextPollAt: new Date("2026-10-22T17:00:00Z"), standingRole: "archived", matches: [unverified] };
    expect(selectDueRoundIds([...rounds, archived], now, intervals)).toEqual(["due"]);
    expect(selectDueRoundIds([...rounds, archived], now, intervals, "old")).toEqual(["due", "old"]);
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

describe("result check timing", () => {
  it("schedules the first check two hours after kickoff, and ignores a recorded finish offset", () => {
    const recorded = resultCheckAt(fixture({ finishedAt: new Date("2026-10-22T16:30:00Z"), kickoffAt: new Date("2026-10-22T12:00:00Z") }), now, 120, 15);
    expect(recorded).toMatchObject({ basis: "kickoff", at: new Date("2026-10-22T14:00:00Z") });
    const estimated = resultCheckAt(fixture({ kickoffAt: new Date("2026-10-22T18:20:00Z") }), now, 120, 15);
    expect(estimated).toMatchObject({ basis: "kickoff", at: new Date("2026-10-22T20:20:00.000Z") });
    expect(estimated?.at.toISOString()).not.toBe(new Date("2026-10-22T22:20:00Z").toISOString());
  });

  it("schedules from a UTC+3 kickoff as an absolute instant", () => {
    const kickoff = new Date("2026-10-22T21:30:00+03:00");
    const check = resultCheckAt(fixture({ kickoffAt: kickoff, finishedAt: null }), now, 120, 15);
    expect(check?.basis).toBe("kickoff");
    expect(check?.at.toISOString()).toBe("2026-10-22T20:30:00.000Z");
  });

  it("moves the pending check when the kickoff changes and does not run a future check", () => {
    const first = planRoundPoll([fixture({ kickoffAt: new Date("2026-10-22T19:00:00Z") })], now, intervals);
    const moved = planRoundPoll([fixture({ kickoffAt: new Date("2026-10-22T21:00:00Z") })], now, intervals);
    expect(first.nextPollAt?.toISOString()).toBe("2026-10-22T21:00:00.000Z");
    expect(moved.nextPollAt?.toISOString()).toBe("2026-10-22T23:00:00.000Z");
    expect(isPollDue(moved, new Date("2026-10-22T17:00:00Z"), now, false)).toBe(false);
  });

  it("keeps a live or postponed match unfinished", () => {
    const overdue = new Date("2026-10-22T21:00:00Z");
    const missing = planRoundPoll([fixture({ kickoffAt: new Date("2026-10-22T16:00:00Z") })], overdue, intervals);
    expect(missing.nextPollAt?.toISOString()).toBe("2026-10-22T18:00:00.000Z");
    expect(missing.pollStatus).not.toBe("finalized");
    const postponed = planRoundPoll([fixture({ providerStatus: "postponed", kickoffAt: new Date("2026-10-22T12:00:00Z") })], now, intervals);
    expect(postponed.active).toBe(false);
    expect(postponed.nextPollAt).toBeNull();
    expect(postponed.pollStatus).not.toBe("finalized");
    const stillLive = planRoundPoll([fixture({ providerStatus: "live", kickoffAt: new Date("2026-10-22T16:00:00Z") })], overdue, intervals);
    expect(stillLive.pollStatus).not.toBe("finalized");
    expect(fixturePhase(fixture({ providerStatus: "live" }), overdue)).not.toBe("finished-verified");
  });

  it("waits five minutes after an overdue check, and a later kickoff replaces an earlier stored time", () => {
    const overdue = new Date("2026-10-22T21:00:00Z");
    const plan = planRoundPoll([fixture({ kickoffAt: new Date("2026-10-22T16:00:00Z") })], overdue, intervals);
    expect(nextPollAfterCheck(plan, overdue, 15)?.toISOString()).toBe("2026-10-22T21:05:00.000Z");
    expect(isPollDue(plan, new Date("2026-10-22T21:05:00Z"), overdue, false)).toBe(false);
    const laterKickoff = planRoundPoll([fixture({ kickoffAt: new Date("2026-10-22T22:00:00Z") })], now, intervals);
    expect(effectiveNextCheck(laterKickoff, new Date("2026-10-22T19:00:00Z"), now)?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});
