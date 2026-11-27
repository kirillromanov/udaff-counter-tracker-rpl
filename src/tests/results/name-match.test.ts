import { describe, expect, it } from "vitest";
import { partitionResultAttachments, type FixtureSide } from "@/lib/domain/results/decide";
import type { SourceMatch } from "@/lib/domain/results/types";

const makhachkalaAliases = ["Махачкала", "Динамо Махачкала", "Динамо Мх"];

function fixture(id: string, homeTeam: string, awayTeam: string, aliases: Partial<Pick<FixtureSide, "homeAliases" | "awayAliases">> = {}): FixtureSide {
  return { id, homeTeam, awayTeam, ...aliases };
}

function row(homeTeam: string, awayTeam: string, homeGoals = 1, awayGoals = 0): SourceMatch {
  return {
    source: "sport-ru",
    sourceKey: `${homeTeam}:${awayTeam}`,
    roundNumber: 16,
    homeTeam,
    awayTeam,
    homeGoals,
    awayGoals,
    role: "primary",
    confidence: "high",
    matchStatus: "finished",
    completeness: "complete",
  };
}

function attachedTo(fixtures: FixtureSide[], result: SourceMatch) {
  const { attached, ambiguous } = partitionResultAttachments(fixtures, [result]);
  return {
    ambiguous: ambiguous.length,
    ids: [...attached.keys()],
    nameMatch: [...attached.values()].flat()[0]?.nameMatch ?? null,
    homeGoals: [...attached.values()].flat()[0]?.homeGoals ?? null,
    awayGoals: [...attached.values()].flat()[0]?.awayGoals ?? null,
  };
}

const latinX = "Динамо Мx";

describe("result name matching", () => {
  const both = [
    fixture("makh", "Локомотив", latinX, { awayAliases: makhachkalaAliases }),
    fixture("moscow", "Крылья Советов", "Динамо"),
  ];

  it("resolves saved Makhachkala spellings onto the Latin-x fixture", () => {
    for (const away of ["Динамо Махачкала", "Динамо Мх", "Махачкала", "Dynamo Makhachkala", "Dinamo Makhachkala"]) {
      expect(attachedTo(both, row("Локомотив", away, 2, 1))).toMatchObject({
        ambiguous: 0,
        ids: ["makh"],
        nameMatch: "alias",
        homeGoals: 2,
        awayGoals: 1,
      });
    }
  });

  it("does not send Dynamo Moscow to Makhachkala or the other way around", () => {
    expect(attachedTo(both, row("Крылья Советов", "Динамо", 0, 1))).toMatchObject({
      ambiguous: 0,
      ids: ["moscow"],
      nameMatch: "team-key",
    });
    expect(attachedTo(both, row("Локомотив", "Динамо", 3, 0)).ids).toEqual([]);
    expect(attachedTo(both, row("Крылья Советов", "Динамо Махачкала")).ids).toEqual([]);
    expect(attachedTo(both, row("Крылья Советов", "Динамо Мx", 0, 2)).ids).toEqual([]);
  });

  it("keeps other clubs, including Крылья Советов, on the similarity fallback", () => {
    const fixtures = [fixture("krylia", "Ростов", "Крылья Советов")];
    expect(attachedTo(fixtures, row("Ростов", "Крылья Советов"))).toMatchObject({ ids: ["krylia"], nameMatch: "team-key" });
    expect(attachedTo(fixtures, row("Ростов", "Кр Советов"))).toMatchObject({ ids: ["krylia"], nameMatch: "similarity" });
    expect(attachedTo([fixture("zenit", "Зенит", "Спартак")], row("Zenit", "Spartak"))).toMatchObject({
      ids: ["zenit"],
      nameMatch: "team-key",
    });
  });

  it("leaves the Latin-x fixture unmatched when those spellings are not saved", () => {
    const fixtures = [fixture("makh", "Локомотив", latinX), fixture("moscow", "Крылья Советов", "Динамо")];
    expect(attachedTo(fixtures, row("Локомотив", "Динамо Махачкала")).ids).toEqual([]);
    expect(attachedTo(fixtures, row("Локомотив", "Динамо Мх")).ids).toEqual([]);
    expect(attachedTo(fixtures, row("Локомотив", "Махачкала")).ids).toEqual([]);
    expect(attachedTo(fixtures, row("Локомотив", latinX)).ids).toEqual(["makh"]);
  });

  it("flags an ambiguous pair and does not guess", () => {
    const fixtures = [
      fixture("a", "Ростов", "Зенит"),
      fixture("b", "Ростов", "Зенит"),
    ];
    const { attached, ambiguous } = partitionResultAttachments(fixtures, [row("Ростов", "Зенит")]);
    expect(attached.size).toBe(0);
    expect(ambiguous).toHaveLength(1);
  });
});
