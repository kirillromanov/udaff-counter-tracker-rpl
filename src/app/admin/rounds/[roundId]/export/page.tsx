import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { exportAudit, parseBreakdown } from "@/lib/domain/export/export-audit";
import { exportRoundStandings } from "@/lib/domain/export/export-round-standings";
import { exportSeasonStandings } from "@/lib/domain/export/export-season-standings";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { CopyButton } from "../../../copy-button";

export const instant = false;

export default async function ExportPage({ params }: { params: Promise<{ roundId: string }> }) {
  await connection();
  const { roundId } = await params;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: { roundScores: { include: { participant: true } } },
  });
  if (!round) {
    notFound();
  }

  const roundText = exportRoundStandings(
    round.roundScores.map((score) => ({
      name: score.participant.name,
      matchPoints: score.matchPoints,
      roundBonus: score.roundBonusPoints,
      totalPoints: score.totalPoints,
      isWinner: score.isRoundWinner,
    })),
  );
  const snapshot = await latestSeasonSnapshot(round.seasonId);
  const seasonText = exportSeasonStandings(
    (snapshot?.standingSnapshots ?? []).map((row) => ({
      rank: row.rank,
      name: row.participant.name,
      totalPoints: row.totalPoints,
      medals: row.roundWins,
      movement: row.movement,
      previousRank: row.previousRank,
    })),
  );
  const auditText = exportAudit(
    round.roundScores.flatMap((score) => {
      const breakdown = parseBreakdown(score.breakdownJson);
      return breakdown ? [{ name: score.participant.name, isWinner: score.isRoundWinner, breakdown }] : [];
    }),
  );

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-sm">
        <Link className="underline" href={`/admin/rounds/${round.id}`}>
          {round.number}. {round.name ?? "Round"}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Export</h1>
      <p className="mt-2 text-neutral-600">Plain text for a forum post. Copy a block and paste it as-is.</p>
      {round.roundScores.length === 0 ? (
        <p className="mt-4 text-neutral-600">Calculate this round before exporting its table.</p>
      ) : (
        <>
          <ExportBlock title="Round standings" text={roundText} />
          <ExportBlock title="Audit" text={auditText} />
        </>
      )}
      {snapshot ? (
        <ExportBlock title={`Season standings after ${snapshot.name ?? `round ${snapshot.number}`}`} text={seasonText} />
      ) : (
        <p className="mt-6 text-neutral-600">The season table appears after the first calculation.</p>
      )}
    </main>
  );
}

function ExportBlock({ title, text }: { title: string; text: string }) {
  return (
    <section className="mt-6">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">{title}</h2>
        <CopyButton text={text} />
      </div>
      <pre className="mt-3 overflow-auto whitespace-pre bg-neutral-50 p-3 font-mono text-sm">{text}</pre>
    </section>
  );
}
