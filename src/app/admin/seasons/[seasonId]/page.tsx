import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { formatMovement, medalSymbols } from "@/lib/domain/standings/format-movement";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { createRoundAction } from "../../actions";

export const instant = false;

export default async function SeasonPage({
  params,
  searchParams,
}: {
  params: Promise<{ seasonId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { seasonId } = await params;
  const query = await searchParams;
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { rounds: { orderBy: { number: "asc" }, include: { _count: { select: { roundScores: true } } } } },
  });
  if (!season) {
    notFound();
  }
  const snapshot = await latestSeasonSnapshot(season.id);
  const nextNumber = (season.rounds.at(-1)?.number ?? 0) + 1;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-sm">
        <Link className="underline" href="/admin">
          Seasons
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{season.name}</h1>
      <p className="mt-2 text-neutral-600">Rounds, the latest cumulative table, and a new round.</p>
      {query.error ? <p className="mt-4 border border-red-300 bg-red-50 p-3">{query.error}</p> : null}

      <section className="mt-6">
        <h2 className="font-semibold">Rounds</h2>
        {season.rounds.length === 0 ? (
          <p className="mt-2 text-neutral-600">No rounds yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {season.rounds.map((round) => (
              <li key={round.id}>
                <Link className="underline" href={`/admin/rounds/${round.id}`}>
                  {round.number}. {round.name ?? "Round"}
                </Link>
                <span className="ml-2 text-sm text-neutral-500">
                  {round.status}
                  {round._count.roundScores > 0 ? `, ${round._count.roundScores} scored` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 border p-4">
        <h2 className="font-semibold">Create a round</h2>
        <form action={createRoundAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input name="seasonId" type="hidden" value={season.id} />
          <input className="w-24 border px-2 py-1" defaultValue={nextNumber} name="number" type="number" />
          <input className="border px-2 py-1" name="name" placeholder="Name (optional)" />
          <button className="border px-3 py-1" type="submit">
            Create
          </button>
        </form>
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-semibold">Cumulative standings</h2>
          <Link className="underline" href={`/admin/seasons/${season.id}/standings`}>
            Full table
          </Link>
        </div>
        {!snapshot ? (
          <p className="mt-2 text-neutral-600">Calculate a round to build the table.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-neutral-600">
              After {snapshot.name ?? `round ${snapshot.number}`}.
            </p>
            <StandingsTable rows={snapshot.standingSnapshots} />
          </>
        )}
      </section>
    </main>
  );
}

function StandingsTable({
  rows,
}: {
  rows: {
    id: string;
    rank: number;
    previousRank: number | null;
    movement: string;
    totalPoints: number;
    roundWins: number;
    participant: { name: string };
  }[];
}) {
  return (
    <table className="mt-3 w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-1 pr-3">Rank</th>
          <th className="py-1 pr-3">Move</th>
          <th className="py-1 pr-3">Participant</th>
          <th className="py-1 pr-3">Medals</th>
          <th className="py-1">Points</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className="border-b" key={row.id}>
            <td className="py-1 pr-3">{row.rank}</td>
            <td className="py-1 pr-3">{formatMovement(row.movement, row.rank, row.previousRank)}</td>
            <td className="py-1 pr-3">{row.participant.name}</td>
            <td className="py-1 pr-3">
              {row.roundWins} {medalSymbols(row.roundWins)}
            </td>
            <td className="py-1">{row.totalPoints}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
