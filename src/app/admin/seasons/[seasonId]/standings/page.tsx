import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { exportSeasonStandings } from "@/lib/domain/export/export-season-standings";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { CopyButton } from "../../../copy-button";
import { CrumbLink, EmptyState, Notice, PageBody, PageHeader, Section, StandingsTable, buttonClass } from "../../../ui";

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
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/seasons/${season.id}`}>{season.name}</CrumbLink>
          </>
        }
        description="Movement compares this table with the ranking before the latest scored round. Up, down, and new rows are tinted."
        nav={
          snapshot ? (
            <Link className={buttonClass("secondary")} href={`/admin/rounds/${snapshot.id}`}>
              Open {snapshot.name ?? `round ${snapshot.number}`}
            </Link>
          ) : null
        }
        title="Season standings"
      />
      <PageBody>
        {!snapshot ? (
          <Section id="standings" title="Season standings">
            <EmptyState detail="Calculate a round to build the cumulative table." title="No standings yet" />
          </Section>
        ) : (
          <>
            <Notice tone="info">After {snapshot.name ?? `round ${snapshot.number}`}.</Notice>
            <Section id="standings" title="Table">
              <StandingsTable rows={rows} />
            </Section>
            <Section
              action={<CopyButton text={text} />}
              description="Plain text for the forum. Copy it and paste it as-is."
              title="Forum text"
            >
              <pre className="overflow-auto rounded-lg bg-zinc-50 p-4 font-mono text-sm whitespace-pre text-zinc-800">{text}</pre>
            </Section>
          </>
        )}
      </PageBody>
    </>
  );
}
