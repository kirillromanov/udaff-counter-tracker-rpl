import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { formatMovement, medalSymbols } from "@/lib/domain/standings/format-movement";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { exportSeasonStandings } from "@/lib/domain/export/export-season-standings";
import { CopyButton } from "../../../copy-button";

export const instant = false;

export default async function SeasonStandingsPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  await connection();
  const { seasonId } = await params;
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) {
    notFound();
  }
  const snapshot = await latestSeasonSnapshot(season.id);
  const rows = snapshot?.standingSnapshots ?? [];
  const text = exportSeasonStandings(
    rows.map((row) => ({
      rank: row.rank,
      name: row.participant.name,
      totalPoints: row.totalPoints,
      medals: row.roundWins,
      movement: row.movement,
      previousRank: row.previousRank,
    })),
  );

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-sm">
        <Link className="underline" href={`/admin/seasons/${season.id}`}>
          {season.name}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Season standings</h1>
      {!snapshot ? (
        <p className="mt-4 text-neutral-600">Calculate a round to build the cumulative table.</p>
      ) : (
        <>
          <p className="mt-2 text-neutral-600">
            After {snapshot.name ?? `round ${snapshot.number}`}. Movement compares this table with the ranking before that round.
          </p>
          <table className="mt-4 w-full border-collapse text-sm">
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
          <section className="mt-6">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">Forum text</h2>
              <CopyButton text={text} />
            </div>
            <pre className="mt-3 overflow-auto whitespace-pre bg-neutral-50 p-3 font-mono text-sm">{text}</pre>
          </section>
        </>
      )}
    </main>
  );
}
