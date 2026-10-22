import { describe, expect, it } from "vitest";
import {
  authorIdentityKey,
  classifyIncomingComment,
  countThisFetch,
  ingestionStatusLabel,
  planPredictionRefresh,
  resolveIngestionStatus,
  selectDuePredictionRoundIds,
  shouldReplaceStoredSlip,
  type StoredCommentShape,
} from "@/lib/domain/import/incremental";
import { ARCHIVED_ROUND, OPERATIONAL_ROUND } from "@/lib/domain/standings/round-role";
import type { PollFixture } from "@/lib/domain/results/poll";

const now = new Date("2026-10-22T18:00:00Z");
const intervals = { regularMinutes: 60, liveMinutes: 15 };

function stored(overrides: Partial<StoredCommentShape> = {}): StoredCommentShape {
  return { externalId: "1", authorKey: "participant:alpha", text: "Зенит 2-1", ...overrides };
}

function fixture(overrides: Partial<PollFixture> = {}): PollFixture {
  return {
    kickoffAt: new Date("2026-10-22T20:00:00Z"),
    actualHomeGoals: null,
    actualAwayGoals: null,
    resultState: "open",
    resultResolution: "",
    resultConflict: false,
    conflictAcknowledgedAt: null,
    ...overrides,
  };
}

describe("incremental prediction comments", () => {
  it("classifies a new comment, an unchanged refetch, an edit, and a repost", () => {
    const existing = [stored()];
    expect(classifyIncomingComment({ externalId: "2", authorKey: "participant:beta", text: "Спартак 1-0", stored: existing })).toBe("new");
    expect(classifyIncomingComment({ externalId: "1", authorKey: "participant:alpha", text: "Зенит   2-1", stored: existing })).toBe("unchanged");
    expect(classifyIncomingComment({ externalId: "1", authorKey: "participant:alpha", text: "Зенит 3-1", stored: existing })).toBe("updated");
    expect(classifyIncomingComment({ externalId: "9", authorKey: "participant:alpha", text: "Зенит 2-1", stored: existing })).toBe("duplicate");
    expect(classifyIncomingComment({ externalId: null, authorKey: "participant:alpha", text: "Зенит 2-1", stored: existing })).toBe("skipped");
  });

  it("treats an alias repost as the same participant and leaves an ignored nick separate", () => {
    const aliasKey = authorIdentityKey({ participantId: "alpha", authorName: "Павел" });
    const canonicalKey = authorIdentityKey({ participantId: "alpha", authorName: "Павел Абросимов" });
    const ignoredKey = authorIdentityKey({ participantId: null, authorName: "LAX" });
    expect(aliasKey).toBe(canonicalKey);
    const existing = [stored({ authorKey: canonicalKey, text: "Зенит 2-1" })];
    expect(classifyIncomingComment({ externalId: "9", authorKey: aliasKey, text: "Зенит 2-1", stored: existing })).toBe("duplicate");
    expect(classifyIncomingComment({ externalId: "10", authorKey: ignoredKey, text: "Зенит 2-1", stored: existing })).toBe("new");
  });

  it("maps identity and manual edits onto a reviewable status without a second slip", () => {
    expect(resolveIngestionStatus("new", "alias", false)).toBe("new");
    expect(resolveIngestionStatus("new", "ignored", false)).toBe("ignored");
    expect(resolveIngestionStatus("new", "uncertain", false)).toBe("flagged");
    expect(resolveIngestionStatus("new", "unknown", false)).toBe("flagged");
    expect(resolveIngestionStatus("updated", "participant", true)).toBe("flagged");
    expect(resolveIngestionStatus("duplicate", "participant", false)).toBe("duplicate");
    expect(shouldReplaceStoredSlip("updated", true, true)).toBe(false);
    expect(shouldReplaceStoredSlip("duplicate", false, false)).toBe(false);
    expect(shouldReplaceStoredSlip("unchanged", false, true)).toBe(false);
    expect(shouldReplaceStoredSlip("unchanged", false, false)).toBe(true);
    expect(shouldReplaceStoredSlip("updated", false, true)).toBe(true);
    expect(ingestionStatusLabel("duplicate")).toBe("Duplicate comment");
    expect(ingestionStatusLabel("ignored")).toBe("Ignored user");
  });

  it("counts a refetch of the same text as unchanged even when the stored status is still new", () => {
    const counts = countThisFetch(
      [
        { externalId: "1", content: "unchanged" },
        { externalId: "2", content: "new" },
        { externalId: "3", content: "updated" },
      ],
      new Map([
        ["1", "new"],
        ["2", "ignored"],
        ["3", "flagged"],
      ]),
    );
    expect(counts).toMatchObject({ unchanged: 1, ignored: 1, flagged: 1, new: 0, updated: 0 });
  });

  it("schedules active rounds and skips archived or finalized ones", () => {
    const upcoming = planPredictionRefresh(
      { standingRole: OPERATIONAL_ROUND, hasForumUrl: true, fixtures: [fixture()] },
      now,
      intervals,
    );
    const live = planPredictionRefresh(
      { standingRole: OPERATIONAL_ROUND, hasForumUrl: true, fixtures: [fixture({ kickoffAt: new Date("2026-10-22T16:00:00Z") })] },
      now,
      intervals,
    );
    const archived = planPredictionRefresh(
      { standingRole: ARCHIVED_ROUND, hasForumUrl: true, fixtures: [fixture()] },
      now,
      intervals,
    );
    const finalized = planPredictionRefresh(
      {
        standingRole: OPERATIONAL_ROUND,
        hasForumUrl: true,
        fixtures: [fixture({ actualHomeGoals: 1, actualAwayGoals: 0, resultState: "verified", resultResolution: "verified" })],
      },
      now,
      intervals,
    );
    expect(upcoming.active).toBe(true);
    expect(upcoming.nextAt?.toISOString()).toBe(new Date("2026-10-22T19:00:00Z").toISOString());
    expect(live.active).toBe(true);
    expect(live.nextAt?.toISOString()).toBe(new Date("2026-10-22T18:15:00Z").toISOString());
    expect(archived.active).toBe(false);
    expect(finalized.active).toBe(false);

    const due = selectDuePredictionRoundIds(
      [
        { id: "archived", standingRole: ARCHIVED_ROUND, forumUrl: "https://example.test/a", nextPredictionFetchAt: null, matches: [fixture()] },
        { id: "final", standingRole: OPERATIONAL_ROUND, forumUrl: "https://example.test/f", nextPredictionFetchAt: null, matches: [fixture({ actualHomeGoals: 1, actualAwayGoals: 0, resultState: "verified", resultResolution: "verified" })] },
        { id: "later", standingRole: OPERATIONAL_ROUND, forumUrl: "https://example.test/l", nextPredictionFetchAt: new Date("2026-10-22T19:00:00Z"), matches: [fixture()] },
        { id: "due", standingRole: OPERATIONAL_ROUND, forumUrl: "https://example.test/d", nextPredictionFetchAt: new Date("2026-10-22T17:00:00Z"), matches: [fixture()] },
      ],
      now,
      intervals,
    );
    expect(due).toEqual(["due"]);
    expect(
      selectDuePredictionRoundIds(
        [{ id: "later", standingRole: OPERATIONAL_ROUND, forumUrl: "https://example.test/l", nextPredictionFetchAt: new Date("2026-10-22T19:00:00Z"), matches: [fixture()] }],
        now,
        intervals,
        "later",
      ),
    ).toEqual(["later"]);
  });
});
