import { describe, expect, it } from "vitest";
import { readFixtureLine } from "@/lib/domain/forum/parse-schedule";
import { mergePredictionCells } from "@/lib/domain/import/merge-predictions";
import {
  classifyStoredPublication,
  normalizeOffsetlessPublication,
  parseExplicitOffset,
  parseForumTimestamp,
} from "@/lib/domain/time/publication-clock";

const permalink = "09/10/2026 at 19:45";
const legacyHtml = `<div class="comment-meta"><a href="#comment-4360">${permalink}</a></div><p>2-2</p>`;

describe("forum publication clock", () => {
  it("converts offset-less site-local text once and keeps an explicit offset", () => {
    expect(parseForumTimestamp(permalink)?.toISOString()).toBe("2026-10-09T19:45:00.000Z");
    const normalized = normalizeOffsetlessPublication(permalink);
    expect(normalized?.toISOString()).toBe("2026-10-09T16:45:00.000Z");
    expect(parseExplicitOffset("2026-10-09T16:45:00+00:00")?.toISOString()).toBe("2026-10-09T16:45:00.000Z");
    expect(parseExplicitOffset("2026-10-09T19:45:00+03:00")?.toISOString()).toBe(normalized?.toISOString());
    expect(normalizeOffsetlessPublication(permalink)?.toISOString()).toBe(normalized?.toISOString());
  });

  it("leaves a legacy stored permalink uncertain and does not call it late", () => {
    const legacy = parseForumTimestamp(permalink);
    expect(classifyStoredPublication(legacy, legacyHtml)).toEqual({ kind: "uncertain", reason: "legacy-offsetless" });
    const kickoff = readFixtureLine("09.10.2026 22:30 Ростов - Акрон")?.kickoffAt ?? null;
    expect(kickoff?.toISOString()).toBe("2026-10-09T19:30:00.000Z");
    const cells = mergePredictionCells([{ id: "m1", kickoffAt: kickoff }], [{
      id: "legacy",
      postedAt: legacy,
      rawHtml: legacyHtml,
      manual: false,
      predictions: [{ matchId: "m1", home: 2, away: 2, ignored: false, warning: null }],
    }]);
    expect(cells[0]).toMatchObject({ state: "review", reason: "uncertain-time" });
  });

  it("uses a stored instant that already matches the normalized permalink", () => {
    const normalized = normalizeOffsetlessPublication(permalink);
    expect(classifyStoredPublication(normalized, legacyHtml)).toEqual({ kind: "normalized", at: normalized });
    const cells = mergePredictionCells([{ id: "m1", kickoffAt: new Date("2026-10-09T19:30:00.000Z") }], [{
      id: "ready",
      postedAt: normalized,
      rawHtml: legacyHtml,
      manual: false,
      predictions: [{ matchId: "m1", home: 2, away: 2, ignored: false, warning: null }],
    }]);
    expect(cells[0]).toMatchObject({ state: "selected", home: 2, away: 2 });
  });
});
