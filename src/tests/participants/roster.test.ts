import { describe, expect, it } from "vitest";
import { participantKey } from "@/lib/domain/import/participant-key";
import { identityOwner } from "@/lib/domain/participants/identity";
import { KNOWN_PARTICIPANTS } from "@/lib/domain/participants/known-participants";
import { applyRosterAction, canPermanentlyDelete, isActiveInSeason } from "@/lib/domain/participants/roster";

describe("known participants", () => {
  it("keeps the contest list exact and free of colliding nicknames", () => {
    expect(KNOWN_PARTICIPANTS).toHaveLength(25);
    expect(KNOWN_PARTICIPANTS).toContain("Йош!");
    expect(KNOWN_PARTICIPANTS).toContain("ослопЁс");
    expect(KNOWN_PARTICIPANTS).toContain("Лысая_ Башка");
    expect(KNOWN_PARTICIPANTS).toContain("Павел Абросимов");

    const keys = KNOWN_PARTICIPANTS.map((name) => participantKey(name));
    expect(new Set(keys).size).toBe(keys.length);
    expect(participantKey("Йош!")).toBe(participantKey("йош"));
    expect(participantKey("ослопЁс")).toBe(participantKey("ослопес"));
    expect(participantKey("Лысая_ Башка")).toBe("лысая_ башка");
    expect(participantKey("Павел")).not.toBe(participantKey("Павел Абросимов"));
  });
});

describe("identityOwner", () => {
  const identities = [
    { participantId: "yosh", normalized: participantKey("Йош!") },
    { participantId: "pavel", normalized: participantKey("Павел Абросимов") },
    { participantId: "yosh", normalized: participantKey("Йош") },
  ];

  it("resolves a nickname variation to the existing participant", () => {
    expect(identityOwner(participantKey("  йош! "), identities)).toBe("yosh");
    expect(identityOwner(participantKey("Павел"), identities)).toBeNull();
    expect(identityOwner("", identities)).toBeNull();
  });
});

describe("season roster", () => {
  it("includes, excludes, and refuses an include while archived", () => {
    expect(applyRosterAction({ archived: false, membership: "absent", action: "include" })).toEqual({
      membership: "included",
      error: null,
    });
    expect(applyRosterAction({ archived: false, membership: "included", action: "exclude" })).toEqual({
      membership: "excluded",
      error: null,
    });
    expect(applyRosterAction({ archived: false, membership: "excluded", action: "include" })).toEqual({
      membership: "included",
      error: null,
    });
    expect(applyRosterAction({ archived: false, membership: "absent", action: "exclude" }).error).toMatch(/not on the season/);
    expect(applyRosterAction({ archived: true, membership: "excluded", action: "include" }).error).toMatch(/Restore/);
  });

  it("treats only an included, unarchived membership as active", () => {
    expect(isActiveInSeason({ archived: false, membership: "included" })).toBe(true);
    expect(isActiveInSeason({ archived: false, membership: "excluded" })).toBe(false);
    expect(isActiveInSeason({ archived: false, membership: "absent" })).toBe(false);
    expect(isActiveInSeason({ archived: true, membership: "included" })).toBe(false);
  });

  it("allows a permanent delete only when no historical rows exist", () => {
    expect(canPermanentlyDelete({ predictionSets: 0, roundScores: 0, snapshots: 0 })).toBe(true);
    expect(canPermanentlyDelete({ predictionSets: 0, roundScores: 1, snapshots: 0 })).toBe(false);
    expect(canPermanentlyDelete({ predictionSets: 2, roundScores: 0, snapshots: 0 })).toBe(false);
    expect(canPermanentlyDelete({ predictionSets: 0, roundScores: 0, snapshots: 1 })).toBe(false);
  });
});
