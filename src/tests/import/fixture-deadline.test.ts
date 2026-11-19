import { describe, expect, it } from "vitest";
import { commentEditEvidence } from "@/lib/domain/forum/comment-edit";
import { editWritePlan, fixtureDeadline } from "@/lib/domain/import/fixture-deadline";
import { mergePredictionCells } from "@/lib/domain/import/merge-predictions";

const kickoff = new Date("2026-11-20T16:30:00.000Z");
const before = new Date("2026-11-20T16:29:00.000Z");
const after = new Date("2026-11-20T16:31:00.000Z");

function line(matchId: string, home: number, away: number) {
  return { matchId, home, away, ignored: false, warning: null };
}

describe("per-fixture publication deadline", () => {
  it("accepts a publication before kickoff and rejects the kickoff instant", () => {
    expect(fixtureDeadline(before, kickoff)).toBe("eligible");
    expect(fixtureDeadline(kickoff, kickoff)).toBe("late");
    expect(fixtureDeadline(after, kickoff)).toBe("late");
    expect(fixtureDeadline(null, kickoff)).toBe("unknown");
    expect(fixtureDeadline(before, null)).toBe("unknown");
  });

  it("keeps an earlier fixture when a later comment names only another one", () => {
    const cells = mergePredictionCells(
      [
        { id: "early", kickoffAt: kickoff },
        { id: "later", kickoffAt: new Date("2026-11-21T16:30:00.000Z") },
      ],
      [
        {
          id: "first",
          postedAt: new Date("2026-11-20T12:00:00.000Z"),
          manual: false,
          predictions: [line("early", 1, 0), line("later", 0, 0)],
        },
        {
          id: "second",
          postedAt: new Date("2026-11-20T18:00:00.000Z"),
          manual: false,
          predictions: [line("later", 2, 1)],
        },
      ],
    );
    expect(cells.find((cell) => cell.matchId === "early")).toMatchObject({ state: "selected", home: 1, away: 0, setId: "first" });
    expect(cells.find((cell) => cell.matchId === "later")).toMatchObject({ state: "selected", home: 2, away: 1, setId: "second" });
  });

  it("does not let a late revision replace an eligible prediction", () => {
    const cells = mergePredictionCells([{ id: "m1", kickoffAt: kickoff }], [
      { id: "early", postedAt: before, manual: false, predictions: [line("m1", 1, 0)] },
      { id: "late", postedAt: kickoff, manual: false, predictions: [line("m1", 4, 4)] },
    ]);
    expect(cells[0]).toMatchObject({ state: "selected", home: 1, away: 0, setId: "early" });
  });

  it("keeps only the fixtures in one comment that are still before kickoff", () => {
    const posted = new Date("2026-11-20T17:00:00.000Z");
    const cells = mergePredictionCells(
      [
        { id: "started", kickoffAt: kickoff },
        { id: "future", kickoffAt: new Date("2026-11-21T16:30:00.000Z") },
      ],
      [{
        id: "one",
        postedAt: posted,
        manual: false,
        predictions: [line("started", 1, 0), line("future", 2, 0)],
      }],
    );
    expect(cells.find((cell) => cell.matchId === "started")).toMatchObject({ state: "missing" });
    expect(cells.find((cell) => cell.matchId === "future")).toMatchObject({ state: "selected", home: 2, away: 0, setId: "one" });
  });

  it("sends a prediction with no publication time to review", () => {
    const cells = mergePredictionCells([{ id: "m1", kickoffAt: kickoff }], [
      { id: "untimed", postedAt: null, manual: false, predictions: [line("m1", 1, 0)] },
    ]);
    expect(cells[0]).toMatchObject({ state: "review", setIds: ["untimed"] });
  });

  it("does not use a missing publication time as an eligible revision", () => {
    const cells = mergePredictionCells([{ id: "m1", kickoffAt: kickoff }], [
      { id: "early", postedAt: before, manual: false, predictions: [line("m1", 1, 0)] },
      { id: "untimed", postedAt: null, manual: false, predictions: [line("m1", 9, 9)] },
    ]);
    expect(cells[0]).toMatchObject({ state: "selected", home: 1, away: 0, setId: "early" });
  });

  it("uses a reliable edit timestamp instead of the original publication time", () => {
    const cells = mergePredictionCells([{ id: "m1", kickoffAt: kickoff }], [
      { id: "original", postedAt: before, manual: false, predictions: [line("m1", 1, 0)] },
      { id: "edited", postedAt: before, editedAt: after, manual: false, predictions: [line("m1", 3, 3)] },
    ]);
    expect(cells[0]).toMatchObject({ state: "selected", home: 1, away: 0, setId: "original" });
  });

  it("reads an edit time only from metadata that is not the permalink", () => {
    const published = new Date("2026-11-20T10:00:00.000Z");
    const html = `<div class="comment-meta">Edited <time datetime="2026-11-20T18:00:00.000Z">20/11/2026 at 18:00</time>
<a href="#comment-1">20/11/2026 at 10:00</a></div><p>edited my mind 2-1</p>`;
    expect(commentEditEvidence(html, published).editedAt?.toISOString()).toBe("2026-11-20T18:00:00.000Z");
    expect(commentEditEvidence(`<div class="comment-meta"><a href="#comment-1">20/11/2026 at 10:00</a></div><p>2-1</p>`, published).editedAt).toBeNull();
  });

  it("writes only fixtures whose edit time is before kickoff", () => {
    const plan = editWritePlan({
      editedAt: kickoff,
      fixtures: [
        { id: "started", kickoffAt: kickoff },
        { id: "future", kickoffAt: new Date("2026-11-21T16:30:00.000Z") },
      ],
      incomingMatchIds: ["started", "future", "other"],
    });
    expect(plan.writeMatchIds).toEqual(["future"]);
    expect(plan.note).toContain("left in place");
    expect(editWritePlan({ editedAt: null, fixtures: [], incomingMatchIds: ["started"] }).writeMatchIds).toEqual([]);
  });
});
