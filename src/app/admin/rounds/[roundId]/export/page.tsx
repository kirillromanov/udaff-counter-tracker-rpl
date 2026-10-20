import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { exportAudit, parseBreakdown } from "@/lib/domain/export/export-audit";
import { exportRoundStandings } from "@/lib/domain/export/export-round-standings";
import { exportSeasonStandings } from "@/lib/domain/export/export-season-standings";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { CopyButton } from "../../../copy-button";
import { CrumbLink, EmptyState, PageBody, PageHeader, Section } from "../../../ui";
import { RoundNav } from "../../../round-nav";

export const instant = false;

function ExportBlock({ title, description, text }: { title: string; description: string; text: string }) {
  return (
    <Section action={<CopyButton text={text} />} description={description} title={title}>
      <pre className="overflow-auto rounded-lg bg-zinc-50 p-4 font-mono text-sm whitespace-pre text-zinc-800">{text}</pre>
    </Section>
  );
}

export default async function ExportPage({ params }: { params: Promise<{ roundId: string }> }) {
  await connection();
  const { roundId } = await params;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: { season: true, roundScores: { include: { participant: true } } },
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
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/seasons/${round.seasonId}`}>{round.season.name}</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/rounds/${round.id}`}>
              {round.number}. {round.name ?? "Round"}
            </CrumbLink>
          </>
        }
        description="Plain text for a forum post. Copy a block and paste it as-is."
        nav={<RoundNav roundId={round.id} seasonId={round.seasonId} />}
        title="Export"
      />
      <PageBody>
        {round.roundScores.length === 0 ? (
          <Section id="results" title="Round results">
            <EmptyState detail="Calculate this round before exporting its table." title="Nothing to export yet" />
          </Section>
        ) : (
          <>
            <ExportBlock description="Match points, the round-goals bonus, and the winner line." text={roundText} title="Round standings" />
            <ExportBlock description="Per-match categories, bonuses, and the Match of the Round multiplier." text={auditText} title="Audit" />
          </>
        )}
        {snapshot ? (
          <ExportBlock
            description={`After ${snapshot.name ?? `round ${snapshot.number}`}.`}
            text={seasonText}
            title="Season standings"
          />
        ) : (
          <Section id="standings" title="Season standings">
            <EmptyState detail="The season table appears after the first calculation." title="No season table yet" />
          </Section>
        )}
      </PageBody>
    </>
  );
}
