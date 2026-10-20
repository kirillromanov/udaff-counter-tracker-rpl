import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { parseBreakdown } from "@/lib/domain/export/export-audit";

export const instant = false;

export default async function RoundResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ calculated?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      roundScores: { include: { participant: true } },
    },
  });
  if (!round) {
    notFound();
  }

  const scores = [...round.roundScores].sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    return left.participant.name.localeCompare(right.participant.name, "ru");
  });

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-sm">
        <Link className="underline" href={`/admin/rounds/${round.id}`}>
          {round.number}. {round.name ?? "Round"}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Round standings</h1>
      {query.calculated ? (
        <p className="mt-4 border border-green-300 bg-green-50 p-3">Calculated {query.calculated} participants.</p>
      ) : null}
      {scores.length === 0 ? (
        <p className="mt-4 text-neutral-600">Enter results and calculate this round.</p>
      ) : (
        <>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1 pr-3">Rank</th>
                <th className="py-1 pr-3">Participant</th>
                <th className="py-1 pr-3">Points</th>
                <th className="py-1 pr-3">Match + bonus</th>
                <th className="py-1">Medal</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((score, index) => (
                <tr className="border-b" key={score.id}>
                  <td className="py-1 pr-3">{index + 1}</td>
                  <td className="py-1 pr-3">{score.participant.name}</td>
                  <td className="py-1 pr-3">{score.totalPoints}</td>
                  <td className="py-1 pr-3">
                    {score.matchPoints}+ {score.roundBonusPoints}
                  </td>
                  <td className="py-1">{score.isRoundWinner ? "☼ winner" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 space-y-6">
            {scores.map((score) => {
              const breakdown = parseBreakdown(score.breakdownJson);
              return (
                <section className="border p-4" key={`${score.id}-detail`}>
                  <h2 className="font-semibold">
                    {score.participant.name}
                    {score.isRoundWinner ? " — round winner" : ""} — {score.totalPoints}
                  </h2>
                  {!breakdown ? (
                    <p className="mt-2 text-sm text-neutral-600">No breakdown stored.</p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm">
                      {breakdown.matches.map((match) => (
                        <li key={match.label}>
                          <span className="font-medium">{match.label}</span> pred {match.predicted} actual {match.actual}{" "}
                          {match.baseCategory} {match.basePoints}
                          {match.bonusPoints ? ` +${match.bonusPoints}` : ""}
                          {match.mtApplied ? ` x${match.mtMultiplier}` : ""} = {match.finalMatchPoints}
                          <span className="block text-neutral-600">{match.explanations.join(" · ")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-sm">
                    Round total-goals bonus: {score.roundBonusPoints}. Exact {score.exactCount}, neighbor {score.neighborCount},
                    diff {score.diffCount}, outcome {score.outcomeCount}, miss {score.missCount}.
                  </p>
                </section>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
