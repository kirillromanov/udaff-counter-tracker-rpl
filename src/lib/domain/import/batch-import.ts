import { prisma } from "@/lib/db/prisma";
import { fetchForumPost } from "@/lib/domain/forum/fetch-post";
import { parseFixtureSchedule } from "@/lib/domain/forum/parse-schedule";
import type { ForumPost } from "@/lib/domain/forum/types";
import { ensureKnownIdentities } from "@/lib/domain/participants/registry";
import { AUTHOR_NOTE } from "@/lib/domain/participants/resolve-author";
import { parseStoredComments, saveForumPost } from "./persist-import";
import { ROUND_SOURCES, type RoundSource } from "./round-sources";

export interface RoundImportReport {
  number: number;
  name: string;
  url: string;
  title: string | null;
  error: string | null;
  comments: number;
  fixtures: number;
  fixturesCreated: boolean;
  accepted: number;
  flaggedSets: number;
  unmatchedAuthors: number;
  notes: string[];
}

function snapshotKey(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

async function ensureFixtures(roundId: string, post: ForumPost): Promise<{ created: boolean; count: number; notes: string[] }> {
  const schedule = parseFixtureSchedule(post.openingText);
  const existing = await prisma.match.count({ where: { roundId } });
  if (existing > 0) {
    const notes = [...schedule.warnings];
    if (schedule.fixtures.length > 0 && schedule.fixtures.length !== existing) {
      notes.push(`Kept ${existing} fixtures already on the round`);
    }
    return { created: false, count: existing, notes };
  }
  if (schedule.fixtures.length === 0) {
    return { created: false, count: 0, notes: schedule.warnings };
  }
  await prisma.match.createMany({
    data: schedule.fixtures.map((fixture, index) => ({
      roundId,
      sortOrder: index + 1,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      kickoffAt: fixture.kickoffAt,
      isMatchOfTheRound: fixture.isMatchOfTheRound,
    })),
  });
  return { created: true, count: schedule.fixtures.length, notes: schedule.warnings };
}

async function importOne(
  seasonId: string,
  source: RoundSource,
  load: (url: string) => Promise<ForumPost>,
): Promise<{ report: RoundImportReport; snapshot: string }> {
  const post = await load(source.url);
  const existing = await prisma.round.findUnique({
    where: { seasonId_number: { seasonId, number: source.number } },
  });
  const round = existing
    ? await prisma.round.update({
        where: { id: existing.id },
        data: {
          name: source.name,
          forumUrl: post.sourceUrl,
          fetchedAt: post.fetchedAt ?? new Date(),
          sourceSnapshot: post.openingText,
          status: existing.status === "scored" ? existing.status : "imported",
        },
      })
    : await prisma.round.create({
        data: {
          seasonId,
          number: source.number,
          name: source.name,
          forumUrl: post.sourceUrl,
          fetchedAt: post.fetchedAt ?? new Date(),
          sourceSnapshot: post.openingText,
          status: "imported",
        },
      });

  const fixtures = await ensureFixtures(round.id, post);
  const comments = await saveForumPost(round.id, post);
  await parseStoredComments(round.id);
  const [accepted, flaggedSets, unmatchedAuthors] = await Promise.all([
    prisma.predictionSet.count({ where: { roundId: round.id, status: "accepted" } }),
    prisma.predictionSet.count({ where: { roundId: round.id, status: "flagged" } }),
    prisma.forumComment.count({
      where: {
        roundId: round.id,
        reviewState: "flagged",
        reviewNote: { in: [AUTHOR_NOTE.uncertain, AUTHOR_NOTE.unknown] },
      },
    }),
  ]);
  const notes = [...fixtures.notes];
  await prisma.round.update({
    where: { id: round.id },
    data: { importNotes: notes.length > 0 ? notes.join("\n") : null },
  });

  return {
    snapshot: post.openingText,
    report: {
      number: source.number,
      name: source.name,
      url: post.sourceUrl,
      title: post.title,
      error: null,
      comments,
      fixtures: fixtures.count,
      fixturesCreated: fixtures.created,
      accepted,
      flaggedSets,
      unmatchedAuthors,
      notes,
    },
  };
}

/**
 * Download tours 1–11, store the raw comments, and parse them into review.
 * This does not calculate round scores or season standings.
 */
export async function importRounds(options: {
  seasonId: string;
  sources?: readonly RoundSource[];
  fetchPost?: (url: string) => Promise<ForumPost>;
}): Promise<RoundImportReport[]> {
  const sources = options.sources ?? ROUND_SOURCES;
  const load = options.fetchPost ?? fetchForumPost;
  await ensureKnownIdentities();
  const reports: RoundImportReport[] = [];
  const snapshots: { number: number; text: string }[] = [];

  for (const source of sources) {
    try {
      const result = await importOne(options.seasonId, source, load);
      reports.push(result.report);
      snapshots.push({ number: source.number, text: snapshotKey(result.snapshot) });
    } catch (error) {
      reports.push({
        number: source.number,
        name: source.name,
        url: source.url,
        title: null,
        error: error instanceof Error ? error.message : "Import failed",
        comments: 0,
        fixtures: 0,
        fixturesCreated: false,
        accepted: 0,
        flaggedSets: 0,
        unmatchedAuthors: 0,
        notes: [],
      });
    }
  }

  const seen = new Map<string, number>();
  for (const snapshot of snapshots) {
    if (!snapshot.text) {
      continue;
    }
    const previous = seen.get(snapshot.text);
    if (previous != null) {
      const report = reports.find((item) => item.number === snapshot.number);
      const note = `Opening post text matches round ${previous}`;
      report?.notes.push(note);
      await prisma.round.update({
        where: { seasonId_number: { seasonId: options.seasonId, number: snapshot.number } },
        data: { importNotes: report?.notes.join("\n") || note },
      });
    } else {
      seen.set(snapshot.text, snapshot.number);
    }
  }

  return reports;
}
