import { describe, expect, it } from "vitest";
import { attributeComment, BALBES_STYLIZED_ALIAS } from "@/lib/domain/parser/attribute-blocks";
import { parseComment } from "@/lib/domain/parser/parse-comment";
import { parsePredictionLine } from "@/lib/domain/parser/parse-prediction-line";
import type { FixtureRef } from "@/lib/domain/parser/types";

const round13: FixtureRef[] = [
  { id: "rubin", homeTeam: "Рубин", awayTeam: "Факел" },
  { id: "dynamo", homeTeam: "Динамо", awayTeam: "Ахмат" },
  { id: "rodina", homeTeam: "Родина", awayTeam: "Краснодар" },
  { id: "loko", homeTeam: "Локомотив", awayTeam: "Спартак" },
];

const neofitSlip = `Рубин - Факел 1-0
Динамо - Ахмат 2-0
${BALBES_STYLIZED_ALIAS}™☼ 👇
=========== [ #13 ] ===========
Родина - Краснодар 0-1
Локомотив - Спартак 1-1`;

describe("delegated prediction blocks", () => {
  it("keeps neofit's lines and gives the block after the stylized alias to БалБес", () => {
    const blocks = attributeComment({ raw: neofitSlip, authorName: "neofit", roundNumber: 13 });

    expect(blocks.map((block) => block.ownerName)).toEqual(["neofit", "БалБес"]);
    expect(blocks[1]).toMatchObject({ method: "explicit-marker", review: "clear" });
    expect(blocks[0]?.text).toContain("Рубин - Факел 1-0");
    expect(blocks[0]?.text).not.toContain("Родина - Краснодар");
    expect(blocks[1]?.text).toContain("Родина - Краснодар 0-1");
    expect(blocks[1]?.evidence).toContain(BALBES_STYLIZED_ALIAS);
  });

  it("recognizes spaced decorations around the alias", () => {
    const raw = `Рубин - Факел 1-0\n\n  ${BALBES_STYLIZED_ALIAS}  ™   ☼  👇  \nРодина - Краснодар 2-1`;
    const blocks = attributeComment({ raw, authorName: "neofit", roundNumber: 13 });

    expect(blocks.map((block) => [block.ownerName, block.review])).toEqual([
      ["neofit", "clear"],
      ["БалБес", "clear"],
    ]);
  });

  it("treats a decorated plain БалБес line as the same marker", () => {
    const raw = "Рубин - Факел 1-0\n            БалБес™:\n        \\\\~~~~~~~~~~~~~~~~~~~~~~~/\nРодина - Краснодар 1-2";
    const blocks = attributeComment({ raw, authorName: "neofit", roundNumber: 6 });

    expect(blocks.map((block) => block.ownerName)).toEqual(["neofit", "БалБес"]);
    expect(blocks[1]?.text).toContain("Родина - Краснодар 1-2");
    expect(blocks[0]?.text).not.toContain("Родина - Краснодар");
  });

  it("recognizes the plain alias as well as the exact stylized letters", () => {
    const raw = "Рубин - Факел 1-0\n6aJI6ec\nРодина - Краснодар 2-1";
    const blocks = attributeComment({ raw, authorName: "neofit", roundNumber: 13 });

    expect(blocks[1]?.ownerName).toBe("БалБес");
  });

  it("flags a round marker that contradicts the imported round", () => {
    const blocks = attributeComment({
      raw: `Рубин - Факел 1-0\n${BALBES_STYLIZED_ALIAS}\n=========== [ #12 ] ===========\nРодина - Краснодар 2-1`,
      authorName: "neofit",
      roundNumber: 13,
    });

    expect(blocks[1]).toMatchObject({ ownerName: "БалБес", review: "review" });
    expect(blocks[1]?.warnings[0]).toMatch(/round marker/i);
  });

  it("does not create a БалБес block when the marker has no predictions", () => {
    const blocks = attributeComment({
      raw: `Рубин - Факел 1-0\n${BALBES_STYLIZED_ALIAS}™☼ 👇\n=========== [ #13 ] ===========`,
      authorName: "neofit",
      roundNumber: 13,
    });

    expect(blocks.map((block) => block.ownerName)).toEqual(["neofit"]);
  });

  it.each([
    "от Бубна",
    "от СашкоБубна",
    "комментарии Бубна",
    "Бубнов",
    "От сашкибубна",
  ])("assigns the following block to СашкоБубен for “%s”", (phrase) => {
    const blocks = attributeComment({
      raw: `${phrase}\n\nРубин - Факел 1-0\nДинамо - Ахмат 2-1`,
      authorName: "Павел Абросимов",
      roundNumber: 13,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ ownerName: "СашкоБубен", method: "explicit-marker", review: "clear" });
  });

  it("lets an attribution phrase after the scores apply to the preceding block only", () => {
    const blocks = attributeComment({
      raw: `Рубин - Факел 1-0\nДинамо - Ахмат 2-1\n\nРубин - Факел 0-1\nДинамо - Ахмат 1-1\n\nот Бубна`,
      authorName: "Павел Абросимов",
      roundNumber: 13,
    });

    expect(blocks.map((block) => block.ownerName)).toEqual(["Павел Абросимов", "СашкоБубен"]);
    expect(blocks[1]?.evidence).toContain("от Бубна");
  });

  it("leaves Pavel's ordinary score lines with Pavel", () => {
    const blocks = attributeComment({
      raw: "Рубин - Факел 1-0\nДинамо - Ахмат 2-1\nРодина - Краснодар 0-1",
      authorName: "Павел Абросимов",
      roundNumber: 13,
    });

    expect(blocks).toEqual([
      expect.objectContaining({ ownerName: "Павел Абросимов", method: "author" }),
    ]);
  });

  it("treats a consistent commentary slip as СашкоБубен", () => {
    const raw = `31.10.2026 15:15 Рубин — Факел 0:0 Врубаем тотальный сушняк! Автобус на автобус.
31.10.2026 17:30 Динамо Москва — Ахмат 2:1 Бело-голубые дома обязаны реабилитироваться.
31.10.2026 19:45 Родина — Краснодар 0:3 Лидер чемпионата против аутсайдера.`;
    const blocks = attributeComment({ raw, authorName: "Павел Абросимов", roundNumber: 13 });

    expect(blocks[0]).toMatchObject({
      ownerName: "СашкоБубен",
      method: "commentary-heuristic",
      review: "clear",
    });
  });

  it("does not move a slip because one line has a long trailing remark", () => {
    const blocks = attributeComment({
      raw: "Рубин - Факел 1-0 Сегодня будет очень длинный и подробный рассказ про тактику и сушняк на поле.\nДинамо - Ахмат 2-1\nРодина - Краснодар 0-1",
      authorName: "Павел Абросимов",
      roundNumber: 13,
    });

    expect(blocks[0]?.ownerName).toBe("Павел Абросимов");
  });

  it("does not let a discussion mention capture a separate prediction block", () => {
    const blocks = attributeComment({
      raw: "Я вчера долго читал про Бубнов, его заметки и чужие комментарии, но это просто разговор, а не прогноз.\n\nРубин - Факел 1-0\nДинамо - Ахмат 2-1",
      authorName: "Павел Абросимов",
      roundNumber: 13,
    });

    expect(blocks.map((block) => block.ownerName)).toEqual(["Павел Абросимов"]);
  });

  it("keeps the same block keys when the comment is attributed again", () => {
    const first = attributeComment({ raw: neofitSlip, authorName: "neofit", roundNumber: 13 });
    const second = attributeComment({ raw: neofitSlip, authorName: "neofit", roundNumber: 13 });

    expect(second.map((block) => block.blockKey)).toEqual(first.map((block) => block.blockKey));
  });
});

describe("prediction lines with commentary", () => {
  it("reads the Lokomotiv example without taking the kickoff as the score", () => {
    const line = "01.11.2026 19:45 Локомотив Москва — Спартак-Москва 🔥 2:2 МАТЧ ТУРА! 💥 Огненное московское дерби.";
    const parsed = parsePredictionLine(line);
    const comment = parseComment(line, round13);

    expect(parsed).toMatchObject({ homeGoals: 2, awayGoals: 2, markedAsMt: true });
    expect(parsed?.rawLine).toBe(line);
    expect(parsed?.warnings[0]).toMatch(/fixture setting is not changed/i);
    expect(comment.lines[0]).toMatchObject({ fixtureId: "loko", homeGoals: 2, awayGoals: 2 });
  });

  it("accepts a dash score and a colon score with a date prefix", () => {
    expect(parsePredictionLine("01.11.2026 19:45 Локомотив - Спартак 2-2")).toMatchObject({ homeGoals: 2, awayGoals: 2 });
    expect(parsePredictionLine("01.11.2026 19:45 Локомотив — Спартак 2:2")).toMatchObject({ homeGoals: 2, awayGoals: 2 });
  });
});
