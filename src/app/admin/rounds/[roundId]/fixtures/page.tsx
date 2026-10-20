import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { addFixtureAction, deleteFixtureAction, saveFixturesAction } from "../workflow-actions";

export const instant = false;

export default async function FixturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: { matches: { orderBy: { sortOrder: "asc" } } },
  });
  if (!round) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-sm">
        <Link className="underline" href={`/admin/rounds/${round.id}`}>
          {round.number}. {round.name ?? "Round"}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Fixtures and results</h1>
      <p className="mt-2 text-neutral-600">
        One match can be the official Match of the Round. Leave scores empty until the match is played.
      </p>
      {query.error ? <p className="mt-4 border border-red-300 bg-red-50 p-3">{query.error}</p> : null}
      {query.saved ? <p className="mt-4 border border-green-300 bg-green-50 p-3">Fixtures saved.</p> : null}

      {round.matches.length === 0 ? (
        <p className="mt-6 text-neutral-600">No fixtures yet. Add the first one below.</p>
      ) : (
        <form action={saveFixturesAction} className="mt-6 space-y-3">
          <input name="roundId" type="hidden" value={round.id} />
          {round.matches.map((match) => (
            <div className="flex flex-wrap items-center gap-2 border p-3" key={match.id}>
              <input className="w-16 border px-2 py-1" defaultValue={match.sortOrder} name={`order_${match.id}`} />
              <input className="border px-2 py-1" defaultValue={match.homeTeam} name={`home_${match.id}`} />
              <span>—</span>
              <input className="border px-2 py-1" defaultValue={match.awayTeam} name={`away_${match.id}`} />
              <input
                className="w-16 border px-2 py-1"
                defaultValue={match.actualHomeGoals ?? ""}
                name={`homeGoals_${match.id}`}
                placeholder="H"
              />
              <input
                className="w-16 border px-2 py-1"
                defaultValue={match.actualAwayGoals ?? ""}
                name={`awayGoals_${match.id}`}
                placeholder="A"
              />
              <label className="text-sm">
                <input
                  className="mr-1"
                  defaultChecked={match.isMatchOfTheRound}
                  name="matchOfTheRound"
                  type="radio"
                  value={match.id}
                />
                MT
              </label>
            </div>
          ))}
          <button className="border px-3 py-1" type="submit">
            Save
          </button>
        </form>
      )}

      <div className="mt-4 space-y-2">
        {round.matches.map((match) => (
          <form action={deleteFixtureAction} key={`delete-${match.id}`}>
            <input name="roundId" type="hidden" value={round.id} />
            <input name="matchId" type="hidden" value={match.id} />
            <button className="text-sm underline" type="submit">
              Delete {match.homeTeam} — {match.awayTeam}
            </button>
          </form>
        ))}
      </div>

      <section className="mt-6 border p-4">
        <h2 className="font-semibold">Add a fixture</h2>
        <form action={addFixtureAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input name="roundId" type="hidden" value={round.id} />
          <input className="border px-2 py-1" name="homeTeam" placeholder="Home" />
          <input className="border px-2 py-1" name="awayTeam" placeholder="Away" />
          <button className="border px-3 py-1" type="submit">
            Add
          </button>
        </form>
      </section>
    </main>
  );
}
