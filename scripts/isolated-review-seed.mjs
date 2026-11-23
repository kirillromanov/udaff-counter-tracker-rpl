/**
 * Synthetic rows for a local interface review. Refuses the live database.
 * Run only after DATABASE_URL is set to a new file: path. This file does not
 * read .env, does not start a server, and does not touch the worker.
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
const live = path.resolve("prisma/dev.db");
const target = url.startsWith("file:") ? path.resolve(url.slice("file:".length)) : "";
const lockDir = process.env.WORKER_LOCK_DIR ?? "";
if (!url.startsWith("file:") || target === live || target.endsWith(`${path.sep}prisma${path.sep}dev.db`)) {
  throw new Error("Refusing to seed. Set DATABASE_URL to a new disposable file: database.");
}
if (lockDir.includes(`${path.sep}udaff-counter-tracker${path.sep}worker-locks`)) {
  throw new Error("Refusing to seed while WORKER_LOCK_DIR points at the live worker locks.");
}

const note = "Forum comment text changed without a reliable edit timestamp. Stored predictions were left in place.";
const kickoff = new Date("2026-11-20T16:00:00.000Z");
const future = new Date("2026-12-20T16:00:00.000Z");
const seen = new Date();

const db = new PrismaClient({ datasources: { db: { url } } });
const season = await db.season.create({ data: { name: "UI snapshot", slug: "ui-snapshot" } });
const person = await db.participant.create({ data: { name: "Snapshot", normalizedName: "snapshot-review" } });
await db.seasonParticipant.create({ data: { seasonId: season.id, participantId: person.id } });
const round = await db.round.create({
  data: {
    seasonId: season.id,
    number: 16,
    name: "16",
    standingRole: "operational",
    productionStartedAt: new Date("2026-11-01T00:00:00.000Z"),
    status: "open",
    forumUrl: "https://example.test/round-16",
  },
});
const provisional = await db.match.create({
  data: { roundId: round.id, sortOrder: 1, homeTeam: "Provisional Home", awayTeam: "Provisional Away", kickoffAt: kickoff, actualHomeGoals: 1, actualAwayGoals: 0, resultState: "confirmed", resultResolution: "provisional", resultProvenance: "one-source" },
});
const verified = await db.match.create({
  data: { roundId: round.id, sortOrder: 2, homeTeam: "Verified Home", awayTeam: "Verified Away", kickoffAt: kickoff, actualHomeGoals: 2, actualAwayGoals: 1, resultState: "verified", resultResolution: "verified", resultProvenance: "two-source" },
});
const equal = await db.match.create({
  data: { roundId: round.id, sortOrder: 3, homeTeam: "Equal Home", awayTeam: "Equal Away", kickoffAt: kickoff, actualHomeGoals: 1, actualAwayGoals: 0, resultState: "verified", resultResolution: "verified", resultProvenance: "manual", manuallyCorrected: true, resultNote: "Fixed on the review page." },
});
const manual = await db.match.create({
  data: { roundId: round.id, sortOrder: 4, homeTeam: "Manual Home", awayTeam: "Manual Away", kickoffAt: kickoff, actualHomeGoals: 3, actualAwayGoals: 0, resultState: "verified", resultResolution: "verified", resultProvenance: "manual", manuallyCorrected: true, resultConflict: true, resultVersion: 2, resultNote: "Fixed on the review page." },
});
const conflict = await db.match.create({
  data: { roundId: round.id, sortOrder: 5, homeTeam: "Conflict Home", awayTeam: "Conflict Away", kickoffAt: kickoff, resultState: "conflict", resultResolution: "conflict-review", resultConflict: true, resultNote: "sport-ru 1-0; premierliga 2-0" },
});
await db.match.create({
  data: { roundId: round.id, sortOrder: 6, homeTeam: "Later Home", awayTeam: "Later Away", kickoffAt: future, resultState: "open" },
});
await db.match.create({
  data: { roundId: round.id, sortOrder: 7, homeTeam: "Legacy Home", awayTeam: "Legacy Away", kickoffAt: kickoff, actualHomeGoals: 4, actualAwayGoals: 1, resultState: "manual", resultResolution: "manual", resultProvenance: "", manuallyCorrected: false, resultNote: "Entered on the clean review matrix. This score is used for every participant." },
});
async function observation(source, sourceKey, matchId, homeTeam, awayTeam, homeGoals, awayGoals, role) {
  await db.resultObservation.create({
    data: { source, sourceKey, homeTeam, awayTeam, homeGoals, awayGoals, role, matchId, firstSeenAt: seen, lastSeenAt: seen },
  });
}
await observation("sport-ru", "provisional", provisional.id, "Provisional Home", "Provisional Away", 1, 0, "primary");
await observation("sport-ru", "verified", verified.id, "Verified Home", "Verified Away", 2, 1, "primary");
await observation("premierliga", "verified", verified.id, "Verified Home", "Verified Away", 2, 1, "fallback");
await observation("sport-ru", "equal", equal.id, "Equal Home", "Equal Away", 1, 0, "primary");
await observation("premierliga", "equal", equal.id, "Equal Home", "Equal Away", 1, 0, "fallback");
await observation("sport-ru", "manual", manual.id, "Manual Home", "Manual Away", 1, 0, "primary");
await observation("sport-ru", "conflict", conflict.id, "Conflict Home", "Conflict Away", 1, 0, "primary");
await observation("premierliga", "conflict", conflict.id, "Conflict Home", "Conflict Away", 2, 0, "fallback");
const flagged = await db.forumComment.create({
  data: { roundId: round.id, sourceUrl: "https://example.test/c/sample", externalId: "sample-5707", authorName: "Sample Flag", postedAt: kickoff, rawHtml: "<p>sample</p>", rawText: "sample", reviewState: "flagged", reviewNote: note, ingestionStatus: "flagged" },
});
await db.forumComment.create({
  data: { roundId: round.id, sourceUrl: "https://example.test/c/1", externalId: "9001", authorName: "Sample Author", postedAt: kickoff, rawHtml: "<p>ok</p>", rawText: "1-0", reviewState: "stored", ingestionStatus: "unchanged" },
});
const selected = await db.predictionSet.create({
  data: { roundId: round.id, participantId: person.id, selected: true, status: "accepted", rawComment: "1-0" },
});
await db.prediction.create({ data: { predictionSetId: selected.id, matchId: provisional.id, homeGoals: 1, awayGoals: 0 } });
await db.predictionSet.create({
  data: { roundId: round.id, participantId: person.id, forumCommentId: flagged.id, selected: false, status: "accepted", rawComment: "changed", warningsJson: "[]" },
});
await db.predictionSet.create({
  data: { roundId: round.id, participantId: person.id, selected: false, status: "flagged", warningsJson: JSON.stringify(["duplicate author on this round"]), rawComment: "1-0 and 2-0" },
});
const empty = await db.round.create({
  data: { seasonId: season.id, number: 99, name: "empty", standingRole: "operational", productionStartedAt: kickoff, status: "open" },
});
console.log(JSON.stringify({ roundId: round.id, emptyRoundId: empty.id }));
await db.$disconnect();
