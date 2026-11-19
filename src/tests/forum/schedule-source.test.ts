import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractOpeningPost } from "@/lib/domain/forum/extract-comments";
import { chooseFixtureSchedule, earliestComment } from "@/lib/domain/forum/schedule-source";
import type { ForumPost } from "@/lib/domain/forum/types";
import { ensureRoundFixtures } from "@/lib/domain/import/ensure-fixtures";
import { RoundClosedError } from "@/lib/domain/rounds/round-lock";

const articleList = [
  "20.11.2026 19:30 Ростов — Крылья Советов",
  "21.11.2026 13:00 Оренбург — Балтика (МТ)",
].join("\n");

const commentList = ["22.11.2026 16:45 ЦСКА — Ахмат", "22.11.2026 19:00 Динамо — Краснодар (МТ)"].join("\n");

function comment(partial: {
  externalId: string;
  postedAt: Date | null;
  rawText: string;
}): ForumPost["comments"][number] {
  return {
    externalId: partial.externalId,
    authorName: "reader",
    postedAt: partial.postedAt,
    rawHtml: partial.rawText,
    rawText: partial.rawText,
  };
}

function post(openingText: string, comments: ForumPost["comments"] = []): ForumPost {
  return {
    title: "Тур",
    sourceUrl: "https://example.test/round",
    openingText,
    fetchedAt: new Date("2026-11-19T12:00:00.000Z"),
    comments,
  };
}

describe("article-first fixture schedule", () => {
  it("reads the Абразцы block, including a different ordinal, markup, and prose before the list", () => {
    const html = `
      <aside class="sidebar"><h2>Абразцы на десятый</h2><p>03.08.2026 12:00 Динамо — Сочи</p></aside>
      <div class="post-bodycopy">
        <h2>Абразцы на пятнадцатый</h2>
        <p>Ниже расписание. Пример 2:0 в тексте не является счётом матча.</p>
        <p>20.11.2026 19:30 Ростов — Крылья Советов<br>21.11.2026 13:00 Оренбург — Балтика (МТ)</p>
        <p>Дальше в статье другой раздел.</p>
        <p>02.08.2026 19:00 Спартак — ЦСКА</p>
      </div>
      <li id="comment-4"><p>22.11.2026 16:45 ЦСКА — Ахмат</p></li>
    `;
    const chosen = chooseFixtureSchedule(post(extractOpeningPost(html), [comment({
      externalId: "4",
      postedAt: new Date("2026-11-01T10:00:00.000Z"),
      rawText: commentList,
    })]));
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) {
      return;
    }
    expect(chosen.source).toBe("article_body");
    expect(chosen.fixtures.map((fixture) => `${fixture.homeTeam} — ${fixture.awayTeam}`)).toEqual([
      "Ростов — Крылья Советов",
      "Оренбург — Балтика",
    ]);
    expect(chosen.fixtures[0]?.kickoffAt?.toISOString()).toBe("2026-11-20T16:30:00.000Z");
    expect(chosen.fixtures[1]?.isMatchOfTheRound).toBe(true);
    expect(chosen.excerpt).not.toContain("Спартак");
    expect(chosen.excerpt).not.toContain("Сочи");
    expect(chosen.excerpt).not.toContain("2:0");

    const mixed = extractOpeningPost(`
      <div class="post-bodycopy"><h2>аБрАзЦы&nbsp;на двадцатый</h2>
      <p>Пояснение между заголовком и списком.</p>
      <p>01.08.2026 14:00 Акрон — Рубин<br>01.08.2026 16:00 Оренбург — Зенит (МТ)</p></div>
    `);
    const other = chooseFixtureSchedule(post(mixed));
    expect(other.ok && other.fixtures.map((fixture) => fixture.homeTeam)).toEqual(["Акрон", "Оренбург"]);
  });

  it("keeps a valid article when the first comment has a different schedule", () => {
    const chosen = chooseFixtureSchedule(
      post(`Абразцы на пятнадцатый\nПояснение\n${articleList}\nДальше текст`, [
        comment({ externalId: "9", postedAt: new Date("2026-11-01T08:00:00.000Z"), rawText: commentList }),
      ]),
    );
    expect(chosen.ok && chosen.source).toBe("article_body");
    expect(chosen.ok && chosen.fixtures[0]?.homeTeam).toBe("Ростов");
  });

  it("uses the earliest comment when the article schedule cannot be read", () => {
    const chosen = chooseFixtureSchedule(
      post("В статье нет расписания.", [
        comment({
          externalId: "30",
          postedAt: new Date("2026-11-02T08:00:00.000Z"),
          rawText: "22.11.2026 19:30 Ростов — Крылья Советов 1:0",
        }),
        comment({
          externalId: "2",
          postedAt: new Date("2026-11-01T08:00:00.000Z"),
          rawText: commentList,
        }),
      ]),
    );
    expect(chosen.ok && chosen.source).toBe("first_comment_fallback");
    expect(chosen.ok && chosen.fallbackReason).toContain("Абразцы");
    expect(chosen.ok && chosen.fixtures.map((fixture) => fixture.homeTeam)).toEqual(["ЦСКА", "Динамо"]);
    expect(earliestComment([
      { postedAt: new Date("2026-11-02T00:00:00.000Z"), externalId: "1" },
      { postedAt: new Date("2026-11-01T00:00:00.000Z"), externalId: "8" },
    ])?.externalId).toBe("8");
  });

  it("does not keep a partial or conflicting article schedule", () => {
    const conflicting = chooseFixtureSchedule(
      post(
        [
          "Абразцы на пятнадцатый",
          "20.11.2026 19:30 Ростов — Крылья Советов",
          "20.11.2026 20:00 Ростов — Крылья Советов",
        ].join("\n"),
        [comment({ externalId: "2", postedAt: new Date("2026-11-01T08:00:00.000Z"), rawText: commentList })],
      ),
    );
    expect(conflicting.ok && conflicting.source).toBe("first_comment_fallback");
    expect(conflicting.ok && conflicting.fixtures.map((fixture) => fixture.homeTeam)).toEqual(["ЦСКА", "Динамо"]);

    const broken = chooseFixtureSchedule(
      post(
        ["Абразцы на пятнадцатый", "20.11.2026 19:30 Ростов — Крылья Советов 1:0", articleList.split("\n")[1]].join("\n"),
        [comment({ externalId: "2", postedAt: new Date("2026-11-01T08:00:00.000Z"), rawText: commentList })],
      ),
    );
    expect(broken.ok && broken.source).toBe("first_comment_fallback");
    expect(broken.ok && broken.excerpt).not.toContain("Ростов");

    const twoMarks = chooseFixtureSchedule(
      post(
        "Абразцы на пятнадцатый\n20.11.2026 19:30 Ростов — Крылья Советов (МТ)\n21.11.2026 13:00 Оренбург — Балтика (МТ)",
        [comment({ externalId: "2", postedAt: new Date("2026-11-01T08:00:00.000Z"), rawText: commentList })],
      ),
    );
    expect(twoMarks.ok && twoMarks.source).toBe("first_comment_fallback");
  });

  it("writes nothing when both the article and the first comment are unusable", async () => {
    const writes: string[] = [];
    const db = {
      match: {
        count: async () => 0,
        createMany: async () => {
          writes.push("match");
        },
      },
      round: {
        findUnique: async () => ({ sourceSnapshot: null }),
        update: async () => {
          writes.push("round");
        },
      },
    };
    const source = post(
      "Абразцы на пятнадцатый\n20.11.2026 19:30 Ростов — Крылья Советов 2:1",
      [comment({ externalId: "1", postedAt: new Date("2026-11-01T08:00:00.000Z"), rawText: "не расписание" })],
    );
    await expect(ensureRoundFixtures("round", source, { db, assertMutable: async () => undefined })).rejects.toThrow(
      /No fixtures were saved/,
    );
    expect(writes).toEqual([]);
  });

  it("leaves saved fixtures unchanged and creates a missing list only once", async () => {
    let count = 8;
    let created = 0;
    const db = {
      match: {
        count: async () => count,
        createMany: async ({ data }: { data: unknown[] }) => {
          created += 1;
          count += data.length;
        },
      },
      round: {
        findUnique: async () => ({ sourceSnapshot: "already saved" }),
        update: async () => undefined,
      },
    };
    const source = post(`Абразцы на пятнадцатый\n${articleList}`);
    const kept = await ensureRoundFixtures("round", source, { db, assertMutable: async () => undefined });
    expect(kept).toMatchObject({ created: false, count: 8 });
    expect(created).toBe(0);

    count = 0;
    const first = await ensureRoundFixtures("round", source, { db, assertMutable: async () => undefined });
    const second = await ensureRoundFixtures("round", source, { db, assertMutable: async () => undefined });
    expect(first.created).toBe(true);
    expect(first.notes.join("\n")).toContain("Fixture source: article_body");
    expect(second.created).toBe(false);
    expect(created).toBe(1);
  });

  it("rejects a closed round before creating fixtures", async () => {
    let created = 0;
    await expect(
      ensureRoundFixtures("round", post(`Абразцы на пятнадцатый\n${articleList}`), {
        db: {
          match: {
            count: async () => 0,
            createMany: async () => {
              created += 1;
            },
          },
          round: {
            findUnique: async () => ({ sourceSnapshot: null }),
            update: async () => undefined,
          },
        },
        assertMutable: async () => {
          throw new RoundClosedError();
        },
      }),
    ).rejects.toThrow(RoundClosedError);
    expect(created).toBe(0);
  });

  it("bootstraps fixtures before prediction parsing on refresh", () => {
    const refresh = readFileSync("src/lib/domain/import/refresh-predictions.ts", "utf8");
    const ensureAt = refresh.indexOf("await ensureRoundFixtures");
    const saveAt = refresh.indexOf("await saveForumPost");
    const parseAt = refresh.indexOf("await parseStoredComments");
    expect(ensureAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(ensureAt);
    expect(parseAt).toBeGreaterThan(saveAt);
    expect(refresh).not.toContain("sourceSnapshot: post.openingText");
  });
});
