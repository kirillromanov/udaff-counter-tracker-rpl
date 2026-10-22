import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { exportSeasonStandings } from "@/lib/domain/export/export-season-standings";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { loadLiveSeason } from "@/lib/domain/standings/load-live";
import { SeasonLayers } from "../../../layers";
import { CopyButton } from "../../../copy-button";
import { CrumbLink, DataTable, EmptyState, MovementCell, Notice, PageBody, PageHeader, Section, StandingsTable, Th, buttonClass } from "../../../ui";

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
  const [snapshot, live] = await Promise.all([latestSeasonSnapshot(season.id), loadLiveSeason(season.id)]);
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
        description="The trusted baseline stays unchanged. Confirmed rounds after it are added separately from the current live delta."
        nav={
          snapshot ? (
            <Link className={buttonClass("secondary")} href={`/admin/rounds/${snapshot.id}`}>
              Open {snapshot.name ?? `round ${snapshot.number}`}
            </Link>
          ) : null
        }
        title="Computed standings"
      />
      <PageBody>
        <SeasonLayers current="computed" seasonId={season.id} />
        <Section
          description={
            live.baselineLabel
              ? `${live.baselineLabel}. Rounds through ${live.baselineAfterRound} stay inside that baseline and are not added again.`
              : "No trusted baseline is stored, so the confirmed total starts at zero."
          }
          id="live-season"
          title="Provisional season"
        >
          {live.baselineOpenRounds.length > 0 ? (
            <p className="mb-3 text-sm text-zinc-600">
              {live.baselineOpenRounds.map((round, index) => (
                <span key={round.id}>
                  {index > 0 ? ", " : null}
                  <Link className="font-medium text-zinc-900 underline" href={`/admin/rounds/${round.id}/results`}>
                    {round.name ?? `Round ${round.number}`}
                  </Link>
                </span>
              ))}{" "}
              {live.baselineOpenRounds.length === 1 ? "is" : "are"} still in progress. The live table stays on the round page. Those points are not added on top of the trusted baseline.
            </p>
          ) : null}
          {live.unverifiedRounds.length > 0 ? (
            <p className="mb-3 text-sm text-zinc-600">
              Live delta is from {live.unverifiedRounds.map((round) => round.name ?? `round ${round.number}`).join(", ")}. It includes verified and provisional match points from those rounds and is not part of the confirmed total.
            </p>
          ) : live.baselineOpenRounds.length === 0 ? (
            <p className="mb-3 text-sm text-zinc-600">No unfinished round is adding a live delta. The live total matches the confirmed total.</p>
          ) : null}
          {live.verifiedUnstored.length > 0 ? (
            <p className="mb-3 text-sm text-zinc-600">
              {live.verifiedUnstored.map((round) => round.name ?? `Round ${round.number}`).join(", ")} {live.verifiedUnstored.length === 1 ? "is" : "are"} verified and not in the confirmed total until you calculate {live.verifiedUnstored.length === 1 ? "it" : "them"}.
            </p>
          ) : null}
          {live.rows.length === 0 ? (
            <EmptyState detail="Add a baseline or calculate a verified round." title="No season rows" />
          ) : (
            <DataTable>
              <thead>
                <tr className="border-b border-zinc-200">
                  <Th>Live rank</Th>
                  <Th>Move</Th>
                  <Th>Participant</Th>
                  <Th className="text-right">Baseline</Th>
                  <Th className="text-right">Confirmed rounds</Th>
                  <Th className="text-right">Confirmed total</Th>
                  <Th className="text-right">Live delta</Th>
                  <Th className="text-right">Live total</Th>
                </tr>
              </thead>
              <tbody>
                {live.rows.map((row) => (
                  <tr className="border-b border-zinc-100 last:border-0" key={row.participantId}>
                    <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.liveRank}</td>
                    <td className="px-3 py-2.5">
                      <MovementCell movement={row.movement} previousRank={row.confirmedRank} rank={row.liveRank} />
                    </td>
                    <td className="px-3 py-2.5 font-medium">{row.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.baselinePoints}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.confirmedRoundPoints}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.confirmedTotal}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.liveDelta}</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">{row.liveTotal}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
        {!snapshot ? (
          <Section id="standings" title="Stored confirmed calculation">
            <EmptyState detail="Enter actual scores and calculate a round. The manual baseline stays on its own screen." title="No computed table yet" />
          </Section>
        ) : (
          <>
            <Notice label="Stored confirmed calculation" tone="info">
              After {snapshot.name ?? `round ${snapshot.number}`}. Compare this table with the trusted baseline on the reconciliation screen.
            </Notice>
            <Section id="stored" title="Stored table">
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
