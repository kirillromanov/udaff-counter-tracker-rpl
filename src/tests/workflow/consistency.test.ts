import { describe, expect, it } from "vitest";
import { OPERATOR_LABEL, roundLayerLabel } from "@/lib/domain/review/operator-status";
import { fallbackSourceLabel } from "@/lib/domain/results/policy";
import { fixturePhaseLabel, pollStatusLabel } from "@/lib/domain/results/poll";
import { buildLiveSeasonTable } from "@/lib/domain/scoring/live-score";
import { buildProductionStandings } from "@/lib/domain/scoring/production-standings";
import { computedRebuildBlocker } from "@/lib/domain/standings/reconcile";
import { ARCHIVED_ROUND, OPERATIONAL_ROUND, countsTowardProduction } from "@/lib/domain/standings/round-role";

describe("cross-feature operator model", () => {
  it("uses one vocabulary for identity, results, rounds, and season totals", () => {
    expect(OPERATOR_LABEL.ignored_author).toBe("Ignored user");
    expect(OPERATOR_LABEL.alias_suggestion).toBe("Alias");
    expect(OPERATOR_LABEL.unmatched_participant).toBe("Unknown author");
    expect(pollStatusLabel("live")).toBe("Live round");
    expect(pollStatusLabel("finalized")).toBe("Finalized round");
    expect(fixturePhaseLabel("finished-verified", false)).toBe("Source verified");
    expect(fixturePhaseLabel("conflict-review", false)).toBe("Source conflict");
    expect(fallbackSourceLabel("premierliga")).toBe("Fallback source used");
    expect(fallbackSourceLabel("sport-ru")).toBeNull();
    expect(fallbackSourceLabel("understat")).toBeNull();
    expect(roundLayerLabel("imported", 0, ARCHIVED_ROUND)).toBe("Imported raw");
    expect(roundLayerLabel("scored", 1, OPERATIONAL_ROUND)).toBe("Confirmed round");
  });

  it("keeps an archived round with stored points out of the confirmed season total and the provisional delta", () => {
    expect(countsTowardProduction(ARCHIVED_ROUND, 11, 11)).toBe(false);
    const table = buildLiveSeasonTable({
      baselineAfterRound: 11,
      baseline: [{ participantId: "hordi", name: "Hordi Cruyff", points: 250, medals: 1 }],
      participants: [{ id: "hordi", name: "Hordi Cruyff" }],
      rounds: [
        {
          order: 11,
          production: false,
          complete: true,
          scores: [{ participantId: "hordi", confirmedPoints: 40, provisionalPoints: 9 }],
        },
        {
          order: 12,
          production: true,
          complete: false,
          scores: [{ participantId: "hordi", confirmedPoints: 6, provisionalPoints: 4 }],
        },
      ],
    });
    expect(table[0]).toMatchObject({
      baselinePoints: 250,
      confirmedRoundPoints: 0,
      liveDelta: 10,
      confirmedTotal: 250,
      liveTotal: 260,
    });
  });

  it("adds only a finalized production round on top of the trusted baseline", () => {
    const stored = buildProductionStandings({
      baseline: [{ participantId: "hordi", name: "Hordi Cruyff", points: 250, medals: 1, rank: 1 }],
      participants: [{ id: "hordi", name: "Hordi Cruyff" }],
      rounds: [{ roundId: "r12", order: 12, scores: [{ participantId: "hordi", points: 15 }] }],
    });
    expect(stored[0]).toMatchObject({ totalPoints: 265, previousRank: 1, movement: "same" });
  });

  it("refuses a reference check without touching production standings", () => {
    const message = computedRebuildBlocker([
      { number: 11, fixtureCount: 8, scoredFixtureCount: 7, selectedCount: 19 },
    ]);
    expect(message).toMatch(/trusted baseline was left unchanged/);
    expect(message).toMatch(/Production standings were not changed/);
  });
});
