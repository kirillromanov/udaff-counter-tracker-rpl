import { describe, expect, it } from "vitest";
import {
  advanceFixtureCheck,
  CHECK_EXHAUSTED_TEXT,
  fixtureCheckStatus,
  planRoundPoll,
  type PollFixture,
  type StoredFixtureCheck,
} from "@/lib/domain/results/poll";

const intervals = { regularMinutes: 60, liveMinutes: 15 };
const kickoff = new Date("2026-11-07T13:30:00.000Z");

function open(overrides: Partial<PollFixture> = {}): PollFixture {
  return {
    kickoffAt: kickoff,
    actualHomeGoals: null,
    actualAwayGoals: null,
    resultState: "open",
    resultResolution: "",
    resultConflict: false,
    conflictAcknowledgedAt: null,
    ...overrides,
  };
}

function stored(overrides: Partial<StoredFixtureCheck> = {}): StoredFixtureCheck {
  return {
    kickoffAt: kickoff,
    autoCheckAttempts: 0,
    autoCheckKickoffAt: kickoff,
    autoCheckNextAt: null,
    autoCheckHistory: "[]",
    verified: false,
    held: false,
    acknowledged: false,
    ...overrides,
  };
}

describe("bounded automatic result checks", () => {
  it("places the first check two hours after a UTC+3 kickoff, not four", () => {
    const moscow = new Date("2026-11-07T16:30:00+03:00");
    expect(moscow.toISOString()).toBe("2026-11-07T13:30:00.000Z");
    const plan = planRoundPoll([open({ kickoffAt: moscow })], new Date("2026-11-07T13:00:00Z"), intervals);
    expect(plan.nextPollAt?.toISOString()).toBe("2026-11-07T15:30:00.000Z");
    expect(plan.nextPollAt?.toISOString()).not.toBe("2026-11-07T17:30:00.000Z");
  });

  it("retries five minutes after an unsuccessful check and stops at ten", () => {
    let state = stored();
    const firstAt = new Date("2026-11-07T15:30:00Z");
    state = advanceFixtureCheck(state, firstAt, true);
    expect(state.autoCheckAttempts).toBe(1);
    expect(state.autoCheckNextAt?.toISOString()).toBe("2026-11-07T15:35:00.000Z");
    for (let attempt = 2; attempt <= 10; attempt += 1) {
      const checkedAt = state.autoCheckNextAt ?? firstAt;
      state = advanceFixtureCheck(state, checkedAt, true);
      expect(state.autoCheckAttempts).toBe(attempt);
    }
    expect(state.autoCheckNextAt).toBeNull();
    const exhausted = planRoundPoll(
      [open({ autoCheckAttempts: 10, autoCheckKickoffAt: kickoff, autoCheckNextAt: null })],
      new Date("2026-11-07T16:30:00Z"),
      intervals,
    );
    expect(exhausted.active).toBe(false);
    expect(exhausted.pollStatus).not.toBe("finalized");
    expect(exhausted.reason).toBe(CHECK_EXHAUSTED_TEXT);
    const again = advanceFixtureCheck(state, new Date("2026-11-07T16:30:00Z"), true);
    expect(again.autoCheckAttempts).toBe(10);
    expect(again.autoCheckNextAt).toBeNull();
  });

  it("stops when the result becomes verified without the score changing, and does not count a manual refresh", () => {
    const before = stored({ autoCheckAttempts: 2, autoCheckNextAt: new Date("2026-11-07T15:40:00Z") });
    const manual = advanceFixtureCheck(before, new Date("2026-11-07T15:40:00Z"), false);
    expect(manual.autoCheckAttempts).toBe(2);
    const verified = advanceFixtureCheck({ ...before, verified: true }, new Date("2026-11-07T15:40:00Z"), true);
    expect(verified.autoCheckAttempts).toBe(3);
    expect(verified.autoCheckNextAt).toBeNull();
    expect(fixtureCheckStatus(open({
      actualHomeGoals: 1,
      actualAwayGoals: 2,
      resultState: "verified",
      resultResolution: "verified",
      autoCheckAttempts: 3,
      autoCheckKickoffAt: kickoff,
    })).verified).toBe(true);
  });

  it("keeps provisional, live, and conflicting results inside the attempt budget", () => {
    const checkedAt = new Date("2026-11-07T15:30:00Z");
    const provisional = advanceFixtureCheck(stored(), checkedAt, true);
    expect(provisional.autoCheckAttempts).toBe(1);
    expect(provisional.autoCheckNextAt).not.toBeNull();
    const conflict = planRoundPoll(
      [open({ actualHomeGoals: 1, actualAwayGoals: 1, resultState: "verified", resultResolution: "conflict-review", resultConflict: true })],
      checkedAt,
      intervals,
    );
    expect(conflict.pollStatus).not.toBe("finalized");
    expect(conflict.active).toBe(true);
    const failed = advanceFixtureCheck(stored(), checkedAt, true);
    expect(failed.autoCheckAttempts).toBe(1);
  });

  it("does not replay missed intervals in one call", () => {
    const late = advanceFixtureCheck(stored(), new Date("2026-11-07T18:00:00Z"), true);
    expect(late.autoCheckAttempts).toBe(1);
    expect(late.autoCheckNextAt?.toISOString()).toBe("2026-11-07T18:05:00.000Z");
    const waiting = advanceFixtureCheck(late, new Date("2026-11-07T18:00:00Z"), true);
    expect(waiting.autoCheckAttempts).toBe(1);
  });

  it("resets only when the accepted kickoff changes", () => {
    const used = stored({ autoCheckAttempts: 4, autoCheckNextAt: new Date("2026-11-07T15:50:00Z") });
    const same = advanceFixtureCheck(used, new Date("2026-11-07T15:40:00Z"), false);
    expect(same.autoCheckAttempts).toBe(4);
    expect(same.autoCheckHistory).toBe("[]");
    const movedKickoff = new Date("2026-11-08T13:30:00Z");
    const moved = advanceFixtureCheck({ ...used, kickoffAt: movedKickoff }, new Date("2026-11-07T16:00:00Z"), false);
    expect(moved.autoCheckAttempts).toBe(0);
    expect(moved.autoCheckNextAt?.toISOString()).toBe("2026-11-08T15:30:00.000Z");
    expect(JSON.parse(moved.autoCheckHistory ?? "[]")).toEqual([
      { kickoffAt: kickoff.toISOString(), attempts: 4, endedAt: "2026-11-07T16:00:00.000Z" },
    ]);
  });
});
