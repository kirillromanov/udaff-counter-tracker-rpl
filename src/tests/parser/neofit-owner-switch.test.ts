import { describe, expect, it } from "vitest";
import { attributeComment, roundHeaderNumber } from "@/lib/domain/parser/attribute-blocks";
import { parseComment, rowsForStorage } from "@/lib/domain/parser/parse-comment";
import type { AttributionBlock } from "@/lib/domain/parser/attribute-blocks";
import type { FixtureRef } from "@/lib/domain/parser/types";

const FIXTURES: FixtureRef[] = [
  { id: "loko", homeTeam: "Локомотив", awayTeam: "Рубин" },
  { id: "fakel", homeTeam: "Факел", awayTeam: "Динамо" },
  { id: "akhmat", homeTeam: "Ахмат", awayTeam: "Родина" },
  { id: "krasnodar", homeTeam: "Краснодар", awayTeam: "ЦСКА" },
  { id: "krylia", homeTeam: "Крылья Советов", awayTeam: "Оренбург" },
  { id: "spartak", homeTeam: "Спартак", awayTeam: "Акрон" },
  { id: "zenit", homeTeam: "Зенит", awayTeam: "Ростов" },
  { id: "baltika", homeTeam: "Балтика", awayTeam: "Махачкала" },
];

const ROUND_14 = `𝟲𝗮𝗝𝗜𝟲𝗲𝗰™☼ 👇
   =========== [ #𝟭𝟰 ] ===========
06.11.2026 19:30 Локомотив — Рубин 1-1
07.11.2026 14:00 Факел — Динамо 0-1
07.11.2026 16:30 Ахмат — Родина 2-1
07.11.2026 19:30 Краснодар — ЦСКА *² 1-1
08.11.2026 14:00 Кр Советов — Оренбург 1-1
08.11.2026 16:15 Спартак — Акрон 2-0
08.11.2026 18:30 Зенит — Ростов 2-0
08.11.2026 20:45 Балтика — Махачкала 1-0
_________________________

👉🏽 мну 👇
_____________𝐑𝐏𝐋 ⚽ 𝟐𝟔’𝟐𝟳_____________
   =========== [ #𝟭𝟰 ] ===========
\\~~~~~~~~~~~~~~~~~~~~~~~/
06.11.2026 19:30 Локомотив — Рубин 1-0
07.11.2026 14:00 Факел — Динамо 0-2
07.11.2026 16:30 Ахмат — Родина 1-1
07.11.2026 19:30 Краснодар — ЦСКА *² 1-1
08.11.2026 14:00 Кр Советов — Оренбург 1-1
08.11.2026 16:15 Спартак — Акрон 3-0
08.11.2026 18:30 Зенит — Ростов 3-0
08.11.2026 20:45 Балтика — Махачкала 2-0`;

function boldDigit(digit: number): string {
  return String.fromCodePoint(0x1d7ec + digit);
}

function boldRound(round: number): string {
  return [...String(round)].map((digit) => boldDigit(Number(digit))).join("");
}

function withHeaders(header: string): string {
  return ROUND_14.replaceAll("[ #𝟭𝟰 ]", header);
}

function storedScores(block: AttributionBlock): string[] {
  return rowsForStorage(parseComment(block.text, FIXTURES)).map(
    (line) => `${line.fixtureId}:${line.homeGoals}-${line.awayGoals}`,
  );
}

describe("neofit owner markers", () => {
  it("splits the round 14 comment into БалБес and then neofit", () => {
    const blocks = attributeComment({ raw: ROUND_14, authorName: "neofit", roundNumber: 14 });

    expect(blocks.map((block) => block.ownerName)).toEqual(["БалБес", "neofit"]);
    expect(blocks[0]).toMatchObject({ method: "explicit-marker", review: "clear" });
    expect(blocks[1]).toMatchObject({ method: "explicit-marker", review: "clear" });
    expect(blocks[0]?.text).not.toContain("Локомотив — Рубин 1-0");
    expect(blocks[1]?.text).not.toContain("Локомотив — Рубин 1-1");
    expect(storedScores(blocks[0] as AttributionBlock)).toEqual([
      "loko:1-1",
      "fakel:0-1",
      "akhmat:2-1",
      "krasnodar:1-1",
      "krylia:1-1",
      "spartak:2-0",
      "zenit:2-0",
      "baltika:1-0",
    ]);
    expect(storedScores(blocks[1] as AttributionBlock)).toEqual([
      "loko:1-0",
      "fakel:0-2",
      "akhmat:1-1",
      "krasnodar:1-1",
      "krylia:1-1",
      "spartak:3-0",
      "zenit:3-0",
      "baltika:2-0",
    ]);
    expect(storedScores(blocks[0] as AttributionBlock).length + storedScores(blocks[1] as AttributionBlock).length).toBe(16);
  });

  it("reads a unicode round header and ignores the season banner", () => {
    expect(roundHeaderNumber("=========== [ #𝟭𝟰 ] ===========")).toBe(14);
    expect(roundHeaderNumber("============= [ #15 ] =============")).toBe(15);
    expect(roundHeaderNumber("_____________𝐑𝐏𝐋 ⚽ 𝟐𝟔’𝟐𝟳_____________")).toBeNull();
  });

  it("keeps an ordinary neofit comment with the author", () => {
    const blocks = attributeComment({
      raw: "06.11.2026 19:30 Локомотив — Рубин 1-0",
      authorName: "neofit",
      roundNumber: 14,
    });

    expect(blocks).toMatchObject([{ ownerName: "neofit", method: "author", review: "clear" }]);
  });

  it("accepts a self marker without emoji and with extra spacing", () => {
    const raw = ROUND_14.replace("👉🏽 мну 👇", "   мну   ");
    const blocks = attributeComment({ raw, authorName: "neofit", roundNumber: 14 });

    expect(blocks.map((block) => block.ownerName)).toEqual(["БалБес", "neofit"]);
    expect(blocks[1]?.evidence).toContain("мну");
  });

  it("does not let a prose mention of мну switch the owner", () => {
    const raw = `𝟲𝗮𝗝𝗜𝟲𝗲𝗰
Локомотив — Рубин 1-1
я про мну ничего не говорил
Факел — Динамо 0-1`;
    const blocks = attributeComment({ raw, authorName: "neofit", roundNumber: 14 });

    expect(blocks.map((block) => block.ownerName)).toEqual(["БалБес"]);
    expect(storedScores(blocks[0] as AttributionBlock)).toEqual(["loko:1-1", "fakel:0-1"]);
  });

  it("returns the same blocks on a second pass", () => {
    const first = attributeComment({ raw: ROUND_14, authorName: "neofit", roundNumber: 14 });
    const second = attributeComment({ raw: ROUND_14, authorName: "neofit", roundNumber: 14 });

    expect(second.map((block) => [block.ownerName, block.blockKey])).toEqual(
      first.map((block) => [block.ownerName, block.blockKey]),
    );
    expect(new Set(first.map((block) => block.blockKey)).size).toBe(2);
  });

  it("does not carry the owner into the next comment", () => {
    attributeComment({ raw: ROUND_14, authorName: "neofit", roundNumber: 14 });
    const next = attributeComment({
      raw: "Локомотив — Рубин 2-2",
      authorName: "neofit",
      roundNumber: 14,
    });

    expect(next.map((block) => block.ownerName)).toEqual(["neofit"]);
  });

  it("leaves the markers unused for a different author", () => {
    const blocks = attributeComment({ raw: ROUND_14, authorName: "Hordi Cruyff", roundNumber: 14 });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.ownerName).toBe("Hordi Cruyff");
  });

  it.each([
    [15, `[ #${boldRound(15)} ]`],
    [16, "[ #16 ]"],
  ])("keeps both owners for round %s", (round, header) => {
    const blocks = attributeComment({
      raw: withHeaders(header),
      authorName: "neofit",
      roundNumber: round,
    });

    expect(blocks.map((block) => [block.ownerName, block.review])).toEqual([
      ["БалБес", "clear"],
      ["neofit", "clear"],
    ]);
    expect(storedScores(blocks[0] as AttributionBlock)).toHaveLength(8);
    expect(storedScores(blocks[1] as AttributionBlock)).toHaveLength(8);
  });

  it("flags a round-15 header when the imported round is 16", () => {
    const blocks = attributeComment({
      raw: withHeaders("[ #15 ]"),
      authorName: "neofit",
      roundNumber: 16,
    });

    expect(blocks.map((block) => block.review)).toEqual(["review", "review"]);
    expect(blocks[0]?.warnings[0]).toMatch(/#15/);
    expect(blocks[0]?.ownerName).toBe("БалБес");
    expect(blocks[1]?.ownerName).toBe("neofit");
  });

  it("does not reject a block that has no round header", () => {
    const raw = ROUND_14.replaceAll(/.*\[\s*#.*\n/gu, "");
    const blocks = attributeComment({ raw, authorName: "neofit", roundNumber: 14 });

    expect(blocks.map((block) => [block.ownerName, block.review])).toEqual([
      ["БалБес", "clear"],
      ["neofit", "clear"],
    ]);
    expect(blocks.flatMap((block) => block.warnings)).toEqual([]);
  });
});
