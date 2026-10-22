import { describe, expect, it } from "vitest";
import { buildProductionStandings } from "@/lib/domain/scoring/production-standings";

const baseline = [
  { participantId: "a", name: "Alpha", points: 100, medals: 1, rank: 1 },
  { participantId: "b", name: "Beta", points: 90, medals: 0, rank: 2 },
];

describe("production standings", () => {
  it("starts from the trusted baseline before any production round is stored", () => {
    const table = buildProductionStandings({
      baseline,
      participants: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      rounds: [],
    });

    expect(table.map((row) => [row.participantName, row.totalPoints, row.rank, row.movement, row.roundWins])).toEqual([
      ["Alpha", 100, 1, "same", 1],
      ["Beta", 90, 2, "same", 0],
    ]);
  });

  it("adds finalized operational rounds on top of the baseline and moves from the baseline rank", () => {
    const table = buildProductionStandings({
      baseline,
      participants: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      rounds: [
        {
          roundId: "r12",
          order: 12,
          scores: [
            { participantId: "a", points: 10 },
            { participantId: "b", points: 30 },
          ],
        },
      ],
    });

    expect(table.map((row) => [row.participantId, row.totalPoints, row.roundWins, row.rank, row.previousRank, row.movement])).toEqual([
      ["b", 120, 1, 1, 2, "up"],
      ["a", 110, 1, 2, 1, "down"],
    ]);
  });

  it("moves the next production round from the previous production table", () => {
    const table = buildProductionStandings({
      baseline,
      participants: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      rounds: [
        {
          roundId: "r12",
          order: 12,
          scores: [
            { participantId: "a", points: 10 },
            { participantId: "b", points: 30 },
          ],
        },
        {
          roundId: "r13",
          order: 13,
          scores: [
            { participantId: "a", points: 40 },
            { participantId: "b", points: 0 },
          ],
        },
      ],
    });

    const alpha = table.find((row) => row.participantId === "a");
    const beta = table.find((row) => row.participantId === "b");
    expect(alpha).toMatchObject({ totalPoints: 150, rank: 1, previousRank: 2, movement: "up" });
    expect(beta).toMatchObject({ totalPoints: 120, rank: 2, previousRank: 1, movement: "down" });
  });
});
