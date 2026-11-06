import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { exportAudit, parseBreakdown } from "@/lib/domain/export/export-audit";
import { exportRoundStandings, intermediateRoundHeading, STALE_EXPORT_HEADING } from "@/lib/domain/export/export-round-standings";
import { classifyIntermediateFixture, exclusionLabel, isFixtureExclusion, ROUND_STATUS_STALE } from "@/lib/domain/standings/intermediate";
import { exportSeasonStandings } from "@/lib/domain/export/export-season-standings";
import { confirmedCutoffLabel } from "@/lib/domain/standings/clean-season";
import { loadCleanSeason } from "@/lib/domain/standings/load-clean-season";
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
    include: {
      season: true,
      roundScores: { include: { participant: true } },
      matches: { orderBy: { sortOrder: "asc" }, include: { resultObservations: { select: { matchStatus: true } } } },
    },
  });
  if (!round) {
    notFound();
  }

  const classified = round.matches.map((match) => ({
    label: `${match.homeTeam} — ${match.awayTeam}`,
    klass: classifyIntermediateFixture({
      matchId: match.id,
      label: `${match.homeTeam} — ${match.awayTeam}`,
      actualHomeGoals: match.actualHomeGoals,
      actualAwayGoals: match.actualAwayGoals,
      resultState: match.resultState,
      resultResolution: match.resultResolution,
      resultConflict: match.resultConflict,
      isMatchOfTheRound: match.isMatchOfTheRound,
      observationStatuses: match.resultObservations.map((observation) => observation.matchStatus),
    }),
  }));
  const includedCount = classified.filter((fixture) => fixture.klass === "included").length;
  const stale = round.status === ROUND_STATUS_STALE;
  const partial = round.status === "partial" && !stale;
  const calculatedAt = round.roundScores.reduce<Date | null>(
    (latest, score) => (!latest || score.calculatedAt > latest ? score.calculatedAt : latest),
    null,
  );
  const roundText = exportRoundStandings(
    round.roundScores.map((score) => ({
      name: score.participant.name,
      matchPoints: score.matchPoints,
      roundBonus: score.roundBonusPoints,
      totalPoints: score.totalPoints,
      isWinner: score.isRoundWinner && !partial && !stale,
    })),
    partial
      ? { heading: intermediateRoundHeading(round.number, includedCount, round.matches.length) }
      : stale
        ? { heading: STALE_EXPORT_HEADING }
        : undefined,
  );
  const excluded = classified.filter((fixture) => fixture.klass !== "included");
  const clean = await loadCleanSeason(round.seasonId);
  const seasonText = exportSeasonStandings(
    (clean?.rows ?? []).map((row) => ({
      rank: row.rank,
      name: row.name,
      totalPoints: row.totalPoints,
      medals: row.medals,
      movement: row.movement,
      previousRank: row.previousRank,
    })),
  );
  const liveText = clean?.liveRows
    ? exportSeasonStandings(
        clean.liveRows.map((row) => ({
          rank: row.rank,
          name: row.name,
          totalPoints: row.totalPoints,
          medals: row.medals,
          movement: row.movement,
          previousRank: row.previousRank,
        })),
      )
    : null;
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
            <EmptyState
              detail={excluded.length > 0 ? excluded.flatMap((fixture) => (isFixtureExclusion(fixture.klass) ? [`${fixture.label} (${exclusionLabel(fixture.klass)})`] : [])).join("; ") : "Verified finished matches will appear here after a calculation."}
              title="Пока нет подтверждённых завершённых матчей"
            />
          </Section>
        ) : (
          <>
            <ExportBlock
              description={
                stale
                  ? "This stored table is stale and is not the current result."
                  : partial
                    ? `${intermediateRoundHeading(round.number, includedCount, round.matches.length)}${calculatedAt ? ` · ${calculatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}. Verified finished matches only. The round bonus is pending.`
                    : "Final round table. Match points, the round-goals bonus, and the winner line."
              }
              text={roundText}
              title={partial || stale ? "Round results" : "Round standings"}
            />
            {excluded.length > 0 ? (
              <p className="text-sm text-zinc-600">
                Не включены: {excluded.flatMap((fixture) => (isFixtureExclusion(fixture.klass) ? [`${fixture.label} (${exclusionLabel(fixture.klass)})`] : [])).join("; ")}
              </p>
            ) : null}
            <ExportBlock description="Per-match categories, bonuses, and the Match of the Round multiplier." text={auditText} title="Audit" />
          </>
        )}
        {clean && clean.rows.length > 0 ? (
          <>
            <ExportBlock
              description={`${confirmedCutoffLabel(clean)} Confirmed totals only.`}
              text={seasonText}
              title="Season standings"
            />
            {liveText ? (
              <ExportBlock
                description="Provisional. This includes the open round and is separate from the confirmed export."
                text={liveText}
                title="Provisional live standings"
              />
            ) : null}
          </>
        ) : (
          <Section id="standings" title="Season standings">
            <EmptyState detail="The season table appears after a trusted baseline or a confirmed round." title="No season table yet" />
          </Section>
        )}
      </PageBody>
    </>
  );
}
