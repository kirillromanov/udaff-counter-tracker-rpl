import { describe, expect, it } from "vitest";
import {
  buildReconciliationReport,
  computedRebuildBlocker,
  normalizeSourceText,
  type ReconciliationRequest,
  type ReconciliationRoundInput,
} from "@/lib/domain/standings/reconcile";

const registry = [
  { participantId: "hordi", name: "Hordi Cruyff" },
  { participantId: "pavel", name: "Павел Абросимов" },
  { participantId: "zuk", name: "зукабля" },
];

function round(overrides: Partial<ReconciliationRoundInput> & Pick<ReconciliationRoundInput, "number">): ReconciliationRoundInput {
  return {
    name: `${overrides.number} тур`,
    forumUrl: `https://example.test/${overrides.number}/`,
    openingText: `Opening for round ${overrides.number}`,
    importNotes: null,
    fixtureCount: 8,
    scoredFixtureCount: 0,
    acceptedParticipantIds: [],
    flagged: [],
    unknownAuthors: [],
    ...overrides,
  };
}

function request(overrides: Partial<ReconciliationRequest> = {}): ReconciliationRequest {
  return {
    afterRoundNumber: 11,
    checkpoint: [
      {
        participantId: "hordi",
        displayName: "Hordi Cruyff",
        rank: 1,
        totalPoints: 250,
        movement: "up",
        movementDelta: 1,
        previousRank: 2,
        markerCount: 1,
      },
      {
        participantId: "zuk",
        displayName: "зукабля",
        rank: 2,
        totalPoints: 243,
        movement: "down",
        movementDelta: 1,
        previousRank: 1,
        markerCount: 3,
      },
    ],
    computed: null,
    latestScoredRound: null,
    rounds: [round({ number: 6, forumUrl: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1827/" }), round({ number: 7, forumUrl: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1887/" })],
    registry,
    aliases: [{ participantId: "zuk", participantName: "зукабля", alias: "Zukoblya", primary: false }],
    decisions: [],
    ...overrides,
  };
}

describe("reconciliation report", () => {
  it("does not calculate standings when actual scores are missing", () => {
    const report = buildReconciliationReport(request());
    expect(report.computedAvailable).toBe(false);
    expect(report.trustworthy).toBe(false);
    expect(report.exactMatches).toHaveLength(0);
    expect(report.pointMismatches).toHaveLength(0);
    expect(report.missingParticipants.map((row) => row.displayName)).toEqual(["Hordi Cruyff", "зукабля"]);
    expect(report.missingParticipants.every((row) => row.cause === "missing_round_data")).toBe(true);
    expect(report.summary).toMatch(/has not been checked/);
    expect(report.highlights.some((line) => line.includes("were not treated as a URL conflict"))).toBe(true);
    expect(report.sourceIssues).toHaveLength(0);
  });

  it("flags duplicated fetched text and ignores a different URL", () => {
    const shared = "the same opening post";
    const report = buildReconciliationReport(
      request({
        rounds: [
          round({ number: 6, forumUrl: "https://example.test/1827/", openingText: shared }),
          round({ number: 7, forumUrl: "https://example.test/1887/", openingText: `  ${shared}  ` }),
        ],
      }),
    );
    expect(normalizeSourceText(shared)).toBe(normalizeSourceText(`  ${shared}  `));
    expect(report.sourceIssues).toEqual([
      {
        roundNumbers: [6, 7],
        cause: "source_content",
        detail: "Opening post text matches round 6. The threads were compared by fetched text, not by URL.",
      },
    ]);
  });

  it("keeps a missing official match of the round as source content", () => {
    const report = buildReconciliationReport(
      request({
        rounds: [round({ number: 9, importNotes: "No Match of the Round was marked in the opening post", scoredFixtureCount: 8 })],
      }),
    );
    expect(report.sourceIssues.map((issue) => issue.detail)).toContain(
      "No Match of the Round was marked in the opening post",
    );
    expect(report.highlights.some((line) => line.includes("No Match of the Round"))).toBe(true);
  });

  it("attributes a complete disagreement to scoring", () => {
    const report = buildReconciliationReport(
      request({
        rounds: [1, 2].map((number) =>
          round({
            number,
            fixtureCount: 2,
            scoredFixtureCount: 2,
            acceptedParticipantIds: ["hordi", "zuk"],
          }),
        ),
        afterRoundNumber: 2,
        computed: [
          { participantId: "hordi", rank: 2, totalPoints: 240, movement: "down", previousRank: 1, roundWins: 0 },
          { participantId: "zuk", rank: 2, totalPoints: 243, movement: "down", previousRank: 1, roundWins: 3 },
        ],
        latestScoredRound: 2,
      }),
    );
    expect(report.computedAvailable).toBe(true);
    expect(report.pointMismatches.map((row) => row.displayName)).toEqual(["Hordi Cruyff"]);
    expect(report.pointMismatches[0]?.cause).toBe("scoring_logic");
    expect(report.rankMismatches.map((row) => row.displayName)).toEqual(["Hordi Cruyff"]);
    expect(report.movementMismatches.map((row) => row.displayName)).toEqual(["Hordi Cruyff"]);
    expect(report.exactMatches.map((row) => row.displayName)).toEqual(["зукабля"]);
    expect(report.trustworthy).toBe(false);
  });

  it("attributes a gap with only a flagged slip to parser extraction", () => {
    const report = buildReconciliationReport(
      request({
        afterRoundNumber: 1,
        checkpoint: [
          {
            participantId: "hordi",
            displayName: "Hordi Cruyff",
            rank: 1,
            totalPoints: 10,
            movement: "same",
            movementDelta: 0,
            previousRank: 1,
            markerCount: 0,
          },
        ],
        computed: [{ participantId: "zuk", rank: 1, totalPoints: 10, movement: "new", previousRank: null, roundWins: 1 }],
        latestScoredRound: 1,
        rounds: [
          round({
            number: 1,
            fixtureCount: 1,
            scoredFixtureCount: 1,
            acceptedParticipantIds: ["zuk"],
            flagged: [
              {
                participantId: "hordi",
                participantName: "Hordi Cruyff",
                selected: false,
                warnings: ["Duplicate prediction for Динамо — ЦСКА; kept the stronger line"],
              },
            ],
          }),
        ],
      }),
    );
    expect(report.missingParticipants[0]).toMatchObject({
      displayName: "Hordi Cruyff",
      cause: "parser_extraction",
    });
    expect(report.parserAmbiguities).toHaveLength(1);
    expect(report.parserExtractions).toHaveLength(0);
    expect(report.extraComputedIds).toEqual(["zuk"]);
  });

  it("attributes a missing accepted slip to missing round data when nothing was flagged", () => {
    const report = buildReconciliationReport(
      request({
        afterRoundNumber: 1,
        checkpoint: [
          {
            participantId: "hordi",
            displayName: "Hordi Cruyff",
            rank: 1,
            totalPoints: 10,
            movement: "same",
            movementDelta: 0,
            previousRank: 1,
            markerCount: 1,
          },
        ],
        computed: [{ participantId: "zuk", rank: 1, totalPoints: 4, movement: "new", previousRank: null, roundWins: 0 }],
        rounds: [round({ number: 1, fixtureCount: 1, scoredFixtureCount: 1, acceptedParticipantIds: ["zuk"] })],
      }),
    );
    expect(report.missingParticipants[0]?.cause).toBe("missing_round_data");
    expect(report.missingParticipants[0]?.causeDetail).toMatch(/No prediction from this participant/);
  });

  it("leaves an unconfirmed shorter name for review", () => {
    const report = buildReconciliationReport(
      request({
        registry: [...registry, { participantId: "doctor", name: "Doctor Livesey" }],
        rounds: [
          round({
            number: 2,
            unknownAuthors: [
              { name: "Doctor", commentCount: 4 },
              { name: "LAX", commentCount: 2 },
            ],
          }),
          round({ number: 5, unknownAuthors: [{ name: "doctor", commentCount: 1 }] }),
        ],
      }),
    );
    const doctor = report.aliasIssues.find((issue) => issue.name === "Doctor");
    expect(doctor).toMatchObject({
      commentCount: 5,
      cause: "participant_matching",
      suspects: [{ participantId: "doctor", name: "Doctor Livesey" }],
    });
    expect(doctor?.detail).toMatch(/was not linked/);
    expect(report.aliasIssues.find((issue) => issue.name === "LAX")?.suspects).toEqual([]);
    expect(report.linkedAliases.map((alias) => alias.alias)).toEqual(["Zukoblya"]);
  });

  it("leaves an unmatched checkpoint name out of the calculated comparison", () => {
    const report = buildReconciliationReport(
      request({
        afterRoundNumber: 1,
        checkpoint: [
          {
            participantId: null,
            displayName: "Rotvalez",
            rank: 9,
            totalPoints: 10,
            movement: "same",
            movementDelta: 0,
            previousRank: 9,
            markerCount: 0,
          },
        ],
        computed: [{ participantId: "hordi", rank: 1, totalPoints: 10, movement: "new", previousRank: null, roundWins: 0 }],
        rounds: [round({ number: 1, scoredFixtureCount: 1, fixtureCount: 1, acceptedParticipantIds: ["hordi"] })],
      }),
    );
    expect(report.rows[0]).toMatchObject({
      status: "unmatched_name",
      cause: "participant_matching",
    });
  });

  it("records an admin decision without changing the checkpoint points", () => {
    const checkpointPoints = 250;
    const report = buildReconciliationReport(
      request({
        decisions: [
          { subjectName: "Hordi Cruyff", action: "keep_manual", note: "Wait for scores", participantId: "hordi" },
        ],
      }),
    );
    expect(report.rows[0]?.decision?.action).toBe("keep_manual");
    expect(report.rows[0]?.checkpoint.totalPoints).toBe(checkpointPoints);
  });

  it("calls a clean calculated table trustworthy", () => {
    const report = buildReconciliationReport(
      request({
        afterRoundNumber: 1,
        checkpoint: [
          {
            participantId: "hordi",
            displayName: "Hordi Cruyff",
            rank: 1,
            totalPoints: 20,
            movement: "same",
            movementDelta: 0,
            previousRank: 1,
            markerCount: 1,
          },
        ],
        computed: [{ participantId: "hordi", rank: 1, totalPoints: 20, movement: "same", previousRank: 1, roundWins: 1 }],
        latestScoredRound: 1,
        rounds: [round({ number: 1, fixtureCount: 1, scoredFixtureCount: 1, acceptedParticipantIds: ["hordi"] })],
      }),
    );
    expect(report.trustworthy).toBe(true);
    expect(report.exactMatches).toHaveLength(1);
    expect(report.pointMismatches).toHaveLength(0);
  });

  it("refuses a partial rebuild", () => {
    expect(
      computedRebuildBlocker([
        { number: 6, fixtureCount: 8, scoredFixtureCount: 0, selectedCount: 18 },
        { number: 7, fixtureCount: 8, scoredFixtureCount: 8, selectedCount: 21 },
      ]),
    ).toMatch(/manual baseline was left unchanged/);
    expect(
      computedRebuildBlocker([{ number: 1, fixtureCount: 8, scoredFixtureCount: 8, selectedCount: 15 }]),
    ).toBeNull();
  });
});
