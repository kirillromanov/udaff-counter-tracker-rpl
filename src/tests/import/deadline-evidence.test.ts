import { describe, expect, it } from "vitest";
import { commentEditEvidence } from "@/lib/domain/forum/comment-edit";
import { exportAudit, type StoredBreakdown } from "@/lib/domain/export/export-audit";
import { fixtureDeadline } from "@/lib/domain/import/fixture-deadline";
import { mergePredictionCells } from "@/lib/domain/import/merge-predictions";
import { parseForumTimestamp } from "@/lib/domain/forum/extract-comments";
import { formatMoscow } from "@/lib/domain/time/moscow";
import { ARCHIVED_ROUND, countsTowardProduction } from "@/lib/domain/standings/round-role";

const published = new Date("2026-10-09T19:45:00.000Z");
const kickoff = new Date("2026-10-09T19:30:00.000Z");

function line(matchId: string, home: number, away: number) {
  return { matchId, home, away, ignored: false, warning: null };
}

describe("stored forum clock", () => {
  it("reads the permalink digits as a UTC minute and does not read a zone suffix", () => {
    const stored = parseForumTimestamp("09/10/2026 at 19:45");
    expect(stored?.toISOString()).toBe("2026-10-09T19:45:00.000Z");
    expect(parseForumTimestamp("09/10/2026 at 19:45 MSK")?.toISOString()).toBe(stored?.toISOString());
    expect(formatMoscow(stored as Date)).toBe("2026-10-09 22:45 UTC+3");
    expect(formatMoscow(kickoff)).toBe("2026-10-09 22:30 UTC+3");
    expect(fixtureDeadline(stored, kickoff)).toBe("late");
    const moscowReading = new Date((stored as Date).getTime() - 3 * 60 * 60 * 1000);
    expect(fixtureDeadline(moscowReading, kickoff)).toBe("eligible");
  });
});

describe("edit evidence from saved comment shape", () => {
  it("ignores an edit word, a strikethrough time, and an unrelated date outside comment metadata", () => {
    const html = `<div class="comment-meta commentmetadata">
<a href="https://example.test/#comment-4360">09/10/2026 at 19:45</a>
</div>
<p>Ростов — Акрон 2-2 изменено <del datetime="2026-10-09T16:45:00+00:00">1-1</del></p>`;
    expect(commentEditEvidence(html, published).editedAt).toBeNull();
  });

  it("does not treat an unrelated metadata date as an edit without an edit mark", () => {
    const html = `<div class="comment-meta">
<a href="#comment-1">09/10/2026 at 19:45</a>
<time datetime="2026-10-01T08:00:00+00:00">01/10/2026 at 08:00</time>
</div>
<p>2-2</p>`;
    expect(commentEditEvidence(html, published).editedAt).toBeNull();
  });

  it("rejects two different metadata times next to an edit mark", () => {
    const html = `<div class="comment-meta">Edited
<a href="#comment-1">09/10/2026 at 19:45</a>
<time datetime="2026-10-09T18:00:00.000Z">09/10/2026 at 18:00</time>
<time datetime="2026-10-09T18:30:00.000Z">09/10/2026 at 18:30</time>
</div>
<p>2-2</p>`;
    expect(commentEditEvidence(html, published).editedAt).toBeNull();
  });
});

describe("scored views and incremental comments", () => {
  it("exports the stored breakdown when a read-time merge would drop the late comment", () => {
    const cells = mergePredictionCells([{ id: "m1", kickoffAt: kickoff }], [
      { id: "late", postedAt: published, manual: false, predictions: [line("m1", 2, 2)] },
    ]);
    expect(cells[0]).toMatchObject({ state: "missing" });
    const breakdown: StoredBreakdown = {
      matches: [{
        label: "Ростов — Акрон",
        predicted: "2-2",
        actual: "1-0",
        baseCategory: "miss",
        basePoints: -1,
        bonusPoints: 0,
        mtMultiplier: 1,
        mtApplied: false,
        finalMatchPoints: -1,
        explanations: [],
      }],
      matchPointsTotal: -1,
      roundTotalGoalsBonus: 0,
      roundTotal: -1,
    };
    expect(exportAudit([{ name: "A", isWinner: false, breakdown }])).toContain("pred 2-2");
  });

  it("keeps a manual slip that was saved after kickoff", () => {
    const cells = mergePredictionCells([{ id: "m1", kickoffAt: kickoff }], [
      { id: "manual", postedAt: published, manual: true, predictions: [line("m1", 2, 1)] },
    ]);
    expect(cells[0]).toMatchObject({ state: "selected", home: 2, away: 1, setId: "manual" });
  });

  it("lets one later eligible comment add its own fixture", () => {
    const cells = mergePredictionCells(
      [
        { id: "first", kickoffAt: new Date("2026-10-09T16:00:00.000Z") },
        { id: "second", kickoffAt: new Date("2026-10-10T16:00:00.000Z") },
      ],
      [
        { id: "early", postedAt: new Date("2026-10-09T12:00:00.000Z"), manual: false, predictions: [line("first", 1, 0)] },
        { id: "next", postedAt: new Date("2026-10-09T18:00:00.000Z"), manual: false, predictions: [line("second", 0, 1)] },
      ],
    );
    expect(cells.find((cell) => cell.matchId === "first")).toMatchObject({ state: "selected", home: 1, away: 0, setId: "early" });
    expect(cells.find((cell) => cell.matchId === "second")).toMatchObject({ state: "selected", home: 0, away: 1, setId: "next" });
  });

  it("leaves an archived scored round out of the production season total", () => {
    expect(countsTowardProduction(ARCHIVED_ROUND, 12, 13, null)).toBe(false);
  });
});
