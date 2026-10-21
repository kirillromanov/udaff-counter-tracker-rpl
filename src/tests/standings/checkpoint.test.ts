import { describe, expect, it } from "vitest";
import { participantKey } from "@/lib/domain/import/participant-key";
import { KNOWN_PARTICIPANTS } from "@/lib/domain/participants/known-participants";
import {
  compareCheckpointToComputed,
  matchCheckpointRows,
  parseStandingsCheckpoint,
} from "@/lib/domain/standings/parse-checkpoint";
import { ROUND_11_CHECKPOINT } from "@/lib/domain/standings/round-11-checkpoint";

const identities = KNOWN_PARTICIPANTS.map((name) => ({
  participantId: name,
  normalized: participantKey(name),
}));

describe("round 11 standings checkpoint", () => {
  const rows = parseStandingsCheckpoint(ROUND_11_CHECKPOINT);

  it("reads rank, movement, points, and sun markers from the forum block", () => {
    expect(rows).toHaveLength(25);
    expect(rows.map((row) => row.rank)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    expect(rows.reduce((total, row) => total + row.totalPoints, 0)).toBe(4313);
    expect(rows.reduce((total, row) => total + row.markerCount, 0)).toBe(11);

    expect(rows[0]).toMatchObject({
      displayName: "Hordi Cruyff",
      movement: "up",
      movementDelta: 1,
      previousRank: 2,
      markerCount: 1,
      totalPoints: 250,
    });
    expect(rows[1]).toMatchObject({
      displayName: "зукабля",
      movement: "down",
      movementDelta: 1,
      previousRank: 1,
      markerCount: 3,
      totalPoints: 243,
    });
    expect(rows[2]).toMatchObject({ displayName: "neofit", movement: "same", movementDelta: 0, markerCount: 0, totalPoints: 226 });
    expect(rows[4]).toMatchObject({ displayName: "Filka", markerCount: 2, totalPoints: 204 });
    expect(rows[7]).toMatchObject({ displayName: "Askvit", markerCount: 0, totalPoints: 188 });
    expect(rows[8]).toMatchObject({ displayName: "Doctor Livesey", movement: "up", markerCount: 1, totalPoints: 188 });
    expect(rows[11]).toMatchObject({ displayName: "Йош!", movement: "up", movementDelta: 1, totalPoints: 167, markerCount: 0 });
    expect(rows[17]).toMatchObject({ displayName: "Павел Абросимов", movement: "up", movementDelta: 3, previousRank: 21 });
    expect(rows[21]).toMatchObject({ displayName: "Пиночет", movement: "down", movementDelta: 4, previousRank: 18, totalPoints: 139 });
    expect(rows[23]).toMatchObject({ displayName: "Лысая_ Башка", totalPoints: 117 });
    expect(rows[24]).toMatchObject({ displayName: "nikatin", movement: "same", totalPoints: 111 });
  });

  it("matches every posted name to the registry and does not invent a person", () => {
    const matched = matchCheckpointRows(rows, identities);
    expect(matched.every((row) => row.participantId === row.displayName)).toBe(true);

    const yosh = matchCheckpointRows(
      [{ ...rows[11], displayName: "йош" }],
      identities,
    );
    expect(yosh[0]?.participantId).toBe("Йош!");

    const shortPavel = matchCheckpointRows(
      [{ ...rows[17], displayName: "Павел" }],
      identities,
    );
    expect(shortPavel[0]?.participantId).toBeNull();
  });

  it("rejects a line that is not a standings row", () => {
    expect(() => parseStandingsCheckpoint("hello forum")).toThrow(/Could not read standings line/);
  });

  it("compares a later calculated table by rank, points, movement, and round wins", () => {
    const matched = matchCheckpointRows(rows, identities.map((identity) => ({ ...identity, participantId: `id:${identity.participantId}` })));
    const hordi = matched[0];
    const zukablya = matched[1];
    if (!hordi?.participantId || !zukablya?.participantId) {
      throw new Error("expected matched rows");
    }
    const result = compareCheckpointToComputed(
      [hordi, zukablya, { ...matched[2], participantId: null }],
      [
        {
          participantId: hordi.participantId,
          rank: 2,
          totalPoints: 250,
          movement: "down",
          previousRank: 1,
          roundWins: 1,
        },
        {
          participantId: zukablya.participantId,
          rank: 2,
          totalPoints: 240,
          movement: "down",
          previousRank: 1,
          roundWins: 2,
        },
        {
          participantId: "id:extra",
          rank: 9,
          totalPoints: 10,
          movement: "new",
          previousRank: null,
          roundWins: 0,
        },
      ],
    );

    expect(result.unmatchedNames).toEqual(["neofit"]);
    expect(result.missingParticipantIds).toEqual(["id:extra"]);
    expect(result.differences).toEqual([
      {
        participantId: hordi.participantId,
        displayName: "Hordi Cruyff",
        fields: ["rank 1 vs 2", "movement up 1 vs down 1"],
      },
      {
        participantId: zukablya.participantId,
        displayName: "зукабля",
        fields: ["points 243 vs 240", "markers 3 vs 2 round wins"],
      },
    ]);
  });
});
