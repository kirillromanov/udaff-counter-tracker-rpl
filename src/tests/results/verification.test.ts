import { describe, expect, it } from "vitest";
import { applyResultDecision, attachResults, decideFixture } from "@/lib/domain/results/decide";
import { parseFootballData } from "@/lib/domain/results/parse-football-data";
import { parseUnderstat } from "@/lib/domain/results/parse-understat";
import { footballDataApiKey } from "@/lib/domain/results/sources";
import { canonicalTeamName } from "@/lib/domain/results/team-names";

const UNDERSTAT = JSON.stringify({
  dates: [
    { id: "1", isResult: true, h: { title: "Rodina" }, a: { title: "FC Orenburg" }, goals: { h: "2", a: "2" } },
    { id: "2", isResult: true, h: { title: "Dinamo Moscow" }, a: { title: "CSKA Moscow" }, goals: { h: "3", a: "1" } },
    { id: "3", isResult: true, h: { title: "Dynamo Makhachkala" }, a: { title: "Akron" }, goals: { h: "1", a: "1" } },
    { id: "4", isResult: false, h: { title: "Zenit St. Petersburg" }, a: { title: "FK Akhmat" }, goals: { h: "1", a: "0" } },
    { id: "5", isResult: true, h: { title: "Zenit St. Petersburg" }, a: { title: "FK Akhmat" }, goals: { h: "", a: "" } },
  ],
});

const FOOTBALL_DATA = JSON.stringify({
  success: true,
  data: {
    matches: [
      {
        match_id: 501,
        status: "complete",
        round: 11,
        season: { year: 20262027 },
        home_team: { team_name: "Rodina" },
        away_team: { team_name: "FC Orenburg" },
        score: { home: 2, away: 2 },
      },
      {
        match_id: 502,
        status: "live",
        round: 12,
        season: { year: 20262027 },
        home_team: { team_name: "Zenit St. Petersburg" },
        away_team: { team_name: "FK Akhmat" },
        score: { home: 1, away: 0 },
      },
      {
        match_id: 100,
        status: "complete",
        round: 11,
        season: { year: 20242025 },
        home_team: { team_name: "Rodina" },
        away_team: { team_name: "FC Orenburg" },
        score: { home: 0, away: 1 },
      },
    ],
  },
});

describe("additional result sources", () => {
  it("normalizes finished Understat matches and skips games that are not final", () => {
    const rows = parseUnderstat(UNDERSTAT);
    expect(rows.map((row) => [row.homeTeam, row.homeGoals, row.awayGoals, row.awayTeam, row.role, row.confidence])).toEqual([
      ["Rodina", 2, 2, "FC Orenburg", "verification", "medium"],
      ["Dinamo Moscow", 3, 1, "CSKA Moscow", "verification", "medium"],
      ["Dynamo Makhachkala", 1, 1, "Akron", "verification", "medium"],
    ]);
    expect(canonicalTeamName("Dynamo Makhachkala")).toBe("Динамо Махачкала");
    expect(canonicalTeamName("Dinamo Moscow")).toBe("Динамо");
  });

  it("normalizes finished footballdata.io matches for the requested season", () => {
    const rows = parseFootballData(FOOTBALL_DATA, 2026);
    expect(rows).toEqual([
      expect.objectContaining({
        source: "football-data",
        sourceKey: "501",
        roundNumber: 11,
        homeTeam: "Rodina",
        awayTeam: "FC Orenburg",
        homeGoals: 2,
        awayGoals: 2,
        role: "fallback",
        confidence: "high",
      }),
    ]);
  });

  it("does not read a footballdata.io key from source code", () => {
    const previous = process.env.FOOTBALLDATA_API_KEY;
    delete process.env.FOOTBALLDATA_API_KEY;
    expect(footballDataApiKey()).toBe("");
    if (previous == null) {
      delete process.env.FOOTBALLDATA_API_KEY;
    } else {
      process.env.FOOTBALLDATA_API_KEY = previous;
    }
  });
});

describe("multi-source verification", () => {
  const primary = { source: "sport-ru", sourceKey: "a", homeTeam: "Родина", awayTeam: "Оренбург", homeGoals: 2, awayGoals: 2, role: "primary" as const, confidence: "high" as const };
  const understat = { source: "understat", sourceKey: "1", roundNumber: null, homeTeam: "Rodina", awayTeam: "FC Orenburg", homeGoals: 2, awayGoals: 2, role: "verification" as const, confidence: "medium" as const };
  const footballData = { source: "football-data", sourceKey: "501", homeTeam: "Rodina", awayTeam: "FC Orenburg", homeGoals: 2, awayGoals: 2, role: "fallback" as const, confidence: "high" as const };

  it("marks a fixture verified when sources agree", () => {
    const decision = decideFixture("rodina", [primary, understat, footballData]);
    expect(decision.outcome).toBe("verified");
    expect(applyResultDecision({ resultState: "confirmed", actualHomeGoals: 2, actualAwayGoals: 2 }, decision)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultState: "verified",
      resultConflict: false,
      changedGoals: false,
    });
  });

  it("keeps an official score provisional when only a weaker source disagrees", () => {
    const decision = decideFixture("rodina", [primary, { ...understat, homeGoals: 1, awayGoals: 1 }]);
    expect(decision.outcome).toBe("confirmed");
    expect(decision.resolution).toBe("provisional");
    expect(decision.selectedSource).toBe("sport-ru");
    expect(decision.homeGoals).toBe(2);
    expect(decision.candidates.find((row) => row.source === "understat")).toMatchObject({ standing: "downgraded", homeGoals: 1, awayGoals: 1 });
    expect(applyResultDecision({ resultState: "verified", actualHomeGoals: 2, actualAwayGoals: 2 }, decision)).toMatchObject({
      actualHomeGoals: 2,
      actualAwayGoals: 2,
      resultState: "confirmed",
      resultResolution: "provisional",
      resultConflict: false,
      changedGoals: false,
    });
  });

  it("does not confirm a score from a verification source alone", () => {
    const attached = attachResults([{ id: "rodina", homeTeam: "Родина", awayTeam: "Оренбург" }], [understat]);
    expect(attached.get("rodina")).toEqual([expect.objectContaining({ homeGoals: 2, awayGoals: 2 })]);
    expect(decideFixture("rodina", attached.get("rodina") ?? []).outcome).toBe("none");
  });
});
