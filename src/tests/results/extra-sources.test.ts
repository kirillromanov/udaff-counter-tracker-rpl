import { describe, expect, it } from "vitest";
import { applyResultDecision, attachResults, type AlignedObservation } from "@/lib/domain/results/decide";
import { parseFootbolno } from "@/lib/domain/results/parse-footbolno";
import { parsePremierliga } from "@/lib/domain/results/parse-premierliga";
import { resolveFixture } from "@/lib/domain/results/policy";
import { RESULT_ADAPTERS, interpretSourcePage } from "@/lib/domain/results/sources";
import { canonicalTeamName } from "@/lib/domain/results/team-names";

const PREMIERLIGA = JSON.stringify({
  clubs: [
    { id: 7, name: "Динамо-Москва" },
    { id: 2, name: "ПФК ЦСКА" },
    { id: 3, name: "Зенит" },
    { id: 702, name: "Ахмат" },
  ],
  stages: [
    { id: 2972, name: "Тур 11" },
    { id: 2973, name: "Тур 12" },
  ],
  matches: [
    {
      stage: 2972,
      matches: [
        { id: 16300, clubH: 7, clubA: 2, goalH: 3, goalA: 1, status: 4 },
        { id: 16301, clubH: 99, clubA: 2, goalH: 1, goalA: 0, status: 4 },
      ],
    },
    {
      stage: 2973,
      matches: [
        { id: 16322, clubH: 3, clubA: 702, goalH: null, goalA: null, status: 0 },
        { id: 16323, clubH: 3, clubA: 702, goalH: 1, goalA: 0, status: 2 },
      ],
    },
  ],
});

const FOOTBOLNO = `
<div id="rezultaty">
  <div class="fbst-mc">
    <div class="fbst-mc-d">19 октября<br>Завершён</div>
    <a href="/komanda/dinamo-moskva">Динамо Москва</a>
    <a href="/komanda/cska">ЦСКА</a>
    <div class="fbst-mc-s">3:1</div>
  </div>
  <div class="fbst-mc">
    <div class="fbst-mc-d">25 октября<br>Не начался</div>
    <a href="/komanda/zenit">Зенит</a>
    <a href="/komanda/akhmat">Ахмат</a>
    <div class="fbst-mc-s">1:0</div>
  </div>
  <div class="fbst-mc">
    <div class="fbst-mc-d">18 октября<br>Завершён</div>
    <a href="/komanda/rodina">Родина</a>
    <a href="/komanda/orenburg">Оренбург</a>
    <div class="fbst-mc-s">vs</div>
  </div>
</div>
<section id="tur">
  <div class="fbst-mc">
    <div class="fbst-mc-d">1 ноября<br>Завершён</div>
    <a href="/komanda/spartak">Спартак</a>
    <a href="/komanda/rubin">Рубин</a>
    <div class="fbst-mc-s">9:9</div>
  </div>
</section>
`;

function observation(overrides: Partial<AlignedObservation> & Pick<AlignedObservation, "source" | "role">): AlignedObservation {
  return {
    sourceKey: overrides.source,
    homeTeam: "Родина",
    awayTeam: "Оренбург",
    homeGoals: 2,
    awayGoals: 2,
    confidence: "high",
    matchStatus: "finished",
    completeness: "complete",
    ...overrides,
  };
}

describe("premierliga and footbolno results", () => {
  it("reads finished premierliga matches and keeps an unmapped status as partial evidence", () => {
    const rows = parsePremierliga(PREMIERLIGA);
    expect(rows).toEqual([
      expect.objectContaining({
        source: "premierliga",
        sourceKey: "16300",
        roundNumber: 11,
        homeTeam: "Динамо-Москва",
        awayTeam: "ПФК ЦСКА",
        homeGoals: 3,
        awayGoals: 1,
        role: "fallback",
        confidence: "high",
        matchStatus: "finished",
        completeness: "complete",
      }),
      expect.objectContaining({
        sourceKey: "16323",
        roundNumber: 12,
        homeTeam: "Зенит",
        awayTeam: "Ахмат",
        homeGoals: 1,
        awayGoals: 0,
        confidence: "low",
        matchStatus: "unknown",
        completeness: "partial",
      }),
    ]);
    expect(canonicalTeamName("Динамо-Москва")).toBe("Динамо");
    expect(canonicalTeamName("ПФК ЦСКА")).toBe("ЦСКА");
    expect(canonicalTeamName("Спартак-Москва")).toBe("Спартак");
  });

  it("treats a premierliga captcha page as a failed source", () => {
    const adapter = RESULT_ADAPTERS.find((item) => item.id === "premierliga");
    expect(adapter).toBeTruthy();
    const blocked = interpretSourcePage(adapter!, true, "<html>Are you not a robot?</html>", null);
    expect(blocked.status).toBe("failed");
    expect(blocked.results).toEqual([]);
    expect(parsePremierliga("<html>Are you not a robot?</html>")).toEqual([]);
  });

  it("reads the footbolno results section and ignores the upcoming tour", () => {
    const rows = parseFootbolno(FOOTBOLNO);
    expect(rows.map((row) => [row.homeTeam, row.homeGoals, row.awayGoals, row.awayTeam, row.matchStatus, row.completeness, row.confidence])).toEqual([
      ["Динамо Москва", 3, 1, "ЦСКА", "finished", "complete", "high"],
      ["Зенит", 1, 0, "Ахмат", "scheduled", "partial", "low"],
    ]);
    expect(rows.every((row) => row.role === "verification" && row.roundNumber == null)).toBe(true);
  });

  it("normalizes both sources onto contest fixtures", () => {
    const fixtures = [
      { id: "dynamo", homeTeam: "Динамо", awayTeam: "ЦСКА" },
      { id: "zenit", homeTeam: "Зенит", awayTeam: "Ахмат" },
    ];
    const premierliga = attachResults(fixtures, parsePremierliga(PREMIERLIGA));
    const footbolno = attachResults(fixtures, parseFootbolno(FOOTBOLNO));
    expect(premierliga.get("dynamo")).toEqual([
      expect.objectContaining({ source: "premierliga", homeGoals: 3, awayGoals: 1, completeness: "complete" }),
    ]);
    expect(footbolno.get("dynamo")).toEqual([
      expect.objectContaining({ source: "footbolno", homeTeam: "Динамо Москва", homeGoals: 3, awayGoals: 1, completeness: "complete" }),
    ]);
    expect(resolveFixture("zenit", premierliga.get("zenit") ?? [], new Set()).outcome).toBe("none");
  });

  it("verifies agreement and keeps a disagreement for review", () => {
    const stored = { resultState: "verified", actualHomeGoals: 2, actualAwayGoals: 2 };
    const agreed = resolveFixture(
      "rodina",
      [
        observation({ source: "sport-ru", role: "primary" }),
        observation({ source: "premierliga", role: "fallback" }),
        observation({ source: "footbolno", role: "verification" }),
      ],
      new Set(),
    );
    expect(agreed.outcome).toBe("verified");
    expect(applyResultDecision(stored, agreed).actualHomeGoals).toBe(2);

    const disagreed = resolveFixture(
      "rodina",
      [
        observation({ source: "sport-ru", role: "primary" }),
        observation({ source: "premierliga", role: "fallback", homeGoals: 3, awayGoals: 1 }),
        observation({ source: "footbolno", role: "verification", homeGoals: 1, awayGoals: 0 }),
      ],
      new Set(),
    );
    const write = applyResultDecision(stored, disagreed);
    expect(disagreed.outcome).toBe("conflict");
    expect(disagreed.note).toContain("premierliga");
    expect(disagreed.note).toContain("footbolno");
    expect(write.actualHomeGoals).toBe(2);
    expect(write.actualAwayGoals).toBe(2);
    expect(write.resultConflict).toBe(true);
    expect(write.changedGoals).toBe(false);

    const verificationOnly = resolveFixture("rodina", [observation({ source: "footbolno", role: "verification" })], new Set());
    expect(verificationOnly.outcome).toBe("none");
    expect(applyResultDecision(stored, verificationOnly).resultConflict).toBe(false);

    const partialIgnored = resolveFixture(
      "rodina",
      [
        observation({ source: "sport-ru", role: "primary" }),
        observation({ source: "premierliga", role: "fallback", homeGoals: 9, awayGoals: 9, matchStatus: "unknown", completeness: "partial", confidence: "low" }),
      ],
      new Set(),
    );
    expect(partialIgnored.outcome).toBe("confirmed");
    expect(partialIgnored.note).toContain("sport-ru");
    expect(partialIgnored.note).not.toContain("premierliga");
  });
});
