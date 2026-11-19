import { describe, expect, it } from "vitest";
import { identityOwner, normalizeParticipantName } from "@/lib/domain/participants/identity";
import { KNOWN_ALIASES } from "@/lib/domain/participants/known-participants";
import { ROUND_13_CHECKPOINT } from "@/lib/domain/standings/round-13-checkpoint";
import {
  MONOKLON_BASELINE_TO,
  applyMonoklonBaselineCorrection,
  isMonoklonName,
} from "@/lib/domain/standings/correct-monoklon-baseline";
import { parseStandingsCheckpoint } from "@/lib/domain/standings/parse-checkpoint";

const IDENTITIES = [
  { participantId: "mono", normalized: normalizeParticipantName("моноклон") },
  { participantId: "mono", normalized: normalizeParticipantName("monoklon") },
  { participantId: "other", normalized: normalizeParticipantName("карагоз") },
];

describe("моноклон baseline correction", () => {
  it("resolves моноклон and monoklon to one canonical participant", () => {
    expect(KNOWN_ALIASES["моноклон"]).toEqual(["monoklon"]);
    expect(identityOwner(normalizeParticipantName("моноклон"), IDENTITIES)).toBe("mono");
    expect(identityOwner(normalizeParticipantName("monoklon"), IDENTITIES)).toBe("mono");
    expect(isMonoklonName("моноклон")).toBe(true);
    expect(isMonoklonName("monoklon")).toBe(true);
  });

  it("changes 162 to 189 and keeps every other total and award", () => {
    const before = parseStandingsCheckpoint(ROUND_13_CHECKPOINT);
    const result = applyMonoklonBaselineCorrection(ROUND_13_CHECKPOINT, "2026-11-05T18:00:00.000Z");
    expect(result.status).toBe("corrected");
    if (result.status !== "corrected") {
      return;
    }
    const after = parseStandingsCheckpoint(result.rawText);
    const monoklon = after.find((row) => row.displayName === "моноклон");
    expect(monoklon).toMatchObject({ totalPoints: 189, markerCount: 0, movement: "down", movementDelta: 6, rank: 14 });
    expect(after.find((row) => row.displayName === "карагоз")).toMatchObject({ totalPoints: 187, rank: 15, movement: "up", movementDelta: 1 });
    expect(after.map((row) => `${row.displayName}:${row.totalPoints}:${row.markerCount}`).filter((row) => !row.startsWith("моноклон"))).toEqual(
      before.map((row) => `${row.displayName}:${row.totalPoints}:${row.markerCount}`).filter((row) => !row.startsWith("моноклон")),
    );
    expect(after.filter((row) => row.totalPoints === 203).map((row) => row.displayName)).toEqual(["Chiger", "Schmelzer", "Йош!"]);
    expect(after.filter((row) => row.totalPoints === 224).map((row) => row.displayName)).toEqual(["Doctor Livesey", "Мычман"]);
    expect(result.rawText).toContain("note: моноклон: corrected baseline points from 162 to 189 at 2026-11-05T18:00:00.000Z");
    expect(result.rawText.match(/corrected baseline points from 162 to 189/gu)?.length).toBe(1);
  });

  it("leaves 189 unchanged and does not add a second audit note", () => {
    const once = applyMonoklonBaselineCorrection(ROUND_13_CHECKPOINT, "2026-11-05T18:00:00.000Z");
    expect(once.status).toBe("corrected");
    if (once.status !== "corrected") {
      return;
    }
    const twice = applyMonoklonBaselineCorrection(once.rawText, "2026-11-05T19:00:00.000Z");
    expect(twice).toEqual({ status: "unchanged", rawText: once.rawText });
    if (twice.status !== "unchanged") {
      return;
    }
    expect(twice.rawText.match(/corrected baseline points from 162 to 189/gu)?.length).toBe(1);
    expect(parseStandingsCheckpoint(twice.rawText).find((row) => row.displayName === "моноклон")?.totalPoints).toBe(MONOKLON_BASELINE_TO);
  });

  it("refuses a total that is neither 162 nor 189", () => {
    const text = ROUND_13_CHECKPOINT.replace("==моноклон== 162", "==моноклон== 170");
    const result = applyMonoklonBaselineCorrection(text, "2026-11-05T18:00:00.000Z");
    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.current).toBe(170);
    }
    expect(text).toContain("==моноклон== 170");
  });
});
