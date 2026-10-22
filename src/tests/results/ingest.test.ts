import { describe, expect, it } from "vitest";
import { applyResultDecision, attachResults, decideFixture } from "@/lib/domain/results/decide";
import { parseChampionat } from "@/lib/domain/results/parse-championat";
import { parseSportbox } from "@/lib/domain/results/parse-sportbox";
import { parseSportRu } from "@/lib/domain/results/parse-sport-ru";
import { interpretSourcePage } from "@/lib/domain/results/sources";
import { isAccessBlocked } from "@/lib/domain/results/types";

const SPORT_RU = `
<table>
<tr class="live"><td>now</td><td class="round">11</td><td>Зенит</td><td class="score">1</td><td>:</td><td class="score">0</td><td>Ахмат</td></tr>
<tr><td>18.10.2026</td><td class="round">11</td><td><a>Динамо (М)</a></td><td class="score">3</td><td class="score">:</td><td class="score">1</td><td><a>ЦСКА</a></td></tr>
<tr><td>18.10.2026</td><td class="round">11</td><td><a>Динамо (Мх)</a></td><td class="score">1</td><td>:</td><td class="score">1</td><td><a>Акрон</a></td></tr>
<tr><td>25.10.2026</td><td class="round">12</td><td><a>Зенит</a></td><td class="score"></td><td></td><td class="score"></td><td><a>Ахмат</a></td></tr>
</table>
<script><tr><td class="round">11</td><td>Спартак</td><td>9</td><td>:</td><td>9</td><td>Рубин</td></tr></script>
`;

describe("result source parsers", () => {
  it("reads finished Sport.ru rows and skips live, unplayed, and script text", () => {
    const rows = parseSportRu(SPORT_RU);
    expect(rows).toEqual([
      expect.objectContaining({ source: "sport-ru", roundNumber: 11, homeTeam: "Динамо (М)", homeGoals: 3, awayGoals: 1, awayTeam: "ЦСКА" }),
      expect.objectContaining({ source: "sport-ru", roundNumber: 11, homeTeam: "Динамо (Мх)", homeGoals: 1, awayGoals: 1 }),
    ]);
  });

  it("reads a Championat block and treats an auth wall as a failed source", () => {
    const html = `
      <div class="results-item">
        <div>11 тур</div>
        <a class="results-item__name">Зенит</a>
        <span class="results-item__score">3 : 2</span>
        <a class="results-item__name">Ахмат</a>
      </div>`;
    expect(parseChampionat(html)).toEqual([
      expect.objectContaining({ source: "championat", roundNumber: 11, homeGoals: 3, awayGoals: 2 }),
    ]);
    const wall = `<html><title>Чемпионат</title><p>Вход через SberID</p></html>`;
    expect(isAccessBlocked(wall)).toBe(true);
    expect(interpretSourcePage(
      { id: "championat", role: "fallback", url: "https://example.test", parse: parseChampionat },
      true,
      wall,
      null,
    ).status).toBe("failed");
  });

  it("reads a Sportbox row and records an HTTP block as a failure", () => {
    const html = `<tr><td class="tour">11</td><td class="team1">Локомотив М</td><td class="score">3:3</td><td class="team2">Краснодар</td></tr>`;
    expect(parseSportbox(html)[0]).toMatchObject({ source: "sportbox", homeGoals: 3, awayGoals: 3, roundNumber: 11 });
    const blocked = interpretSourcePage(
      { id: "sportbox", role: "fallback", url: "https://example.test", parse: parseSportbox },
      false,
      "Доступ запрещен",
      "HTTP 403",
    );
    expect(blocked.status).toBe("failed");
    expect(blocked.results).toEqual([]);
  });
});

describe("result decisions", () => {
  const fixtures = [
    { id: "dinamo", homeTeam: "Динамо", awayTeam: "ЦСКА" },
    { id: "makh", homeTeam: "Динамо Махачкала", awayTeam: "Акрон" },
    { id: "loko", homeTeam: "Локомотив", awayTeam: "Краснодар" },
  ];

  it("maps source nicknames onto the fixture and flips a reversed pair", () => {
    const attached = attachResults(fixtures, [
      ...parseSportRu(SPORT_RU),
      { source: "sportbox", sourceKey: "rev", roundNumber: 11, homeTeam: "Краснодар", awayTeam: "Локомотив М", homeGoals: 1, awayGoals: 4 },
    ]);
    expect(attached.get("dinamo")).toEqual([expect.objectContaining({ source: "sport-ru", homeGoals: 3, awayGoals: 1 })]);
    expect(attached.get("makh")).toEqual([expect.objectContaining({ homeGoals: 1, awayGoals: 1 })]);
    expect(attached.get("loko")).toEqual([expect.objectContaining({ homeGoals: 4, awayGoals: 1 })]);
  });

  it("confirms one source and refuses to overwrite when sources disagree", () => {
    const agreed = decideFixture("dinamo", [{ source: "sport-ru", sourceKey: "a", homeTeam: "Динамо", awayTeam: "ЦСКА", homeGoals: 3, awayGoals: 1 }]);
    expect(agreed.outcome).toBe("confirmed");
    expect(applyResultDecision({ resultState: "open", actualHomeGoals: null, actualAwayGoals: null }, agreed)).toMatchObject({
      actualHomeGoals: 3,
      actualAwayGoals: 1,
      resultState: "confirmed",
      resultConflict: false,
      changedGoals: true,
    });

    const conflict = decideFixture("dinamo", [
      { source: "sport-ru", sourceKey: "a", homeTeam: "Динамо", awayTeam: "ЦСКА", homeGoals: 3, awayGoals: 1 },
      { source: "championat", sourceKey: "b", homeTeam: "Динамо", awayTeam: "ЦСКА", homeGoals: 2, awayGoals: 1 },
    ]);
    expect(conflict.outcome).toBe("conflict");
    expect(conflict.note).toMatch(/disagree/);
    expect(
      applyResultDecision({ resultState: "confirmed", actualHomeGoals: 3, actualAwayGoals: 1 }, conflict),
    ).toMatchObject({
      actualHomeGoals: 3,
      actualAwayGoals: 1,
      resultState: "confirmed",
      resultConflict: true,
      changedGoals: false,
    });
  });

  it("leaves a manual score in place when a later fetch disagrees", () => {
    const decision = decideFixture("dinamo", [
      { source: "sport-ru", sourceKey: "a", homeTeam: "Динамо", awayTeam: "ЦСКА", homeGoals: 3, awayGoals: 1 },
    ]);
    expect(
      applyResultDecision({ resultState: "manual", actualHomeGoals: 2, actualAwayGoals: 2 }, decision),
    ).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultState: "manual",
      resultConflict: true,
      changedGoals: false,
    });
  });
});
