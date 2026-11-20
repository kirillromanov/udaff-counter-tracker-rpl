import { describe, expect, it } from "vitest";
import { planLegacyPublicationCorrections } from "@/lib/domain/import/legacy-publication";

function html(id: string, text: string): string {
  return `<div class="comment-meta"><a href="#comment-${id}">${text}</a></div><p>1-0</p>`;
}

describe("legacy publication corrections", () => {
  it("corrects only an exact legacy permalink and keeps minute precision", () => {
    const plan = planLegacyPublicationCorrections([
      {
        id: "legacy",
        externalId: "5694",
        postedAt: new Date("2026-11-19T18:10:00.000Z"),
        rawHtml: html("5694", "19/11/2026 at 18:10"),
      },
      {
        id: "ready",
        externalId: "5695",
        postedAt: new Date("2026-11-19T15:11:00.000Z"),
        rawHtml: html("5695", "19/11/2026 at 18:11"),
      },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.corrections).toEqual([{
      commentId: "legacy",
      externalId: "5694",
      permalink: "19/11/2026 at 18:10",
      classification: "legacy-offsetless",
      oldPostedAt: "2026-11-19T18:10:00.000Z",
      newPostedAt: "2026-11-19T15:10:00.000Z",
    }]);
    expect(plan.unchanged).toEqual([{ commentId: "ready", externalId: "5695", classification: "already-normalized" }]);
  });

  it("stops when the permalink is not this comment or the stored instant matches neither encoding", () => {
    const plan = planLegacyPublicationCorrections([
      {
        id: "other",
        externalId: "5694",
        postedAt: new Date("2026-11-19T18:10:00.000Z"),
        rawHtml: html("9999", "19/11/2026 at 18:10"),
      },
      {
        id: "odd",
        externalId: "5696",
        postedAt: new Date("2026-11-19T18:14:10.000Z"),
        rawHtml: html("5696", "19/11/2026 at 18:14"),
      },
    ]);
    expect(plan.corrections).toEqual([]);
    expect(plan.conflicts.map((item) => item.reason)).toEqual([
      "permalink-not-exact-offsetless",
      "postedAt-matches-neither-encoding",
    ]);
  });
});
