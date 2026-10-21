import { describe, expect, it } from "vitest";
import { extractOpeningPost } from "@/lib/domain/forum/extract-comments";
import { parseFixtureSchedule } from "@/lib/domain/forum/parse-schedule";
import { importNeedsReview, isAcceptableImport } from "@/lib/domain/import/accept-import";
import { identityOwner, normalizeParticipantName } from "@/lib/domain/participants/identity";
import { parseComment, rowsForStorage } from "@/lib/domain/parser/parse-comment";
import type { FixtureRef } from "@/lib/domain/parser/types";

const round1 = `
ЦСКА — Балтика
1 ▲ 1 ==Hordi Cruyff ☼ ================= 219
24.07.2026 20:00 — ЦСКА — Балтика
25.07.2026 14:00 — Динамо — Крылья Советов
25.07.2026 16:15 — Акрон — Зенит
25.07.2026 18:30 — Факел — Динамо Махачкала
25.07.2026 20:45 — Спартак — Родина
26.07.2026 14:30 — Оренбург — Ростов
26.07.2026 17:00 — Локомотив — Ахмат
26.07.2026 19:30 — Рубин — Краснодар (МТ)
26.07.2026 19:30 Рубин — Краснодар
`;

const round9 = `
16.09, 18:30 — Спартак — Факел
16.09.2026 18:30 Спартак – Факел
16.09.2026 18:30 Родина – Рубин
16.09.2026 20:45 Балтика – Зенит
16.09.2026 20:45 Локомотив – Крылья Советов
17.09.2026 16:15 Оренбург – Краснодар
17.09.2026 18:30 Ростов – Динамо
17.09.2026 18:30 Акрон – Ахмат
17.09.2026 20:45 Динамо Мх – ЦСКА
`;

describe("parseFixtureSchedule", () => {
  it("reads eight dated fixtures and keeps the Match of the Round mark", () => {
    const schedule = parseFixtureSchedule(round1);
    expect(schedule.fixtures).toHaveLength(8);
    expect(schedule.warnings).toEqual([]);
    expect(schedule.fixtures[0]).toMatchObject({ homeTeam: "ЦСКА", awayTeam: "Балтика" });
    expect(schedule.fixtures[7]).toMatchObject({
      homeTeam: "Рубин",
      awayTeam: "Краснодар",
      isMatchOfTheRound: true,
    });
    expect(schedule.fixtures[0]?.kickoffAt?.toISOString()).toBe("2026-07-24T20:00:00.000Z");
  });

  it("accepts a short date and an en dash, and warns when no match is marked", () => {
    const schedule = parseFixtureSchedule(round9);
    expect(schedule.fixtures.map((fixture) => `${fixture.homeTeam} — ${fixture.awayTeam}`)).toEqual([
      "Спартак — Факел",
      "Родина — Рубин",
      "Балтика — Зенит",
      "Локомотив — Крылья Советов",
      "Оренбург — Краснодар",
      "Ростов — Динамо",
      "Акрон — Ахмат",
      "Динамо Мх — ЦСКА",
    ]);
    expect(schedule.fixtures.every((fixture) => !fixture.isMatchOfTheRound)).toBe(true);
    expect(schedule.warnings).toEqual(["No Match of the Round was marked in the opening post"]);
  });

  it("drops every Match of the Round mark when the post marks two", () => {
    const schedule = parseFixtureSchedule("01.08.2026 14:00 Акрон — Рубин (МТ)\n01.08.2026 16:00 Оренбург — Зенит (MT)");
    expect(schedule.fixtures.every((fixture) => !fixture.isMatchOfTheRound)).toBe(true);
    expect(schedule.warnings.join(" ")).toContain("More than one");
  });
});

describe("import acceptance", () => {
  const row = { ignored: false, homeGoals: 1, awayGoals: 0, warning: null };

  it("accepts a complete clean slip and holds back incomplete or conflicting ones", () => {
    expect(
      isAcceptableImport({ warnings: [], unmatchedLines: 0, fixtureCount: 1, predictions: [row] }),
    ).toBe(true);
    expect(
      importNeedsReview({
        warnings: ["No prediction for Родина — Оренбург"],
        unmatchedLines: 0,
        fixtureCount: 2,
        predictions: [row],
      }),
    ).toBe(true);
    expect(
      isAcceptableImport({
        warnings: ["Duplicate prediction for a fixture; kept the stronger line"],
        unmatchedLines: 0,
        fixtureCount: 1,
        predictions: [row],
      }),
    ).toBe(false);
    expect(
      importNeedsReview({
        warnings: ["No prediction for Родина — Оренбург", "No prediction for Зенит — Ахмат"],
        unmatchedLines: 0,
        fixtureCount: 2,
        predictions: [],
      }),
    ).toBe(false);
  });
});

describe("registry matching for import", () => {
  const registry = [
    { participantId: "yosh", normalized: normalizeParticipantName("Йош!") },
    { participantId: "pavel", normalized: normalizeParticipantName("Павел Абросимов") },
  ];

  it("uses the registry key and does not attach a shorter name", () => {
    expect(identityOwner(normalizeParticipantName("йош"), registry)).toBe("yosh");
    expect(identityOwner(normalizeParticipantName("Павел"), registry)).toBeNull();
    expect(identityOwner(normalizeParticipantName("Хорди"), registry)).toBeNull();
  });
});

describe("noisy round slips", () => {
  const fixtures: FixtureRef[] = [
    { id: "sp-fk", homeTeam: "Спартак", awayTeam: "Факел" },
    { id: "rd-rb", homeTeam: "Родина", awayTeam: "Рубин" },
    { id: "bl-zn", homeTeam: "Балтика", awayTeam: "Зенит" },
    { id: "lk-ks", homeTeam: "Локомотив", awayTeam: "Крылья Советов" },
    { id: "or-kr", homeTeam: "Оренбург", awayTeam: "Краснодар" },
    { id: "rs-dn", homeTeam: "Ростов", awayTeam: "Динамо" },
    { id: "ak-ah", homeTeam: "Акрон", awayTeam: "Ахмат" },
    { id: "mh-cs", homeTeam: "Динамо Махачкала", awayTeam: "ЦСКА" },
  ];

  it("reads an en-dash slip and keeps a user Match of the Round mark off the official fixture", () => {
    const parsed = parseComment(
      [
        "16.09.2026 18:30 Спартак – Факел 4-1",
        "16.09.2026 18:30 Родина – Рубин 2-2",
        "16.09.2026 20:45 Балтика – Зенит 1-1",
        "16.09.2026 20:45 Локомотив – Крылья Советов 3-2",
        "17.09.2026 16:15 Оренбург – Краснодар 2-3",
        "17.09.2026 18:30 Ростов – Динамо 3-2",
        "17.09.2026 18:30 Акрон – Ахмат 1-2",
        "17.09.2026 20:45 Динамо Мх – ЦСКА (МТ) 1-1",
        "ну и таблица прошлого тура, это не прогноз",
      ].join("\n"),
      fixtures,
    );
    const rows = rowsForStorage(parsed);
    expect(rows).toHaveLength(8);
    expect(rows.find((row) => row.fixtureId === "mh-cs")).toMatchObject({
      homeGoals: 1,
      awayGoals: 1,
      markedAsMt: true,
    });
    const numbered = parseComment("1. 31.07.2026 20:00 Родина-Ростов 2-1\n5. 01.08.2026 20:45 Балтика-Динамо (МТ) 0-1", [
      { id: "rr", homeTeam: "Родина", awayTeam: "Ростов" },
      { id: "bd", homeTeam: "Балтика", awayTeam: "Динамо" },
    ]);
    expect(rowsForStorage(numbered).map((row) => [row.fixtureId, row.homeGoals, row.awayGoals, row.markedAsMt])).toEqual([
      ["rr", 2, 1, false],
      ["bd", 0, 1, true],
    ]);
    expect(parsed.warnings.some((warning) => warning.toLowerCase().includes("ambiguous"))).toBe(false);
  });
});

describe("extractOpeningPost", () => {
  it("keeps the post body and stops at the first comment", () => {
    const text = extractOpeningPost(`
      <div class="post-bodycopy clearfix"><p>26.07.2026 19:30 — Рубин — Краснодар (МТ)</p></div>
      <li id="comment-9"><p>Спартак — Родина 1-0</p></li>
    `);
    expect(text).toContain("Рубин — Краснодар (МТ)");
    expect(text).not.toContain("Спартак");
  });
});
