import { describe, expect, it } from "vitest";
import { parseComment, rowsForStorage } from "@/lib/domain/parser/parse-comment";
import { parsePredictionLine } from "@/lib/domain/parser/parse-prediction-line";
import { matchFixture, teamSimilarity } from "@/lib/domain/parser/match-fixture";
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

const clean = `17.10.2026 14:00 Крылья Советов — Факел 2-0
17.10.2026 16:30 Динамо Мх — Акрон 2-1
17.10.2026 19:30 Локомотив — Краснодар 1-2
18.10.2026 14:00 Зенит — Ахмат3-1
18.10.2026 16:15 Динамо — ЦСКА (МТ) 2-2
18.10.2026 18:30 Спартак — Рубин 3-0
18.10.2026 20:45 Балтика — Ростов 1-1
19.10.2026 19:30 Родина — Оренбург 0-1`;

describe("parseComment", () => {
  it("parses a clean prediction comment", () => {
    const parsed = parseComment(clean, fixtures);
    const rows = rowsForStorage(parsed);

    expect(rows).toHaveLength(8);
    expect(rows.map((row) => [row.fixtureId, row.homeGoals, row.awayGoals])).toEqual([
      ["ks", 2, 0],
      ["dm", 2, 1],
      ["lok", 1, 2],
      ["zen", 3, 1],
      ["din", 2, 2],
      ["spa", 3, 0],
      ["bal", 1, 1],
      ["rod", 0, 1],
    ]);
    expect(parsed.warnings.filter((warning) => warning.startsWith("No prediction"))).toEqual([]);
    expect(parsed.confidence).toBeGreaterThan(0.8);
  });

  it("ignores chatter around the score lines", () => {
    const parsed = parseComment(
      `Ну что, погнали\nКрылья Советов - Факел 2-0\nя думаю зенит порвет\nЗенит - Ахмат 3-1\nудачи всем`,
      fixtures,
    );

    expect(rowsForStorage(parsed).map((row) => row.fixtureId)).toEqual(["ks", "zen"]);
    expect(parsed.lines).toHaveLength(2);
  });

  it("accepts dash and score-separator variants", () => {
    const parsed = parseComment(
      ["Крылья Советов — Факел 2-0", "Локомотив – Краснодар 1:2", "Спартак - Рубин 2 — 1"].join("\n"),
      fixtures,
    );
    const rows = rowsForStorage(parsed);

    expect(rows.map((row) => [row.fixtureId, row.homeGoals, row.awayGoals])).toEqual([
      ["ks", 2, 0],
      ["lok", 1, 2],
      ["spa", 2, 1],
    ]);
  });

  it("detects an explicit MT marker without treating it as part of a team name", () => {
    const line = parsePredictionLine("18.10.2026 16:15 Динамо — ЦСКА (МТ) 2-2");
    const parsed = parseComment("Динамо - ЦСКА (MT) 1:2", fixtures);

    expect(line?.markedAsMt).toBe(true);
    expect(line?.homeName).toBe("Динамо");
    expect(line?.awayName).toBe("ЦСКА");
    expect(rowsForStorage(parsed)[0]).toMatchObject({
      fixtureId: "din",
      markedAsMt: true,
      homeGoals: 1,
      awayGoals: 2,
    });
  });

  it("reports fixtures that the comment left out", () => {
    const parsed = parseComment("Зенит - Ахмат 2-0\nСпартак - Рубин 1-0", fixtures);
    const missing = parsed.warnings.filter((warning) => warning.startsWith("No prediction"));

    expect(rowsForStorage(parsed)).toHaveLength(2);
    expect(missing).toHaveLength(6);
    expect(missing).toContain("No prediction for Крылья Советов — Факел");
  });

  it("matches shortened and slightly different team names", () => {
    const parsed = parseComment("Крылья - Факел 1-0\nДинамо Мх - Акрон 0-0", fixtures);
    const rows = rowsForStorage(parsed);

    expect(rows.map((row) => row.fixtureId)).toEqual(["ks", "dm"]);
    const shortened = parseComment("17.10 14:00 Кр Советов — Факел 1-1\n17.10 16:30 Махачкала — Акрон 1-1", fixtures);
    expect(rowsForStorage(shortened).map((row) => [row.fixtureId, row.homeGoals, row.awayGoals])).toEqual([
      ["ks", 1, 1],
      ["dm", 1, 1],
    ]);
    const chatter = parseComment("под чернику, на допенке – пишем письма в будущее", fixtures);
    expect(chatter.lines).toHaveLength(0);
    expect(teamSimilarity("Динамо Мх", "Динамо Махачкала")).toBe(1);
    expect(matchFixture("Динамо", "ЦСКА", fixtures)?.fixtureId).toBe("din");
  });

  it("keeps a score that sits between the team names", () => {
    const parsed = parseComment("Спартак 2 — 1 Рубин", fixtures);

    expect(rowsForStorage(parsed)[0]).toMatchObject({
      fixtureId: "spa",
      homeGoals: 2,
      awayGoals: 1,
    });
  });

  it("warns on malformed lines and keeps parsing the rest", () => {
    const parsed = parseComment("2:1\nпросто 2-1 без команд\nhello friends\nЗенит - Ахмат 1-0", fixtures);
    expect(parsed.lines.find((line) => line.rawLine === "2:1")?.warnings).toContain(
      "Malformed prediction line",
    );
    const malformed = parsed.lines.find((line) => line.rawLine === "просто 2-1 без команд");

    expect(malformed?.fixtureId).toBeNull();
    expect(malformed?.warnings.length).toBeGreaterThan(0);
    expect(parsed.lines.some((line) => line.rawLine === "hello friends")).toBe(false);
    expect(rowsForStorage(parsed).map((row) => row.fixtureId)).toEqual(["zen"]);
  });

  it("keeps one row when the same fixture is predicted twice", () => {
    const parsed = parseComment("Зенит - Ахмат 1-0\nЗенит - Ахмат 2-0", fixtures);
    const rows = rowsForStorage(parsed);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.homeGoals).toBe(2);
    expect(parsed.warnings.some((warning) => warning.includes("Duplicate prediction"))).toBe(true);
  });
});
