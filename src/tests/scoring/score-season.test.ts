import { describe, expect, it } from "vitest";
import { buildSeasonStandings } from "@/lib/domain/scoring/score-season";
import type { SeasonStandingInput } from "@/lib/domain/scoring/types";

const participants = [
  { id: "anna", name: "Anna" },
  { id: "boris", name: "Boris" },
  { id: "clara", name: "Clara" },
];

function standings(rounds: SeasonStandingInput["rounds"]) {
  return buildSeasonStandings({ participants, rounds });
}

describe("buildSeasonStandings", () => {
  it("marks everyone as new after the first round", () => {
    const rows = standings([
      {
        roundId: "r1",
        order: 1,
        scores: [
          { participantId: "anna", points: 10 },
          { participantId: "boris", points: 6 },
          { participantId: "clara", points: 3 },
        ],
      },
    ]);

    expect(rows.map((row) => [row.participantName, row.rank, row.previousRank, row.movement, row.roundWins])).toEqual([
      ["Anna", 1, null, "new", 1],
      ["Boris", 2, null, "new", 0],
      ["Clara", 3, null, "new", 0],
    ]);
  });

  it("moves ranks from the previous round and shares a round win", () => {
    const rows = standings([
      {
        roundId: "r1",
        order: 1,
        scores: [
          { participantId: "anna", points: 10 },
          { participantId: "boris", points: 6 },
          { participantId: "clara", points: 3 },
        ],
      },
      {
        roundId: "r2",
        order: 2,
        scores: [
          { participantId: "anna", points: 3 },
          { participantId: "boris", points: 10 },
          { participantId: "clara", points: 10 },
        ],
      },
    ]);

    expect(rows).toEqual([
      {
        participantId: "boris",
        participantName: "Boris",
        totalPoints: 16,
        roundWins: 1,
        rank: 1,
        previousRank: 2,
        movement: "up",
      },
      {
        participantId: "anna",
        participantName: "Anna",
        totalPoints: 13,
        roundWins: 1,
        rank: 2,
        previousRank: 1,
        movement: "down",
      },
      {
        participantId: "clara",
        participantName: "Clara",
        totalPoints: 13,
        roundWins: 1,
        rank: 3,
        previousRank: 3,
        movement: "same",
      },
    ]);
  });

  it("breaks a points tie by round wins, then by name", () => {
    const byWins = standings([
      {
        roundId: "r1",
        order: 1,
        scores: [
          { participantId: "anna", points: 7 },
          { participantId: "boris", points: 10 },
          { participantId: "clara", points: 0 },
        ],
      },
      {
        roundId: "r2",
        order: 2,
        scores: [
          { participantId: "anna", points: 3 },
          { participantId: "boris", points: 0 },
          { participantId: "clara", points: 8 },
        ],
      },
    ]);

    expect(byWins.map((row) => [row.participantName, row.totalPoints, row.roundWins, row.rank])).toEqual([
      ["Boris", 10, 1, 1],
      ["Anna", 10, 0, 2],
      ["Clara", 8, 1, 3],
    ]);

    const byName = standings([
      {
        roundId: "r1",
        order: 1,
        scores: [
          { participantId: "anna", points: 10 },
          { participantId: "boris", points: 10 },
          { participantId: "clara", points: 4 },
        ],
      },
    ]);

    expect(byName.map((row) => [row.participantName, row.roundWins, row.rank])).toEqual([
      ["Anna", 1, 1],
      ["Boris", 1, 2],
      ["Clara", 0, 3],
    ]);
  });

  it("uses participant id when names match", () => {
    const rows = buildSeasonStandings({
      participants: [
        { id: "b", name: "Alex" },
        { id: "a", name: "Alex" },
      ],
      rounds: [
        {
          roundId: "r1",
          order: 1,
          scores: [
            { participantId: "b", points: 5 },
            { participantId: "a", points: 5 },
          ],
        },
      ],
    });

    expect(rows.map((row) => row.participantId)).toEqual(["a", "b"]);
  });

  it("gives 0 points and no round win when a participant has no score", () => {
    const rows = standings([
      {
        roundId: "r1",
        order: 1,
        scores: [
          { participantId: "anna", points: -2 },
          { participantId: "boris", points: -5 },
        ],
      },
    ]);

    const clara = rows.find((row) => row.participantId === "clara");
    const anna = rows.find((row) => row.participantId === "anna");

    expect(clara).toMatchObject({ totalPoints: 0, roundWins: 0, rank: 1, movement: "new" });
    expect(anna).toMatchObject({ totalPoints: -2, roundWins: 1, rank: 2 });
  });

  it("ranks an empty season by name with no movement history", () => {
    const rows = standings([]);

    expect(rows.map((row) => [row.participantName, row.rank, row.movement, row.totalPoints])).toEqual([
      ["Anna", 1, "new", 0],
      ["Boris", 2, "new", 0],
      ["Clara", 3, "new", 0],
    ]);
  });

  it("orders rounds by their sequence before choosing the previous ranking", () => {
    const rows = standings([
      {
        roundId: "later",
        order: 2,
        scores: [
          { participantId: "anna", points: 0 },
          { participantId: "boris", points: 9 },
          { participantId: "clara", points: 0 },
        ],
      },
      {
        roundId: "earlier",
        order: 1,
        scores: [
          { participantId: "anna", points: 9 },
          { participantId: "boris", points: 1 },
          { participantId: "clara", points: 0 },
        ],
      },
    ]);

    expect(rows.find((row) => row.participantId === "boris")).toMatchObject({
      rank: 1,
      previousRank: 2,
      movement: "up",
      totalPoints: 10,
    });
  });
});
