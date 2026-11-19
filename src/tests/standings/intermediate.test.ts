import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { intermediateRoundHeading, exportRoundStandings } from "@/lib/domain/export/export-round-standings";
import { scoreRound } from "@/lib/domain/scoring/score-round";
import {
  classifyIntermediateFixture,
  countsAsConfirmedRound,
  scoreIntermediateRound,
  type IntermediateFixture,
} from "@/lib/domain/standings/intermediate";

function fixture(overrides: Partial<IntermediateFixture> = {}): IntermediateFixture {
  return {
    matchId: "m1",
    label: "Локомотив — Рубин",
    actualHomeGoals: 0,
    actualAwayGoals: 1,
    resultState: "verified",
    resultResolution: "verified",
    resultConflict: false,
    isMatchOfTheRound: false,
    observationStatuses: ["finished"],
    ...overrides,
  };
}

const pending = fixture({
  matchId: "m2",
  label: "Факел — Динамо",
  actualHomeGoals: null,
  actualAwayGoals: null,
  resultState: "open",
  resultResolution: "",
  observationStatuses: [],
});

describe("intermediate round standings", () => {
  it("scores one verified finished fixture and skips pending fixtures without a penalty", () => {
    const scored = scoreIntermediateRound({
      roundId: "round",
      fixtures: [fixture(), pending, fixture({ matchId: "m3", label: "later", actualHomeGoals: null, actualAwayGoals: null, resultState: "open", resultResolution: "", observationStatuses: [] })],
      participants: [
        { participantId: "played", predictions: [{ matchId: "m1", home: 0, away: 1, ignored: false }] },
        { participantId: "silent", predictions: [] },
      ],
    });
    expect(scored.status).toBe("partial");
    expect(scored.includedCount).toBe(1);
    expect(scored.fixtureCount).toBe(3);
    expect(scored.roundBonusPending).toBe(true);
    const played = scored.scores.find((row) => row.participantId === "played");
    const silent = scored.scores.find((row) => row.participantId === "silent");
    expect(played?.result.matches).toHaveLength(1);
    expect(played?.result.roundTotalGoalsBonus).toBe(0);
    expect(silent?.result.roundTotal).toBe(-1);
    expect(scored.excluded.map((item) => item.reason)).toEqual(["pending", "pending"]);
  });

  it("penalises a missing ordinary prediction by 1 and a missing Match of the Round by 2 once", () => {
    const scored = scoreIntermediateRound({
      roundId: "round",
      fixtures: [
        fixture(),
        fixture({ matchId: "mt", label: "Краснодар — ЦСКА", isMatchOfTheRound: true, actualHomeGoals: 1, actualAwayGoals: 0 }),
      ],
      participants: [{ participantId: "silent", predictions: [] }],
    });
    const row = scored.scores[0];
    expect(row?.result.matches.map((match) => match.finalMatchPoints)).toEqual([-1, -2]);
    expect(row?.result.roundTotal).toBe(-3);
  });

  it("excludes a verified live score and a finished conflict or unverified score", () => {
    expect(classifyIntermediateFixture(fixture({ observationStatuses: ["live"] }))).toBe("live");
    expect(classifyIntermediateFixture(fixture({ resultConflict: true }))).toBe("conflict");
    expect(classifyIntermediateFixture(fixture({ resultState: "confirmed", resultResolution: "provisional" }))).toBe("unverified");
    const scored = scoreIntermediateRound({
      roundId: "round",
      fixtures: [
        fixture(),
        fixture({ matchId: "live", label: "live", observationStatuses: ["live"] }),
        fixture({ matchId: "conflict", label: "conflict", resultConflict: true }),
        fixture({ matchId: "open-score", label: "open-score", resultState: "confirmed", resultResolution: "provisional" }),
      ],
      participants: [{ participantId: "played", predictions: [{ matchId: "m1", home: 0, away: 1, ignored: false }, { matchId: "live", home: 5, away: 5, ignored: false }] }],
    });
    expect(scored.includedCount).toBe(1);
    expect(scored.scores[0]?.result.matches.map((match) => match.matchId)).toEqual(["m1"]);
    expect(scored.excluded.map((item) => item.reason)).toEqual(["live", "conflict", "unverified"]);
  });

  it("keeps the round total-goals bonus pending until every fixture is included", () => {
    const partial = scoreIntermediateRound({
      roundId: "round",
      fixtures: [fixture({ actualHomeGoals: 1, actualAwayGoals: 0 }), pending],
      participants: [{ participantId: "played", predictions: [{ matchId: "m1", home: 1, away: 0, ignored: false }] }],
    });
    expect(partial.scores[0]?.result.roundTotalGoalsBonus).toBe(0);

    const complete = scoreIntermediateRound({
      roundId: "round",
      fixtures: [
        fixture({ actualHomeGoals: 1, actualAwayGoals: 0 }),
        fixture({ matchId: "m2", label: "second", actualHomeGoals: 2, actualAwayGoals: 0 }),
      ],
      participants: [{
        participantId: "played",
        predictions: [
          { matchId: "m1", home: 1, away: 0, ignored: false },
          { matchId: "m2", home: 2, away: 0, ignored: false },
        ],
      }],
    });
    const direct = scoreRound({
      roundId: "round",
      participantId: "played",
      matches: [
        { matchId: "m1", actual: { home: 1, away: 0 }, predicted: { home: 1, away: 0 }, isMatchOfTheRound: false },
        { matchId: "m2", actual: { home: 2, away: 0 }, predicted: { home: 2, away: 0 }, isMatchOfTheRound: false },
      ],
    });
    expect(complete.status).toBe("complete");
    expect(complete.scores[0]?.result.roundTotal).toBe(direct.roundTotal);
    expect(complete.scores[0]?.result.roundTotalGoalsBonus).toBe(direct.roundTotalGoalsBonus);
  });

  it("returns the same totals on a repeated calculation and no table when nothing is finished", () => {
    const input = {
      roundId: "round",
      fixtures: [fixture(), pending],
      participants: [
        { participantId: "a", predictions: [{ matchId: "m1", home: 0, away: 1, ignored: false }] },
        { participantId: "b", predictions: [] },
      ],
    };
    const first = scoreIntermediateRound(input);
    const second = scoreIntermediateRound(input);
    expect(second.scores.map((row) => row.result.roundTotal)).toEqual(first.scores.map((row) => row.result.roundTotal));
    expect(scoreIntermediateRound({ roundId: "round", fixtures: [pending], participants: [{ participantId: "a", predictions: [] }] })).toMatchObject({
      status: "empty",
      scores: [],
      includedCount: 0,
    });
  });

  it("keeps a partial round out of the confirmed season total", () => {
    expect(countsAsConfirmedRound("partial")).toBe(false);
    expect(countsAsConfirmedRound("stale")).toBe(false);
    expect(countsAsConfirmedRound("open")).toBe(false);
    expect(countsAsConfirmedRound("scored")).toBe(true);
    const clean = readFileSync("src/lib/domain/standings/load-clean-season.ts", "utf8");
    const live = readFileSync("src/lib/domain/standings/load-live.ts", "utf8");
    expect(clean).toContain("countsAsConfirmedRound");
    expect(live).toContain("countsAsConfirmedRound");
  });

  it("puts the intermediate heading on the participant export and wires every button to one calculation", () => {
    const text = exportRoundStandings(
      [{ name: "моноклон", matchPoints: 11, roundBonus: 0, totalPoints: 11, isWinner: false }],
      { heading: intermediateRoundHeading(14, 1, 8) },
    );
    expect(text.startsWith("Промежуточные итоги тура 14 — после 1 из 8 матчей\n")).toBe(true);
    expect(text).toContain("моноклон");
    expect(text).not.toContain("мидалько");

    const poll = readFileSync("src/lib/domain/results/poll-run.ts", "utf8");
    const button = readFileSync("src/app/admin/rounds/[roundId]/calculate-intermediate-button.tsx", "utf8");
    const refresh = readFileSync("src/app/admin/rounds/[roundId]/workflow-actions.ts", "utf8");
    const save = readFileSync("src/lib/domain/import/save-matrix.ts", "utf8");
    expect(poll).toContain("recalculateRound");
    expect(poll).toContain("ROUND_STATUS_STALE");
    expect(refresh).toContain("refreshRoundResults");
    expect(button).toContain("calculateIntermediateAction");
    expect(button).toContain("hasUnsavedFieldEdits");
    expect(button).not.toContain("ingest");
    expect(save).toContain("recalculateRound");
  });
});
