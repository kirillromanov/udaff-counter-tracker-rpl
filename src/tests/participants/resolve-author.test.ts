import { describe, expect, it } from "vitest";
import { participantKey } from "@/lib/domain/import/participant-key";
import { KNOWN_ALIASES, KNOWN_IGNORED_AUTHORS } from "@/lib/domain/participants/known-participants";
import {
  creationBlocker,
  effectiveAuthorResolution,
  resolveAuthor,
  type IdentityCatalog,
} from "@/lib/domain/participants/resolve-author";

const pavel = { id: "pavel", name: "Павел Абросимов", normalized: participantKey("Павел Абросимов") };
const zuka = { id: "zuka", name: "зукабля", normalized: participantKey("зукабля") };
const oslop = { id: "oslop", name: "ослопЁс", normalized: participantKey("ослопЁс") };

const catalog: IdentityCatalog = {
  participants: [pavel, zuka, oslop],
  aliases: [
    { participantId: "zuka", alias: "Zukoblya", normalized: participantKey("Zukoblya") },
    { participantId: "pavel", alias: "Павел", normalized: participantKey("Павел") },
  ],
  ignored: [
    { name: "LAX", normalized: participantKey("LAX") },
    { name: "Rotvalez", normalized: participantKey("Rotvalez") },
  ],
};

describe("resolveAuthor", () => {
  it("maps a Cyrillic or Latin alias onto the existing participant", () => {
    expect(participantKey("зукабля")).not.toBe(participantKey("Zukoblya"));
    expect(participantKey("Павел")).not.toBe(participantKey("Павел Абросимов"));
    expect(resolveAuthor("Zukoblya", catalog)).toMatchObject({
      kind: "alias",
      participantId: "zuka",
      canonicalName: "зукабля",
    });
    expect(resolveAuthor("Павел", catalog)).toMatchObject({
      kind: "alias",
      participantId: "pavel",
      canonicalName: "Павел Абросимов",
    });
    expect(resolveAuthor("павел", catalog).participantId).toBe("pavel");
  });

  it("treats ё and punctuation as the same canonical participant", () => {
    expect(resolveAuthor("ослопёс", catalog)).toMatchObject({ kind: "participant", participantId: "oslop" });
    expect(resolveAuthor("  Йош! ", { ...catalog, participants: [{ id: "yosh", name: "Йош!", normalized: participantKey("Йош!") }] })).toMatchObject({
      kind: "participant",
      participantId: "yosh",
    });
  });

  it("ignores known non-participants and can override one comment", () => {
    expect(resolveAuthor("LAX", catalog).kind).toBe("ignored");
    expect(resolveAuthor("rotvalez", catalog).kind).toBe("ignored");
    expect(effectiveAuthorResolution("LAX", catalog, true)).toMatchObject({
      kind: "unknown",
      participantId: null,
    });
    expect(KNOWN_IGNORED_AUTHORS).toEqual(["LAX", "Rotvalez"]);
  });

  it("keeps an unconfirmed shorter name uncertain instead of linking it", () => {
    const withDoctor: IdentityCatalog = {
      ...catalog,
      participants: [...catalog.participants, { id: "doctor", name: "Doctor Livesey", normalized: participantKey("Doctor Livesey") }],
    };
    const resolution = resolveAuthor("Doctor", withDoctor);
    expect(resolution.kind).toBe("uncertain");
    expect(resolution.participantId).toBeNull();
    expect(resolution.suggestions).toEqual(["Doctor Livesey"]);
    expect(resolveAuthor("Somebody New", catalog).kind).toBe("unknown");
  });

  it("refuses a second participant when an alias or ignore entry already owns the nick", () => {
    expect(creationBlocker("Zukoblya", catalog)).toMatch(/зукабля/);
    expect(creationBlocker("Павел", catalog)).toMatch(/Павел Абросимов/);
    expect(creationBlocker("LAX", catalog)).toMatch(/ignored non-participant/);
    expect(creationBlocker("Somebody New", catalog)).toBeNull();
    expect(KNOWN_ALIASES["Павел Абросимов"]).toEqual(["Павел"]);
    expect(KNOWN_ALIASES["зукабля"]).toEqual(["Zukoblya"]);
  });
});
