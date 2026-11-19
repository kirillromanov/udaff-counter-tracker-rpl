import { describe, expect, it } from "vitest";
import { parseComment } from "@/lib/domain/parser/parse-comment";
import { parsePredictionLine } from "@/lib/domain/parser/parse-prediction-line";
import { parseFixtureSchedule } from "@/lib/domain/forum/parse-schedule";
import type { FixtureRef } from "@/lib/domain/parser/types";

const akhmat: FixtureRef = { id: "r12-akhmat-orenburg", homeTeam: "Ахмат", awayTeam: "Оренбург" };
const hyphenated: FixtureRef = { id: "wings", homeTeam: "Крылья Советов", awayTeam: "Факел" };

const examples = [
  "23.10.2026 19:30 Ахмат — Оренбург 2-1",
  "23.10.2026 19:30 Ахмат - Оренбург 2-1",
  "23.10.2026 19:30 Ахмат — Оренбург 2:1",
  "23.10.2026 19:30 Ахмат - Оренбург 2:1",
];

describe("team dash and score separators", () => {
  it.each(examples)("reads %s as Ахмат 2-1 Оренбург", (line) => {
    const parsed = parsePredictionLine(line);
    expect(parsed).toMatchObject({
      rawLine: line,
      homeName: "Ахмат",
      awayName: "Оренбург",
      homeGoals: 2,
      awayGoals: 1,
    });
    const comment = parseComment(line, [akhmat]);
    expect(comment.lines[0]).toMatchObject({
      fixtureId: akhmat.id,
      homeGoals: 2,
      awayGoals: 1,
      rawLine: line,
    });
  });

  it("accepts an en dash and a non-breaking space around the teams", () => {
    const line = `23.10.2026 19:30 Ахмат\u00a0\u2013\u00a0Оренбург 2-1`;
    const parsed = parsePredictionLine(line);
    expect(parsed).toMatchObject({ homeName: "Ахмат", awayName: "Оренбург", homeGoals: 2, awayGoals: 1, rawLine: line });
  });

  it("allows extra space around the score separator", () => {
    expect(parsePredictionLine("23.10.2026 19:30 Ахмат — Оренбург 2 - 1")).toMatchObject({
      homeGoals: 2,
      awayGoals: 1,
    });
    expect(parsePredictionLine("23.10.2026 19:30 Ахмат - Оренбург 2 : 1")).toMatchObject({
      homeGoals: 2,
      awayGoals: 1,
    });
  });

  it("does not turn a kickoff time into a score", () => {
    const line = "23.10.2026 19:30 Ахмат — Оренбург";
    const parsed = parsePredictionLine(line);
    expect(parsed).toMatchObject({
      homeName: "Ахмат",
      awayName: "Оренбург",
      homeGoals: null,
      awayGoals: null,
      rawLine: line,
    });
    expect(parsed?.warnings).toContain("Missing score");
    expect(parsed?.homeGoals).not.toBe(19);
    expect(parsed?.awayGoals).not.toBe(30);
  });

  it("keeps a hyphen inside a team name", () => {
    const line = "23.10.2026 19:30 Крылья-Советов - Факел 1-0";
    const parsed = parsePredictionLine(line);
    expect(parsed).toMatchObject({ homeName: "Крылья-Советов", awayName: "Факел", homeGoals: 1, awayGoals: 0 });
    expect(parseComment(line, [hyphenated]).lines[0]?.fixtureId).toBe("wings");
  });

  it("reads the same pair from the opening-post schedule", () => {
    const schedule = parseFixtureSchedule("23.10.2026 19:30 Ахмат — Оренбург");
    expect(schedule.fixtures[0]).toMatchObject({
      homeTeam: "Ахмат",
      awayTeam: "Оренбург",
      rawLine: "23.10.2026 19:30 Ахмат — Оренбург",
    });
  });

  it("keeps the supported short score formats", () => {
    expect(parsePredictionLine("Спартак - Рубин 2-1")).toMatchObject({
      homeName: "Спартак",
      awayName: "Рубин",
      homeGoals: 2,
      awayGoals: 1,
    });
    expect(parsePredictionLine("Зенит — Ахмат 1–1")).toMatchObject({ homeGoals: 1, awayGoals: 1 });
    expect(parsePredictionLine("23.10.2026 19:30 Ахмат\u2012Оренбург 2-1")).toMatchObject({
      homeName: "Ахмат",
      awayName: "Оренбург",
      homeGoals: 2,
      awayGoals: 1,
    });
  });

  it("flags a score that has no teams", () => {
    const parsed = parsePredictionLine("2:1");
    expect(parsed).toMatchObject({ homeName: null, awayName: null, homeGoals: 2, awayGoals: 1 });
    expect(parsed?.warnings).toContain("Malformed prediction line");
    const comment = parseComment("просто 2-1 без команд", [akhmat]);
    expect(comment.lines[0]?.fixtureId).toBeNull();
    expect(comment.lines[0]?.warnings.length).toBeGreaterThan(0);
  });
});
