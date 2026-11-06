import { describe, expect, it } from "vitest";
import { resolveSelections, type SelectableSet } from "@/lib/domain/import/select-sets";

function set(overrides: Partial<SelectableSet> & Pick<SelectableSet, "id" | "postedAt">): SelectableSet {
  return {
    participantId: "p1",
    valid: true,
    selection: "auto",
    selected: false,
    ...overrides,
  };
}

describe("resolveSelections", () => {
  it("selects the latest valid comment when the same participant posted twice", () => {
    const chosen = resolveSelections([
      set({ id: "early", postedAt: new Date("2026-10-16T10:00:00Z"), valid: true }),
      set({ id: "late", postedAt: new Date("2026-10-16T18:00:00Z"), valid: true }),
      set({
        id: "other",
        participantId: "p2",
        postedAt: new Date("2026-10-16T12:00:00Z"),
        valid: true,
      }),
    ]);

    expect(chosen).toEqual(["late", "other"]);
  });

  it("skips a newer comment that has no scored prediction", () => {
    const chosen = resolveSelections([
      set({ id: "early", postedAt: new Date("2026-10-16T10:00:00Z"), valid: true }),
      set({ id: "chat", postedAt: new Date("2026-10-16T18:00:00Z"), valid: false }),
    ]);

    expect(chosen).toEqual(["early"]);
  });

  it("keeps an admin override ahead of a later valid comment", () => {
    const chosen = resolveSelections([
      set({
        id: "chosen",
        postedAt: new Date("2026-10-16T09:00:00Z"),
        selection: "manual",
        selected: true,
      }),
      set({ id: "later", postedAt: new Date("2026-10-16T19:00:00Z"), valid: true }),
    ]);

    expect(chosen).toEqual(["chosen"]);
  });

  it("uses an incomplete slip only when the participant has no complete one", () => {
    const chosen = resolveSelections([
      set({ id: "partial", postedAt: new Date("2026-10-16T18:00:00Z"), valid: false, provisional: true }),
      set({ id: "complete", postedAt: new Date("2026-10-16T10:00:00Z"), valid: true, provisional: true }),
    ]);
    const onlyPartial = resolveSelections([
      set({ id: "partial", postedAt: new Date("2026-10-16T18:00:00Z"), valid: false, provisional: true }),
    ]);

    expect(chosen).toEqual(["complete"]);
    expect(onlyPartial).toEqual(["partial"]);
  });

  it("keeps both owners of one comment, and a manual override does not absorb the other owner", () => {
    const chosen = resolveSelections([
      set({ id: "balbes-auto", participantId: "balbes", postedAt: new Date("2026-11-06T12:00:00Z"), valid: true }),
      set({
        id: "neofit-manual",
        participantId: "neofit",
        postedAt: new Date("2026-11-06T12:00:00Z"),
        selection: "manual",
        selected: true,
      }),
      set({ id: "neofit-auto", participantId: "neofit", postedAt: new Date("2026-11-06T13:00:00Z"), valid: true }),
    ]);

    expect(chosen).toEqual(["balbes-auto", "neofit-manual"]);
  });

  it("selects nobody when every comment is invalid and none was chosen by hand", () => {
    expect(
      resolveSelections([
        set({ id: "a", postedAt: new Date("2026-10-16T10:00:00Z"), valid: false }),
        set({ id: "b", postedAt: new Date("2026-10-16T11:00:00Z"), valid: false }),
      ]),
    ).toEqual([]);
  });
});
