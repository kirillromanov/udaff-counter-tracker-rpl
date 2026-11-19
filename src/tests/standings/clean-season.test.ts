import { describe, expect, it } from "vitest";
import { exportSeasonStandings } from "@/lib/domain/export/export-season-standings";
import { buildCleanSeasonStandings, type CleanBaselineRow } from "@/lib/domain/standings/clean-season";
import { applyMonoklonBaselineCorrection } from "@/lib/domain/standings/correct-monoklon-baseline";
import { parseStandingsCheckpoint } from "@/lib/domain/standings/parse-checkpoint";
import { ROUND_13_CHECKPOINT } from "@/lib/domain/standings/round-13-checkpoint";

function correctedBaseline(): CleanBaselineRow[] {
  const corrected = applyMonoklonBaselineCorrection(ROUND_13_CHECKPOINT, "2026-11-05T18:00:00.000Z");
  if (corrected.status !== "corrected") {
    throw new Error("expected the baseline correction");
  }
  return parseStandingsCheckpoint(corrected.rawText).map((row, index) => ({
    participantId: `p${index}`,
    name: row.displayName,
    points: row.totalPoints,
    medals: row.markerCount,
    rank: row.rank,
    movement: row.movement,
    previousRank: row.previousRank,
  }));
}

describe("clean season standings", () => {
  const baseline = correctedBaseline();
  const participants = [
    ...baseline.map((row) => ({ id: row.participantId ?? "", name: row.name })),
    { id: "missing", name: "Новый участник" },
  ];

  it("shows моноклон at 189 and keeps the baseline movement snapshot", () => {
    const table = buildCleanSeasonStandings({
      baselineAfterRound: 13,
      baseline,
      participants,
      confirmedRounds: [],
    });
    const monoklon = table.rows.find((row) => row.name === "моноклон");
    expect(monoklon).toMatchObject({ totalPoints: 189, rank: 14, movement: "down", medals: 0 });
    expect(monoklon?.previousRank).toBe(8);
    expect(table.movementContext).toBe("baseline-snapshot");
    expect(table.rows.find((row) => row.name === "Новый участник")).toMatchObject({ totalPoints: 0, movement: "new" });
    expect(table.rows.filter((row) => row.totalPoints === 203).map((row) => row.name)).toEqual(["Chiger", "Schmelzer", "Йош!"]);
    expect(table.liveRows).toBeNull();
  });

  it("adds round 14 once and leaves rounds 1–13 out of the total", () => {
    const monoklonId = baseline.find((row) => row.name === "моноклон")?.participantId ?? "";
    const table = buildCleanSeasonStandings({
      baselineAfterRound: 13,
      baseline,
      participants,
      confirmedRounds: [
        { roundId: "r5", order: 5, scores: [{ participantId: monoklonId, points: 100 }] },
        { roundId: "r14", order: 14, scores: [{ participantId: monoklonId, points: 10 }] },
        { roundId: "r14", order: 14, scores: [{ participantId: monoklonId, points: 10 }] },
      ],
    });
    expect(table.rows.find((row) => row.name === "моноклон")?.totalPoints).toBe(199);
    expect(table.movementContext).toBe("operational-round");
    expect(table.rows.find((row) => row.name === "Новый участник")?.totalPoints).toBe(0);
  });

  it("keeps a live round out of the confirmed total", () => {
    const monoklonId = baseline.find((row) => row.name === "моноклон")?.participantId ?? "";
    const table = buildCleanSeasonStandings({
      baselineAfterRound: 13,
      baseline,
      participants,
      confirmedRounds: [],
      liveRounds: [{ roundId: "r14", order: 14, scores: [{ participantId: monoklonId, points: 7 }] }],
    });
    expect(table.rows.find((row) => row.name === "моноклон")?.totalPoints).toBe(189);
    expect(table.liveRows?.find((row) => row.name === "моноклон")?.totalPoints).toBe(196);
  });

  it("exports the confirmed table in the forum format without changing the rows", () => {
    const table = buildCleanSeasonStandings({
      baselineAfterRound: 13,
      baseline,
      participants,
      confirmedRounds: [],
    });
    const before = JSON.stringify(table.rows);
    const text = exportSeasonStandings(
      table.rows.map((row) => ({
        rank: row.rank,
        name: row.name,
        totalPoints: row.totalPoints,
        medals: row.medals,
        movement: row.movement,
        previousRank: row.previousRank,
      })),
    );
    const again = exportSeasonStandings(
      table.rows.map((row) => ({
        rank: row.rank,
        name: row.name,
        totalPoints: row.totalPoints,
        medals: row.medals,
        movement: row.movement,
        previousRank: row.previousRank,
      })),
    );
    expect(again).toBe(text);
    expect(JSON.stringify(table.rows)).toBe(before);
    expect(text).toContain("моноклон");
    expect(text).toContain("189");
    expect(text).toContain("▼ 6");
    expect(text).not.toContain("p0");
    const hordi = text.split("\n")[0] ?? "";
    expect(hordi).toContain("◄► 0");
    expect(hordi).toContain("☼");
    expect(hordi).toContain("310");
  });
});
