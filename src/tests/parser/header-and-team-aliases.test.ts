import { describe, expect, it } from "vitest";
import { attributeComment, type HeaderAlias } from "@/lib/domain/parser/attribute-blocks";
import { matchFixture } from "@/lib/domain/parser/match-fixture";
import { matchTokens, teamKey } from "@/lib/domain/parser/normalize";
import { parseComment } from "@/lib/domain/parser/parse-comment";
import { parsePredictionLine } from "@/lib/domain/parser/parse-prediction-line";
import { fixtureDeadline, editWritePlan } from "@/lib/domain/import/fixture-deadline";
import { validateTeamAliasDrafts } from "@/lib/domain/teams/validate-aliases";
import type { FixtureRef } from "@/lib/domain/parser/types";

const BOLD_ONE = String.fromCodePoint(0x1d7ed);
const BOLD_SIX = String.fromCodePoint(0x1d7f2);

const fixtures: FixtureRef[] = [
  { id: "rubin", homeTeam: "Рубин", awayTeam: "Акрон" },
  { id: "cska", homeTeam: "ЦСКА", awayTeam: "Зенит" },
  { id: "baltika", homeTeam: "Балтика", awayTeam: "Ахмат" },
  { id: "orenburg", homeTeam: "Оренбург", awayTeam: "Родина" },
  { id: "rostov", homeTeam: "Ростов", awayTeam: "Краснодар", homeAliases: [], awayAliases: [] },
  { id: "krylia", homeTeam: "Крылья Советов", awayTeam: "Динамо", homeAliases: ["Кр Советов"], awayAliases: [] },
  {
    id: "loko",
    homeTeam: "Локомотив",
    awayTeam: "Динамо Мx",
    awayAliases: ["Динамо Мх", "Махачкала", "Динамо Махачкала"],
  },
  { id: "fakel", homeTeam: "Факел", awayTeam: "Спартак" },
];

const balbesSlip = `👉🏽\t6aJI6ec™🥇 👇
(жылезяко чугуниеве, орденоноснэ)
=========== [ #${BOLD_ONE}${BOLD_SIX} ] ===========
28.11.2026 14:00 Рубин — Акрон 1-1
28.11.2026 16:30 ЦСКА — Зенит 1-1
28.11.2026 19:00 Балтика — Ахмат 1-1
29.11.2026 13:00 Оренбург — Родина 1-1
29.11.2026 15:15 Ростов — Краснодар *² 1-1
29.11.2026 17:30 Кр Советов — Динамо 1-1
29.11.2026 19:45 Локомотив — Махачкала 1-1
30.11.2026 19:30 Факел — Спартак 0-2
/ ____ \\ тотал =8 (ыыы)`;

const neofitSlip = `👉🏽\tмну 👇👇👇
============= [ #${BOLD_ONE}${BOLD_SIX} ] =============
\\\\~~~~~~~~~~~~~~~~~~~~~~~/
28.11.2026 14:00 Рубин — Акрон 1-0
28.11.2026 16:30 ЦСКА — Зенит 0-1
28.11.2026 19:00 Балтика — Ахмат 1-0
29.11.2026 13:00 Оренбург — Родина 1-0
29.11.2026 15:15 Ростов — Краснодар (МТ) 0-1
29.11.2026 17:30 Кр Советов — Динамо 0-1
29.11.2026 19:45 Локомотив — Динамо Махачкала 1-0
30.11.2026 19:30 Факел — Спартак 0-1
/ ____________________________ \\ тотал =8 (ыыы)`;

const people: HeaderAlias[] = [
  { name: "neofit", aliases: [] },
  { name: "БалБес", aliases: [] },
  { name: "Йош!", aliases: ["Йош"] },
];

function scores(text: string): string[] {
  return parseComment(text, fixtures).lines
    .filter((line) => line.fixtureId)
    .map((line) => `${line.fixtureId}:${line.homeGoals}-${line.awayGoals}`);
}

describe("header keywords", () => {
  it("attributes a decorated nickname line and a мну line in one comment", () => {
    const blocks = attributeComment({
      raw: `${balbesSlip}\n\n${neofitSlip}`,
      authorName: "neofit",
      roundNumber: 16,
      headerAliases: people,
    });

    expect(blocks.map((block) => block.ownerName)).toEqual(["БалБес", "neofit"]);
    expect(blocks[0]).toMatchObject({ method: "explicit-marker", review: "clear" });
    expect(blocks[1]?.evidence).toContain("мну");
    expect(scores(blocks[0]?.text ?? "")).toEqual([
      "rubin:1-1",
      "cska:1-1",
      "baltika:1-1",
      "orenburg:1-1",
      "rostov:1-1",
      "krylia:1-1",
      "loko:1-1",
      "fakel:0-2",
    ]);
    expect(scores(blocks[1]?.text ?? "")).toContain("loko:1-0");
  });

  it("still reads the previous stylized header", () => {
    const blocks = attributeComment({
      raw: "28.11.2026 14:00 Рубин — Акрон 1-0\n𝟲𝗮𝗝𝗜𝟲𝗲𝗰™\n28.11.2026 16:30 ЦСКА — Зенит 0-1",
      authorName: "neofit",
      roundNumber: 16,
    });

    expect(blocks.map((block) => block.ownerName)).toEqual(["neofit", "БалБес"]);
  });

  it("does not match a keyword inside a longer word", () => {
    const blocks = attributeComment({
      raw: "6aji6ectm\n28.11.2026 14:00 Рубин — Акрон 1-0",
      authorName: "neofit",
      roundNumber: 16,
      headerAliases: people,
    });

    expect(blocks.map((block) => block.ownerName)).toEqual(["neofit"]);
    expect(matchTokens("xx6aji6ec")).toEqual(["xx6aji6ec"]);
  });

  it("flags two participants in one header and leaves an unknown header with the author", () => {
    const ambiguous = attributeComment({
      raw: `6aJI6ec™\nЙош\n28.11.2026 14:00 Рубин — Акрон 1-0`,
      authorName: "neofit",
      roundNumber: 16,
      headerAliases: people,
    });
    expect(ambiguous[0]).toMatchObject({ ownerName: "neofit", review: "review" });
    expect(ambiguous[0]?.evidence).toMatch(/more than one participant/i);

    const unknown = attributeComment({
      raw: "completely-unknown\n28.11.2026 14:00 Рубин — Акрон 2-2",
      authorName: "Schmelzer",
      roundNumber: 16,
      headerAliases: people,
    });
    expect(unknown.map((block) => block.ownerName)).toEqual(["Schmelzer"]);
    expect(unknown[0]?.method).toBe("author");
  });
});

describe("team spellings", () => {
  it("does not match Махачкала to the stored Latin-x club until that spelling is saved", () => {
    const stored = "Динамо Мx";
    expect(stored.codePointAt(stored.length - 1)).toBe(0x78);
    expect(teamKey(stored)).toBe("динамо мx");
    expect(teamKey(stored).codePointAt(teamKey(stored).length - 1)).toBe(0x78);
    const bare = fixtures.map((fixture) => (fixture.id === "loko" ? { ...fixture, awayAliases: [] } : fixture));
    expect(matchFixture("Локомотив", "Махачкала", bare)).toBeNull();
    expect(matchFixture("Локомотив", "Махачкала", fixtures)?.fixtureId).toBe("loko");
  });

  it("prefers the longest spelling and keeps plain Динамо as Dynamo Moscow", () => {
    expect(matchFixture("Локомотив", "Махачкала", fixtures)?.fixtureId).toBe("loko");
    expect(matchFixture("Локомотив", "Динамо Мх", fixtures)?.fixtureId).toBe("loko");
    expect(matchFixture("Локомотив", "Динамо Махачкала", fixtures)?.fixtureId).toBe("loko");
    expect(matchFixture("Кр Советов", "Динамо", fixtures)?.fixtureId).toBe("krylia");
    expect(matchFixture("Крылья Советов", "Динамо", fixtures)?.fixtureId).toBe("krylia");
  });

  it("does not let a Dynamo Moscow line take Dynamo Makhachkala", () => {
    const matched = matchFixture("Крылья Советов", "Динамо", fixtures);
    expect(matched?.fixtureId).toBe("krylia");
    expect(matched?.ambiguous).toBe(false);
  });

  it("resolves bare Динамо by the opponent and does not guess the other club", () => {
    expect(matchFixture("Локомотив", "Динамо", fixtures)?.fixtureId).toBe("loko");
    expect(matchFixture("Кр Советов", "Динамо", fixtures)?.fixtureId).toBe("krylia");
    expect(matchFixture("Крылья Советов", "Динамо Мх", fixtures)).toBeNull();
    expect(matchFixture("Крылья Советов", "Динамо Махачкала", fixtures)).toBeNull();
    expect(matchFixture("Кр Советов", "Динамо Мх", fixtures)).toBeNull();
    expect(matchFixture("Локомотив", "Динамо Москва", fixtures)).toBeNull();
    expect(matchFixture("Динамо Мх", "Крылья Советов", fixtures)).toBeNull();
    expect(matchFixture("Динамо Махачкала", "Крылья Советов", fixtures)).toBeNull();
  });

  it("rejects colliding and empty spellings with the same key the parser uses", () => {
    const own = validateTeamAliasDrafts(
      [{ name: "Динамо Мх", aliases: ["Динамо", "", ""] }],
      [{ name: "Динамо", aliases: [] }],
    );
    expect(own.ok).toBe(false);
    if (!own.ok) {
      expect(own.message).toMatch(/Динамо/);
    }

    const duplicate = validateTeamAliasDrafts(
      [{ name: "Крылья Советов", aliases: ["Кр Советов", "кр советов", ""] }],
      [],
    );
    expect(duplicate.ok).toBe(false);

    const saved = validateTeamAliasDrafts(
      [{ name: "Динамо Мх", aliases: ["Махачкала", "Динамо Махачкала", ""] }],
      [{ name: "Динамо", aliases: [] }],
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.teams[0]?.aliases.map((alias) => alias.normalized)).toEqual([
        teamKey("Махачкала"),
        teamKey("Динамо Махачкала"),
      ]);
    }

    const latinX = "Динамо Мx";
    const historical = validateTeamAliasDrafts(
      [{ name: latinX, aliases: ["Махачкала", "Динамо Махачкала", "Динамо Мх"] }],
      [
        { name: "Динамо", aliases: [] },
        { name: "Динамо Махачкала", aliases: [] },
        { name: "Динамо Мх", aliases: [] },
      ],
    );
    expect(historical.ok).toBe(true);
  });
});

describe("match-of-the-round decoration", () => {
  it.each(["(МТ)", "МТ", "MT", "(MT)", "*²"])("keeps the teams and the score for %s", (marker) => {
    const parsed = parsePredictionLine(`29.11.2026 15:15 Ростов — Краснодар ${marker} 1-1`);
    expect(parsed).toMatchObject({
      homeName: "Ростов",
      awayName: "Краснодар",
      homeGoals: 1,
      awayGoals: 1,
      markedAsMt: true,
    });
  });

  it("does not change which fixture is the match of the round", () => {
    const parsed = parseComment("29.11.2026 15:15 Ростов — Краснодар МТ 1-1", fixtures);
    expect(parsed.lines[0]?.fixtureId).toBe("rostov");
    expect(parsed.lines[0]?.markedAsMt).toBe(true);
  });
});

describe("publication time, not parse time", () => {
  const kickoff = new Date("2026-11-28T11:00:00.000Z");

  it("accepts a comment published before kickoff and rejects an edit after it", () => {
    expect(fixtureDeadline(new Date("2026-11-28T08:00:00.000Z"), kickoff)).toBe("eligible");
    const before = editWritePlan({
      editedAt: new Date("2026-11-28T08:00:00.000Z"),
      fixtures: [{ id: "rostov", kickoffAt: kickoff }],
      incomingMatchIds: ["rostov"],
    });
    expect(before.writeMatchIds).toEqual(["rostov"]);
    const after = editWritePlan({
      editedAt: new Date("2026-11-28T12:00:00.000Z"),
      fixtures: [{ id: "rostov", kickoffAt: kickoff }],
      incomingMatchIds: ["rostov"],
    });
    expect(after.writeMatchIds).toEqual([]);
    expect(after.note).toMatch(/kickoff/i);
  });
});
