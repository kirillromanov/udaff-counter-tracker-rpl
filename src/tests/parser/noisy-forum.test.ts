import { describe, expect, it } from "vitest";
import { parseComment, rowsForStorage } from "@/lib/domain/parser/parse-comment";
import { parsePredictionLine } from "@/lib/domain/parser/parse-prediction-line";
import type { FixtureRef } from "@/lib/domain/parser/types";

const fixtures: FixtureRef[] = [
  { id: "ks", homeTeam: "Крылья Советов", awayTeam: "Факел" },
  { id: "dm", homeTeam: "Динамо Махачкала", awayTeam: "Акрон" },
  { id: "lok", homeTeam: "Локомотив", awayTeam: "Краснодар" },
  { id: "zen", homeTeam: "Зенит", awayTeam: "Ахмат" },
  { id: "din", homeTeam: "Динамо", awayTeam: "ЦСКА" },
  { id: "spa", homeTeam: "Спартак", awayTeam: "Рубин" },
  { id: "bal", homeTeam: "Балтика", awayTeam: "Ростов" },
  { id: "rod", homeTeam: "Родина", awayTeam: "Оренбург" },
];

describe("noisy forum slips", () => {
  it("reads slang, tight hyphens, mixed separators, and trailing noise", () => {
    const parsed = parseComment(
      [
        "ну короче, пока так, допишу вечером",
        "Зенит-Ахмат 2-0!",
        "короче Локомотив — Краснодар 1:2 имхо жир",
        "Динамо — ЦСКА (МТ) 1:1",
        "Спартак 3-0 Рубин, ну это база",
        "Балтика - Ростов 1–1",
        "Кр. Советов — Факел 2:0 кста",
        "Динамо-Мх 1-0 Акрон",
        "кто не согласен — пишите, я всё равно поставлю",
      ].join("\n"),
      fixtures,
    );
    const rows = rowsForStorage(parsed);

    expect(rows.map((row) => [row.fixtureId, row.homeGoals, row.awayGoals, row.markedAsMt])).toEqual([
      ["zen", 2, 0, false],
      ["lok", 1, 2, false],
      ["din", 1, 1, true],
      ["spa", 3, 0, false],
      ["bal", 1, 1, false],
      ["ks", 2, 0, false],
      ["dm", 1, 0, false],
    ]);
    expect(parsed.lines.some((line) => line.rawLine.includes("кто не согласен"))).toBe(false);
    expect(parsed.warnings).toContain("No prediction for Родина — Оренбург");
    expect(parsed.warnings.filter((warning) => warning.startsWith("No prediction"))).toHaveLength(1);
  });

  it("keeps a star MT mark from being read as the score", () => {
    const line = parsePredictionLine("18.10 16:15 Динамо — ЦСКА *²");
    const parsed = parseComment("Динамо — ЦСКА *²\nЗенит-Ахмат 0:1.", fixtures);

    expect(line).toMatchObject({
      markedAsMt: true,
      homeGoals: null,
      awayGoals: null,
      warnings: ["Missing score"],
    });
    expect(rowsForStorage(parsed).map((row) => [row.fixtureId, row.homeGoals, row.awayGoals, row.markedAsMt])).toEqual([
      ["din", null, null, true],
      ["zen", 0, 1, false],
    ]);
  });

  it("warns when home and away are reversed and keeps the written score", () => {
    const parsed = parseComment("Ахмат — Зенит 0-2\nФакел - Крылья Советов 1:0", fixtures);
    const rows = rowsForStorage(parsed);

    expect(rows.map((row) => [row.fixtureId, row.homeGoals, row.awayGoals, row.swapped])).toEqual([
      ["zen", 0, 2, true],
      ["ks", 1, 0, true],
    ]);
    expect(parsed.warnings).toEqual([
      "Home and away look swapped for Зенит — Ахмат",
      "Home and away look swapped for Крылья Советов — Факел",
      "No prediction for Динамо Махачкала — Акрон",
      "No prediction for Локомотив — Краснодар",
      "No prediction for Динамо — ЦСКА",
      "No prediction for Спартак — Рубин",
      "No prediction for Балтика — Ростов",
      "No prediction for Родина — Оренбург",
    ]);
  });

  it("lets a later score on the same line replace the slip", () => {
    const parsed = parseComment("Зенит — Ахмат 2-0, хотя 1-1 тоже напрашивается", fixtures);

    expect(rowsForStorage(parsed)[0]).toMatchObject({
      fixtureId: "zen",
      homeGoals: 1,
      awayGoals: 1,
    });
  });

  it("does not invent a fixture from a slash or versus separator", () => {
    const slash = parseComment("Зенит/Ахмат 2-0\nРодина — Оренбург 1-0", fixtures);
    const versus = parseComment("Зенит vs Ахмат 2-0", fixtures);

    expect(slash.lines.find((line) => line.rawLine.startsWith("Зенит/"))?.warnings).toContain(
      "Malformed prediction line",
    );
    expect(rowsForStorage(slash).map((row) => row.fixtureId)).toEqual(["rod"]);
    expect(versus.lines[0]?.fixtureId).toBeNull();
    expect(rowsForStorage(versus)).toHaveLength(0);
  });

  it("leaves a partial slip unmatched instead of guessing a fixture", () => {
    const parsed = parseComment("2-1\nпросто думаю будет 1:0\n-1*", fixtures);

    expect(rowsForStorage(parsed)).toHaveLength(0);
    expect(parsed.warnings.filter((warning) => warning.startsWith("No prediction"))).toHaveLength(fixtures.length);
    expect(parsed.lines.map((line) => line.rawLine)).toEqual(["2-1", "просто думаю будет 1:0"]);
  });
});
