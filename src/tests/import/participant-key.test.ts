import { describe, expect, it } from "vitest";
import { participantKey } from "@/lib/domain/import/participant-key";

describe("participantKey", () => {
  it("collapses case, spacing, yo, and wrapping punctuation", () => {
    expect(participantKey("Йош!")).toBe(participantKey("Йош"));
    expect(participantKey("!!Йош!!")).toBe("йош");
    expect(participantKey("XXX")).toBe(participantKey("xxx"));
    expect(participantKey("  Павел   Абросимов  ")).toBe(participantKey("Павел Абросимов"));
    expect(participantKey("Алёша")).toBe(participantKey("Алеша"));
    expect(participantKey("Йош\u200b")).toBe("йош");
    expect(participantKey("Doctor  Livesey")).toBe(participantKey("doctor livesey"));
  });

  it("keeps extra words, so short and full names stay distinct", () => {
    expect(participantKey("Павел")).not.toBe(participantKey("Павел Абросимов"));
    expect(participantKey("Йош")).not.toBe(participantKey("Йош 2"));
    expect(participantKey("Doctor Livesey")).not.toBe(participantKey("Livesey"));
    expect(participantKey("user_name")).not.toBe(participantKey("username"));
  });
});
