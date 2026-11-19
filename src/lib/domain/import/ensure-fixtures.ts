import { prisma } from "@/lib/db/prisma";
import type { FixtureSchedule, ScheduledFixture } from "@/lib/domain/forum/parse-schedule";
import { chooseFixtureSchedule, fixtureProvenance } from "@/lib/domain/forum/schedule-source";
import type { ForumPost } from "@/lib/domain/forum/types";
import { assertRoundMutable } from "@/lib/domain/rounds/round-lock-db";

export type FixtureCreatePlan = "keep" | "create" | "none";

/** Existing fixtures stay. An empty schedule does not invent fixtures. */
export function planFixtureCreate(existingCount: number, schedule: FixtureSchedule): FixtureCreatePlan {
  if (existingCount > 0) {
    return "keep";
  }
  if (schedule.fixtures.length === 0) {
    return "none";
  }
  return "create";
}

interface FixtureStore {
  match: {
    count(args: { where: { roundId: string } }): Promise<number>;
    createMany(args: {
      data: {
        roundId: string;
        sortOrder: number;
        homeTeam: string;
        awayTeam: string;
        kickoffAt: Date | null;
        isMatchOfTheRound: boolean;
      }[];
    }): Promise<unknown>;
  };
  round: {
    findUnique(args: {
      where: { id: string };
      select: { sourceSnapshot: true };
    }): Promise<{ sourceSnapshot: string | null } | null>;
    update(args: {
      where: { id: string };
      data: { sourceSnapshot?: string; importNotes: string };
    }): Promise<unknown>;
  };
}

export interface EnsureFixturesResult {
  created: boolean;
  count: number;
  notes: string[];
  createdFixtures: ScheduledFixture[];
}

/**
 * Create fixtures only when the round has none.
 * The article schedule is preferred. The first comment is the fallback.
 * An existing list is left unchanged. A failed read writes nothing.
 */
export async function ensureRoundFixtures(
  roundId: string,
  post: ForumPost,
  options?: { db?: FixtureStore; assertMutable?: (roundId: string) => Promise<void> },
): Promise<EnsureFixturesResult> {
  const db = options?.db ?? prisma;
  const assertMutable = options?.assertMutable ?? assertRoundMutable;
  const existing = await db.match.count({ where: { roundId } });
  if (existing > 0) {
    return { created: false, count: existing, notes: [], createdFixtures: [] };
  }
  await assertMutable(roundId);
  const choice = chooseFixtureSchedule(post);
  if (!choice.ok) {
    throw new Error(choice.error);
  }
  await db.match.createMany({
    data: choice.fixtures.map((fixture, index) => ({
      roundId,
      sortOrder: index + 1,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      kickoffAt: fixture.kickoffAt,
      isMatchOfTheRound: fixture.isMatchOfTheRound,
    })),
  });
  const stored = await db.round.findUnique({
    where: { id: roundId },
    select: { sourceSnapshot: true },
  });
  const notes = fixtureProvenance(choice, post.sourceUrl, post.fetchedAt ?? new Date()).split("\n");
  await db.round.update({
    where: { id: roundId },
    data: {
      ...(stored?.sourceSnapshot ? {} : { sourceSnapshot: choice.excerpt }),
      importNotes: notes.join("\n"),
    },
  });
  return { created: true, count: choice.fixtures.length, notes, createdFixtures: choice.fixtures };
}
