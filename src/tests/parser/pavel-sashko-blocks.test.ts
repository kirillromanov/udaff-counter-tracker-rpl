import { describe, expect, it } from "vitest";
import { attributeComment } from "@/lib/domain/parser/attribute-blocks";
import { parseComment } from "@/lib/domain/parser/parse-comment";
import type { FixtureRef } from "@/lib/domain/parser/types";

const round14: FixtureRef[] = [
  { id: "loko", homeTeam: "Локомотив", awayTeam: "Рубин" },
  { id: "fakel", homeTeam: "Факел", awayTeam: "Динамо" },
  { id: "akhmat", homeTeam: "Ахмат", awayTeam: "Родина" },
  { id: "krasnodar", homeTeam: "Краснодар", awayTeam: "ЦСКА" },
  { id: "krylia", homeTeam: "Крылья Советов", awayTeam: "Оренбург" },
  { id: "spartak", homeTeam: "Спартак", awayTeam: "Акрон" },
  { id: "zenit", homeTeam: "Зенит", awayTeam: "Ростов" },
  { id: "baltika", homeTeam: "Балтика", awayTeam: "Динамо Махачкала" },
];

const pavelPlain = `06.11.2026 19:30 Локомотив — Рубин 2-1
07.11.2026 14:00 Факел — Динамо 1-3
07.11.2026 16:30 Ахмат — Родина 1-2
07.11.2026 19:30 Краснодар — ЦСКА (МТ) 1-2
08.11.2026 14:00 Крылья Советов — Оренбург 2-0
08.11.2026 16:15 Спартак — Акрон 3-1
08.11.2026 18:30 Зенит — Ростов 1-2
08.11.2026 20:45 Балтика — Динамо Мх 2-1`;

const sashkoCommentary = `06.11.2026 19:30 Локомотив — Рубин 2:1 Пятничный разогрев. Железнодорожники дома обязаны забирать три очка, но вязкая Казань свой гол престижа заковыряет.
07.11.2026 14:00 Факел — Динамо 0:0 Врубаем тотальный сушняк! 🚌 Бескомпромиссный рахимовский бетон против московской атаки. Воронеж костью ляжет, но засушит на нули.
07.11.2026 16:30 Ахмат — Родина 2:0 Грозненцы дома сильны, а у «Родины» явные проблемы в обороне. Уверенная победа хозяев.
07.11.2026 19:30 Краснодар — ЦСКА (МТ) 🔥 1:1 МАТЧ ТУРА! 💥 Рубилово лидеров чемпионата. Никто не захочет рисковать очками, ждем вязкую боевую ничью.
08.11.2026 14:00 Крылья Советов — Оренбург 2:1 Самарцы при поддержке своих трибун дожмут гостей на встречных курсах.
08.11.2026 16:15 Спартак — Акрон 3:1 Красно-белые сейчас на ходу и дома устроят тольяттинцам веселую атакующую порку.
08.11.2026 18:30 Зенит — Ростов 2:0 Питер на классе закроет ростовчан в родных стенах. Спокойные три очка для Семака.
08.11.2026 20:45 Балтика — Динамо Мх 1:0 Калининград вымучает минимальную победу в жестком матче на характере.`;

const pavelScores = ["2-1", "1-3", "1-2", "1-2", "2-0", "3-1", "1-2", "2-1"];
const sashkoScores = ["2-1", "0-0", "2-0", "1-1", "2-1", "3-1", "2-0", "1-0"];

function scoresOf(text: string): string[] {
  return parseComment(text, round14).lines
    .filter((line) => line.fixtureId && line.homeGoals != null && line.awayGoals != null)
    .map((line) => `${line.homeGoals}-${line.awayGoals}`);
}

describe("Pavel and СашкоБубен blocks", () => {
  it("keeps a plain template with Pavel, including colon-free scores and (МТ)", () => {
    const blocks = attributeComment({ raw: pavelPlain, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ ownerName: "Павел Абросимов", method: "author", review: "clear" });
    expect(scoresOf(blocks[0]?.text ?? "")).toEqual(pavelScores);
    expect(parseComment(blocks[0]?.text ?? "", round14).lines.map((line) => line.fixtureId)).toEqual(round14.map((fixture) => fixture.id));
  });

  it("assigns a consistent commentary slip to СашкоБубен without a disclaimer", () => {
    const blocks = attributeComment({ raw: sashkoCommentary, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ ownerName: "СашкоБубен", method: "commentary-heuristic", review: "clear" });
    expect(blocks[0]?.evidence).toMatch(/8 of 8/);
    expect(scoresOf(blocks[0]?.text ?? "")).toEqual(sashkoScores);
    expect(parseComment(blocks[0]?.text ?? "", round14).lines.map((line) => line.fixtureId)).toEqual(round14.map((fixture) => fixture.id));
  });

  it("keeps the same owners when blank lines separate the lines of one slip", () => {
    const raw = sashkoCommentary.replaceAll("\n", "\n\n");
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 15 });

    expect(blocks.map((block) => [block.ownerName, block.review])).toEqual([["СашкоБубен", "clear"]]);
    expect(scoresOf(blocks[0]?.text ?? "")).toEqual(sashkoScores);
  });

  it.each([
    "от Бубна",
    "от Сашки Бубна",
    "СашкоБубен",
    "Бубен",
    "Бубнов",
    "от СашкоБубна",
    "от сашкибубна",
    "комментарии Бубна",
  ])("assigns a plain block after “%s” to СашкоБубен", (phrase) => {
    const blocks = attributeComment({
      raw: `${phrase}\n\n${pavelPlain}`,
      authorName: "Павел Абросимов",
      roundNumber: 14,
    });

    expect(blocks[0]).toMatchObject({ ownerName: "СашкоБубен", method: "explicit-marker", review: "clear" });
    expect(scoresOf(blocks[0]?.text ?? "")).toEqual(pavelScores);
  });

  it("applies a disclaimer after a plain block, including across blank lines", () => {
    const raw = `${pavelPlain.replaceAll("\n", "\n\n")}\n\nот СашкоБубна`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ ownerName: "СашкоБубен", method: "explicit-marker", review: "clear" });
  });

  it("keeps colon scores with Pavel when there is no commentary and no disclaimer", () => {
    const colon = pavelPlain
      .replaceAll("2-1", "2:1")
      .replaceAll("1-3", "1:3")
      .replaceAll("1-2", "1:2")
      .replaceAll("2-0", "2:0")
      .replaceAll("3-1", "3:1");
    const blocks = attributeComment({ raw: colon, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks[0]?.ownerName).toBe("Павел Абросимов");
    expect(scoresOf(blocks[0]?.text ?? "")).toEqual(pavelScores);
  });

  it("keeps dash scores with СашкоБубен when every line has commentary", () => {
    const dashed = sashkoCommentary.replaceAll("2:1", "2-1").replaceAll("0:0", "0-0").replaceAll("2:0", "2-0").replaceAll("1:1", "1-1").replaceAll("3:1", "3-1").replaceAll("1:0", "1-0");
    const blocks = attributeComment({ raw: dashed, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks[0]?.ownerName).toBe("СашкоБубен");
    expect(scoresOf(blocks[0]?.text ?? "")).toEqual(sashkoScores);
  });

  it("does not treat emoji or a match-of-the-round label as commentary", () => {
    const raw = `Локомотив — Рубин 2-1 🔥
Факел — Динамо 1-3 (МТ)
Ахмат — Родина 1-2 МАТЧ ТУРА!
Краснодар — ЦСКА 1-2`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks).toEqual([expect.objectContaining({ ownerName: "Павел Абросимов", review: "clear" })]);
  });

  it("does not let one trailing sentence move an otherwise plain slip", () => {
    const raw = `Локомотив — Рубин 2-1 Сегодня будет очень длинный и подробный рассказ про тактику.
Факел — Динамо 1-3
Ахмат — Родина 1-2`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks[0]?.ownerName).toBe("Павел Абросимов");
  });

  it("sends a mixed commentary slip to review instead of assigning it to СашкоБубен", () => {
    const lines = sashkoCommentary.split("\n");
    const raw = [lines[0], lines[1], "07.11.2026 16:30 Ахмат — Родина 2-0", "07.11.2026 19:30 Краснодар — ЦСКА 1-2"].join("\n");
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks[0]).toMatchObject({ ownerName: "Павел Абросимов", review: "review" });
    expect(blocks[0]?.evidence).toMatch(/not a consistent/);
  });

  it("does not let a casual mention capture a separate plain slip", () => {
    const raw = `Я читал, что СашкоБубен и Бубнов написали длинный комментарий, но это чужая цитата, а не шапка прогноза.\n\n${pavelPlain}`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks.map((block) => block.ownerName)).toEqual(["Павел Абросимов"]);
  });

  it("keeps two owners in one comment on separate repeated slips", () => {
    const raw = `${pavelPlain}\n\n${sashkoCommentary}`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks.map((block) => block.ownerName)).toEqual(["Павел Абросимов", "СашкоБубен"]);
    expect(new Set(blocks.map((block) => block.blockKey)).size).toBe(2);
    expect(scoresOf(blocks[0]?.text ?? "")).toEqual(pavelScores);
    expect(scoresOf(blocks[1]?.text ?? "")).toEqual(sashkoScores);
  });

  it("flags a non-lead disclaimer sitting between two slips", () => {
    const raw = `Локомотив — Рубин 2-1\nФакел — Динамо 1-3\n\nБубен\n\nЛокомотив — Рубин 0-0\nФакел — Динамо 1-1`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks.map((block) => block.review)).toEqual(["review", "review"]);
    expect(blocks.every((block) => block.ownerName === "Павел Абросимов")).toBe(true);
  });

  it("lets a lead-in between two slips name only the following slip", () => {
    const raw = `Локомотив — Рубин 2-1\nФакел — Динамо 1-3\n\nот Бубна\n\nЛокомотив — Рубин 0-0\nФакел — Динамо 1-1`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 14 });

    expect(blocks.map((block) => [block.ownerName, block.review])).toEqual([
      ["Павел Абросимов", "clear"],
      ["СашкоБубен", "clear"],
    ]);
  });

  it("parses a two-line commentary slip without requiring eight matches", () => {
    const raw = `Локомотив — Рубин 2-1 Пятничный разогрев перед длинной серией матчей.
Факел — Динамо 0-0 Воронеж костью ляжет и засушит игру на нули.`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 16 });

    expect(blocks[0]).toMatchObject({ ownerName: "СашкоБубен", review: "clear" });
    expect(scoresOf(blocks[0]?.text ?? "")).toEqual(["2-1", "0-0"]);
  });

  it("flags a contradictory round header and ignores the season banner", () => {
    const raw = `_____________𝐑𝐏𝐋 ⚽ 𝟐𝟔’𝟐𝟳_____________\n=========== [ #15 ] ===========\n${pavelPlain}`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 16 });

    expect(blocks[0]).toMatchObject({ ownerName: "Павел Абросимов", review: "review" });
    expect(blocks[0]?.warnings[0]).toMatch(/#15/);
  });

  it("returns the same block keys on a second pass and does not leak into the next comment", () => {
    const first = attributeComment({ raw: pavelPlain, authorName: "Павел Абросимов", roundNumber: 14 });
    const second = attributeComment({ raw: pavelPlain, authorName: "Павел Абросимов", roundNumber: 14 });
    const other = attributeComment({ raw: sashkoCommentary, authorName: "Hordi Cruyff", roundNumber: 14 });

    expect(second.map((block) => block.blockKey)).toEqual(first.map((block) => block.blockKey));
    expect(other.map((block) => block.ownerName)).toEqual(["Hordi Cruyff"]);
  });
});
