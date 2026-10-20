import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { calculateRoundAction, saveForumUrlAction } from "./workflow-actions";

export const instant = false;

export default async function RoundPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      season: true,
      matches: { orderBy: { sortOrder: "asc" } },
      _count: { select: { forumComments: true, predictionSets: true, roundScores: true } },
    },
  });
  if (!round) {
    notFound();
  }

  const selected = await prisma.predictionSet.count({ where: { roundId: round.id, selected: true } });
  const scoredFixtures = round.matches.filter(
    (match) => match.actualHomeGoals != null && match.actualAwayGoals != null,
  ).length;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-sm">
        <Link className="underline" href={`/admin/seasons/${round.seasonId}`}>
          {round.season.name}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">
        {round.number}. {round.name ?? "Round"}
      </h1>
      <p className="mt-2 text-neutral-600">Status: {round.status}</p>
      {query.error ? <p className="mt-4 border border-red-300 bg-red-50 p-3">{query.error}</p> : null}

      <nav className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link className="underline" href={`/admin/rounds/${round.id}/fixtures`}>
          Fixtures and results
        </Link>
        <Link className="underline" href={`/admin/rounds/${round.id}/review`}>
          Review predictions
        </Link>
        <Link className="underline" href={`/admin/rounds/${round.id}/results`}>
          Round standings
        </Link>
        <Link className="underline" href={`/admin/rounds/${round.id}/export`}>
          Export
        </Link>
        <Link className="underline" href={`/admin/seasons/${round.seasonId}/standings`}>
          Season standings
        </Link>
      </nav>

      <section className="mt-6 border p-4">
        <h2 className="font-semibold">Forum post</h2>
        <form action={saveForumUrlAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input name="roundId" type="hidden" value={round.id} />
          <input
            className="min-w-80 flex-1 border px-2 py-1"
            defaultValue={round.forumUrl ?? ""}
            name="forumUrl"
            placeholder="https://..."
            type="url"
          />
          <button className="border px-3 py-1" type="submit">
            Save URL
          </button>
        </form>
        <p className="mt-3 text-sm text-neutral-600">
          Import: {round._count.forumComments} comments, {round._count.predictionSets} prediction sets, {selected} selected.
        </p>
      </section>

      <section className="mt-6 border p-4">
        <h2 className="font-semibold">Fixtures</h2>
        {round.matches.length === 0 ? (
          <p className="mt-2 text-neutral-600">No fixtures yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {round.matches.map((match) => (
              <li key={match.id}>
                {match.sortOrder}. {match.homeTeam} — {match.awayTeam}
                {match.isMatchOfTheRound ? " (official MT)" : ""}
                {match.actualHomeGoals != null && match.actualAwayGoals != null
                  ? ` ${match.actualHomeGoals}-${match.actualAwayGoals}`
                  : " — no result"}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-neutral-600">
          Actual results: {scoredFixtures} of {round.matches.length}. Calculated rows: {round._count.roundScores}.
        </p>
        <form action={calculateRoundAction} className="mt-3">
          <input name="roundId" type="hidden" value={round.id} />
          <button className="border px-3 py-1" type="submit">
            Calculate round
          </button>
        </form>
      </section>
    </main>
  );
}
