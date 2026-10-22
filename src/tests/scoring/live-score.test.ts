import { describe, expect, it } from "vitest";
import { scoreRound } from "@/lib/domain/scoring/score-round";
import {
  buildLiveSeasonTable,
  confidenceLabel,
  fixtureConfidence,
  rankLiveScores,
  roundIsComplete,
  scoreLiveParticipant,
  type LiveFixtureInput,
} from "@/lib/domain/scoring/live-score";

function fixture(overrides: Partial<LiveFixtureInput> & Pick<LiveFixtureInput, "matchId">): LiveFixtureInput {
  return {
    label: overrides.matchId,
    actualHomeGoals: null,
    actualAwayGoals: null,
    resultState: "open",
    resultResolution: "",
    resultConflict: false,
    conflictAcknowledged: false,
    isMatchOfTheRound: false,
    ...overrides,
  };
}

const verified = (matchId: string, home: number, away: number): LiveFixtureInput =>
  fixture({ matchId, actualHomeGoals: home, actualAwayGoals: away, resultState: "verified", resultResolution: "verified" });

describe("live fixture confidence", () => {
  it("keeps a blank fixture pending and a dispute out of the verified total", () => {
    expect(fixtureConfidence(fixture({ matchId: "later" }))).toBe("pending");
    expect(fixtureConfidence(verified("done", 1, 0))).toBe("verified");
    expect(
      fixtureConfidence(fixture({ matchId: "partial", actualHomeGoals: 1, actualAwayGoals: 0, resultState: "confirmed", resultResolution: "provisional" })),
    ).toBe("provisional");
    expect(
      fixtureConfidence(fixture({ matchId: "fight", actualHomeGoals: 2, actualAwayGoals: 2, resultConflict: true, resultState: "verified", resultResolution: "verified" })),
    ).toBe("conflict");
    expect(confidenceLabel("provisional", true)).toBe("conflict acknowledged");
  });
});

describe("partial live rounds", () => {
  const fixtures = [
    verified("confirmed", 2, 0),
    fixture({ matchId: "live", actualHomeGoals: 1, actualAwayGoals: 0, resultState: "confirmed", resultResolution: "provisional" }),
    fixture({ matchId: "waiting" }),
  ];

  it("splits verified points from provisional points and leaves pending fixtures unscored", () => {
    const score = scoreLiveParticipant("p1", fixtures, [
      { matchId: "confirmed", home: 2, away: 0 },
      { matchId: "live", home: 1, away: 0 },
      { matchId: "waiting", home: 3, away: 3 },
    ]);

    expect(score.confirmedPoints).toBe(10);
    expect(score.provisionalPoints).toBe(10);
    expect(score.livePoints).toBe(20);
    expect(score.pendingCount).toBe(1);
    expect(score.conflictCount).toBe(0);
    expect(score.roundBonus).toBe(0);
    expect(score.matches.find((match) => match.matchId === "waiting")?.points).toBeNull();
  });

  it("ranks by the labeled live total", () => {
    const leader = scoreLiveParticipant("leader", fixtures, [
      { matchId: "confirmed", home: 2, away: 0 },
      { matchId: "live", home: 1, away: 0 },
    ]);
    const trailer = scoreLiveParticipant("trailer", fixtures, [
      { matchId: "confirmed", home: 0, away: 1 },
      { matchId: "live", home: 0, away: 1 },
    ]);
    const ranked = rankLiveScores([
      { ...trailer, name: "Trailer" },
      { ...leader, name: "Leader" },
    ]);
    expect(ranked.map((row) => [row.name, row.rank, row.livePoints])).toEqual([
      ["Leader", 1, 20],
      ["Trailer", 2, -2],
    ]);
  });

  it("does not award a conflicted score, and an acknowledgement stays provisional", () => {
    const openConflict = fixture({
      matchId: "fight",
      actualHomeGoals: 1,
      actualAwayGoals: 0,
      resultConflict: true,
      resultState: "verified",
      resultResolution: "conflict-review",
    });
    const blocked = scoreLiveParticipant("p1", [verified("confirmed", 2, 0), openConflict], [
      { matchId: "confirmed", home: 2, away: 0 },
      { matchId: "fight", home: 1, away: 0 },
    ]);
    expect(blocked.confirmedPoints).toBe(10);
    expect(blocked.provisionalPoints).toBe(0);
    expect(blocked.conflictCount).toBe(1);
    expect(blocked.livePoints).toBe(10);

    const acknowledged = scoreLiveParticipant(
      "p1",
      [verified("confirmed", 2, 0), { ...openConflict, conflictAcknowledged: true }],
      [
        { matchId: "confirmed", home: 2, away: 0 },
        { matchId: "fight", home: 1, away: 0 },
      ],
    );
    expect(acknowledged.provisionalPoints).toBe(10);
    expect(acknowledged.confirmedPoints).toBe(10);
    expect(acknowledged.conflictCount).toBe(0);
    expect(acknowledged.matches.find((match) => match.matchId === "fight")?.acknowledgedConflict).toBe(true);
  });

  it("moves provisional points into the confirmed total, including the round bonus, once every fixture is verified", () => {
    const predictions = [
      { matchId: "confirmed", home: 2, away: 0 },
      { matchId: "live", home: 1, away: 0 },
    ];
    const before = scoreLiveParticipant("p1", fixtures.slice(0, 2), predictions);
    expect(before.roundBonus).toBe(0);
    expect(roundIsComplete(fixtures.slice(0, 2))).toBe(false);

    const finished = [verified("confirmed", 2, 0), verified("live", 1, 0)];
    const after = scoreLiveParticipant("p1", finished, predictions);
    const stored = scoreRound({
      roundId: "r",
      participantId: "p1",
      matches: finished.map((match) => ({
        matchId: match.matchId,
        actual: { home: match.actualHomeGoals as number, away: match.actualAwayGoals as number },
        predicted: { home: match.matchId === "confirmed" ? 2 : 1, away: 0 },
        isMatchOfTheRound: false,
      })),
    });

    expect(roundIsComplete(finished)).toBe(true);
    expect(after.provisionalPoints).toBe(0);
    expect(after.confirmedPoints).toBe(stored.roundTotal);
    expect(after.roundBonus).toBe(stored.roundTotalGoalsBonus);
    expect(after.confirmedPoints).toBe(23);
  });
});

describe("provisional season table", () => {
  it("adds the baseline, later confirmed rounds, and the current live delta without folding the delta into the confirmed total", () => {
    const table = buildLiveSeasonTable({
      baselineAfterRound: 11,
      baseline: [
        { participantId: "a", name: "Alpha", points: 100, medals: 1 },
        { participantId: "b", name: "Beta", points: 90, medals: 0 },
      ],
      participants: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      rounds: [
        {
          order: 11,
          complete: true,
          scores: [
            { participantId: "a", confirmedPoints: 40, provisionalPoints: 0 },
            { participantId: "b", confirmedPoints: 40, provisionalPoints: 0 },
          ],
        },
        {
          order: 12,
          complete: true,
          scores: [
            { participantId: "a", confirmedPoints: 10, provisionalPoints: 0 },
            { participantId: "b", confirmedPoints: 4, provisionalPoints: 0 },
          ],
        },
        {
          order: 13,
          complete: false,
          scores: [
            { participantId: "a", confirmedPoints: 3, provisionalPoints: 0 },
            { participantId: "b", confirmedPoints: 0, provisionalPoints: 20 },
          ],
        },
      ],
    });

    const alpha = table.find((row) => row.participantId === "a");
    const beta = table.find((row) => row.participantId === "b");
    expect(alpha).toMatchObject({
      baselinePoints: 100,
      confirmedRoundPoints: 10,
      liveDelta: 3,
      confirmedTotal: 110,
      liveTotal: 113,
      confirmedRank: 1,
      liveRank: 2,
      movement: "down",
    });
    expect(beta).toMatchObject({
      baselinePoints: 90,
      confirmedRoundPoints: 4,
      liveDelta: 20,
      confirmedTotal: 94,
      liveTotal: 114,
      confirmedRank: 2,
      liveRank: 1,
      movement: "up",
    });
  });
});
