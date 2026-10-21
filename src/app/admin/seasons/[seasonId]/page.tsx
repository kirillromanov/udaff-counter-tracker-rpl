import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { createRoundAction, importRoundsAction } from "../../actions";
import { SubmitButton } from "../../submit-button";
import {
  Badge,
  CrumbLink,
  EmptyState,
  Field,
  KpiGrid,
  Notice,
  PageBody,
  PageHeader,
  Section,
  StandingsTable,
  StatusBadge,
  buttonClass,
  fieldClass,
} from "../../ui";

export const instant = false;
export const maxDuration = 300;

export default async function SeasonPage({
  params,
  searchParams,
}: {
  params: Promise<{ seasonId: string }>;
  searchParams: Promise<{ error?: string; imported?: string }>;
}) {
  await connection();
  const { seasonId } = await params;
  const query = await searchParams;
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: {
      _count: { select: { participants: true } },
      rounds: { orderBy: { number: "asc" }, include: { _count: { select: { roundScores: true, matches: true } } } },
    },
  });
  if (!season) {
    notFound();
  }
  const snapshot = await latestSeasonSnapshot(season.id);
  const nextNumber = (season.rounds.at(-1)?.number ?? 0) + 1;
  const scoredRounds = season.rounds.filter((round) => round._count.roundScores > 0).length;
  const leader = snapshot?.standingSnapshots[0];
  const activeRoster = await prisma.seasonParticipant.count({
    where: { seasonId: season.id, status: "included", participant: { archivedAt: null } },
  });

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <span>{season.name}</span>
          </>
        }
        description="Rounds, the season roster, and the latest cumulative table."
        nav={
          <div className="flex flex-wrap gap-2">
            <Link className={buttonClass("secondary")} href={`/admin/seasons/${season.id}/roster`}>
              Roster
            </Link>
            <Link className={buttonClass("secondary")} href={`/admin/seasons/${season.id}/standings`}>
              Standings
            </Link>
            <Link className={buttonClass("secondary")} href={`/admin/seasons/${season.id}/checkpoint`}>
              Round 11 checkpoint
            </Link>
            <Link className={buttonClass("secondary")} href={`/admin/seasons/${season.id}/reconciliation`}>
              Reconcile
            </Link>
            <form action={importRoundsAction}>
              <input name="seasonId" type="hidden" value={season.id} />
              <SubmitButton pendingLabel="Importing…" variant="primary">
                Import rounds 1–11
              </SubmitButton>
            </form>
          </div>
        }
        title={season.name}
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.imported ? <Notice tone="success">{query.imported}</Notice> : null}
        <KpiGrid
          items={[
            { label: "Rounds", value: season.rounds.length },
            { label: "Scored", value: scoredRounds, hint: "Rounds with a calculation" },
            { label: "On roster", value: activeRoster, hint: `${season._count.participants} roster rows` },
            {
              label: "Leader",
              value: leader ? leader.totalPoints : "—",
              hint: leader ? leader.participant.name : "Calculate a round",
            },
          ]}
        />

        <Section
          action={
            <Link className={buttonClass("secondary")} href={`/admin/seasons/${season.id}/standings`}>
              Full table
            </Link>
          }
          description={
            snapshot
              ? `After ${snapshot.name ?? `round ${snapshot.number}`}. Changed places are tinted.`
              : "The table appears after the first calculation."
          }
          id="standings"
          title="Season standings"
        >
          {snapshot ? (
            <StandingsTable rows={snapshot.standingSnapshots} />
          ) : (
            <EmptyState detail="Enter results on a round and calculate it." title="No cumulative table yet" />
          )}
        </Section>

        <Section
          action={
            <form action={createRoundAction} className="flex flex-wrap items-end gap-2">
              <input name="seasonId" type="hidden" value={season.id} />
              <Field label="Number">
                <input className={`${fieldClass} w-24`} defaultValue={nextNumber} name="number" type="number" />
              </Field>
              <Field label="Name">
                <input className={`${fieldClass} w-44`} name="name" placeholder="Optional" />
              </Field>
              <SubmitButton pendingLabel="Creating…" variant="primary">
                Create round
              </SubmitButton>
            </form>
          }
          description="Open a round for fixtures, import, and results."
          id="rounds"
          title="Rounds"
        >
          {season.rounds.length === 0 ? (
            <EmptyState detail="Create the first round with the form above." title="No rounds yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs tracking-wide text-zinc-500 uppercase">
                    <th className="py-2 pr-3 font-medium">Round</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Fixtures</th>
                    <th className="py-2 font-medium">Scored</th>
                  </tr>
                </thead>
                <tbody>
                  {season.rounds.map((round) => (
                    <tr className="border-b border-zinc-100 last:border-0" key={round.id}>
                      <td className="py-2.5 pr-3">
                        <Link className="font-medium hover:underline" href={`/admin/rounds/${round.id}`}>
                          {round.number}. {round.name ?? "Round"}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={round.status} />
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-zinc-600">{round._count.matches}</td>
                      <td className="py-2.5 text-zinc-600">
                        {round._count.roundScores > 0 ? (
                          <Badge tone="success">{round._count.roundScores} participants</Badge>
                        ) : (
                          <span className="text-zinc-400">Not calculated</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageBody>
    </>
  );
}
