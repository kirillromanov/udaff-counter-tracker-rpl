import { describe, expect, it } from "vitest";
import { planMoscowKickoffRepair } from "@/lib/domain/forum/repair-moscow-kickoff";
import { parseFixtureSchedule } from "@/lib/domain/forum/parse-schedule";
import { resultCheckAt } from "@/lib/domain/results/poll";
import { correctedMoscowKickoff, formatMoscow, moscowWallClockToUtc } from "@/lib/domain/time/moscow";

describe("Moscow fixture clocks", () => {
  it("stores 06.11.2026 19:30 as 16:30Z and renders it as 19:30 UTC+3", () => {
    const schedule = parseFixtureSchedule("06.11.2026 19:30 Локомотив — Рубин");
    const kickoff = schedule.fixtures[0]?.kickoffAt;
    expect(kickoff?.toISOString()).toBe("2026-11-06T16:30:00.000Z");
    expect(kickoff ? formatMoscow(kickoff) : "").toBe("2026-11-06 19:30 UTC+3");
  });

  it("does not use the host timezone", () => {
    const kickoff = moscowWallClockToUtc(2026, 11, 6, 19, 30);
    expect(kickoff.toISOString()).toBe("2026-11-06T16:30:00.000Z");
    expect(formatMoscow(new Date("2026-11-06T16:30:00.000Z"))).toBe("2026-11-06 19:30 UTC+3");
  });

  it("leaves an explicit UTC instant unchanged when it is displayed", () => {
    const instant = new Date("2026-11-07T13:23:00.000Z");
    expect(instant.toISOString()).toBe("2026-11-07T13:23:00.000Z");
    expect(formatMoscow(instant)).toBe("2026-11-07 16:23 UTC+3");
  });

  it("corrects only the old UTC misread and does not shift a second time", () => {
    const moscow = moscowWallClockToUtc(2026, 11, 6, 19, 30);
    const misread = new Date("2026-11-06T19:30:00.000Z");
    const already = new Date("2026-11-06T16:30:00.000Z");
    const other = new Date("2026-11-06T18:00:00.000Z");
    expect(correctedMoscowKickoff(misread, moscow)?.toISOString()).toBe("2026-11-06T16:30:00.000Z");
    expect(correctedMoscowKickoff(already, moscow)).toBeNull();
    expect(correctedMoscowKickoff(other, moscow)).toBeNull();
    expect(correctedMoscowKickoff(correctedMoscowKickoff(misread, moscow), moscow)).toBeNull();
  });

  it("moves an estimated check with the corrected kickoff and leaves a finishedAt check alone", () => {
    const corrected = new Date("2026-11-06T16:30:00.000Z");
    const finishedAt = new Date("2026-11-06T18:12:00.000Z");
    const now = new Date("2026-11-06T12:00:00.000Z");
    const estimated = resultCheckAt(
      { kickoffAt: corrected, actualHomeGoals: null, actualAwayGoals: null, resultState: "open", resultResolution: "", resultConflict: false, conflictAcknowledgedAt: null },
      now,
      120,
      120,
    );
    const finished = resultCheckAt(
      { kickoffAt: corrected, finishedAt, actualHomeGoals: 0, actualAwayGoals: 1, resultState: "open", resultResolution: "", resultConflict: false, conflictAcknowledgedAt: null },
      now,
      120,
      120,
    );
    expect(estimated?.at.toISOString()).toBe("2026-11-06T20:30:00.000Z");
    expect(estimated?.basis).toBe("estimated");
    expect(finished?.at.toISOString()).toBe("2026-11-06T20:12:00.000Z");
    expect(finished?.basis).toBe("finished");
  });

  it("repairs a stored misread once and leaves a correct instant", () => {
    const source = "06.11.2026 19:30 Локомотив — Рубин\n07.11.2026 14:00 Факел — Динамо";
    const first = planMoscowKickoffRepair(
      [
        { id: "wrong", homeTeam: "Локомотив", awayTeam: "Рубин", kickoffAt: new Date("2026-11-06T19:30:00.000Z") },
        { id: "right", homeTeam: "Факел", awayTeam: "Динамо", kickoffAt: new Date("2026-11-07T11:00:00.000Z") },
      ],
      source,
    );
    expect(first.updates).toEqual([{ id: "wrong", from: new Date("2026-11-06T19:30:00.000Z"), to: new Date("2026-11-06T16:30:00.000Z") }]);
    expect(first.alreadyCorrect).toBe(1);
    const second = planMoscowKickoffRepair(
      [
        { id: "wrong", homeTeam: "Локомотив", awayTeam: "Рубин", kickoffAt: first.updates[0]?.to ?? null },
        { id: "right", homeTeam: "Факел", awayTeam: "Динамо", kickoffAt: new Date("2026-11-07T11:00:00.000Z") },
      ],
      source,
    );
    expect(second.updates).toEqual([]);
    expect(second.alreadyCorrect).toBe(2);
  });
});
