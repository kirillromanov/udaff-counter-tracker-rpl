import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { roundLayerLabel } from "@/lib/domain/review/operator-status";
import { ARCHIVED_ROUND, standingRoleLabel } from "@/lib/domain/standings/round-role";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { SeasonLayers } from "../../layers";
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
  const [snapshot, checkpoint] = await Promise.all([
    latestSeasonSnapshot(season.id),
    prisma.standingsCheckpoint.findFirst({
      where: { seasonId: season.id, source: "manual" },
      orderBy: { afterRoundNumber: "desc" },
      include: { rows: { orderBy: { rank: "asc" }, take: 1 } },
    }),
  ]);
  const nextNumber = (season.rounds.at(-1)?.number ?? 0) + 1;
  const productionRounds = season.rounds.filter((round) => round.standingRole !== ARCHIVED_ROUND);
  const archivedRounds = season.rounds.filter((round) => round.standingRole === ARCHIVED_ROUND);
  const scoredRounds = productionRounds.filter((round) => round._count.roundScores > 0).length;
  const leader = snapshot?.standingSnapshots[0];
  const baselineLeader = checkpoint?.rows[0];
  const [activeRoster, acceptedGroups, flaggedGroups] = await Promise.all([
    prisma.seasonParticipant.count({
      where: { seasonId: season.id, status: "included", participant: { archivedAt: null } },
    }),
    prisma.predictionSet.groupBy({
      by: ["roundId"],
      where: { status: "accepted", selected: true, round: { seasonId: season.id } },
      _count: { _all: true },
    }),
    prisma.predictionSet.groupBy({
      by: ["roundId"],
      where: { status: "flagged", round: { seasonId: season.id } },
      _count: { _all: true },
    }),
  ]);
  const acceptedByRound = new Map(acceptedGroups.map((group) => [group.roundId, group._count._all]));
  const flaggedByRound = new Map(flaggedGroups.map((group) => [group.roundId, group._count._all]));

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
        description="Production standings start from the trusted baseline. Rounds through that baseline are archived reference data. Later rounds are added on top."
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
        <SeasonLayers seasonId={season.id} />
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.imported ? <Notice tone="success">{query.imported}</Notice> : null}
        <KpiGrid
          items={[
            { label: "Production rounds", value: productionRounds.length, hint: `${archivedRounds.length} archived` },
            { label: "Scored", value: scoredRounds, hint: "Production rounds with a stored total" },
            { label: "On roster", value: activeRoster, hint: `${season._count.participants} roster rows` },
            {
              label: "Leader",
              value: leader ? leader.totalPoints : baselineLeader ? baselineLeader.totalPoints : "—",
              hint: leader
                ? leader.participant.name
                : baselineLeader
                  ? `${baselineLeader.displayName} · trusted baseline`
                  : "Add a baseline",
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
              ? `Trusted baseline plus finalized production rounds through ${snapshot.name ?? `round ${snapshot.number}`}.`
              : checkpoint
                ? `Trusted baseline after round ${checkpoint.afterRoundNumber}. Archived reference rounds are not added again.`
                : "Add a trusted baseline, then calculate production rounds from the next round onward."
          }
          id="standings"
          title="Production standings"
        >
          {snapshot ? (
            <StandingsTable rows={snapshot.standingSnapshots} />
          ) : (
            <EmptyState
              detail={
                checkpoint
                  ? `${baselineLeader?.displayName ?? "The leader"} has ${baselineLeader?.totalPoints ?? 0} on the trusted baseline. Open Standings for the full table.`
                  : "Save the manual checkpoint, then calculate a production round."
              }
              title={checkpoint ? "Baseline is the current total" : "No production table yet"}
            />
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
          description="Production rounds are added to the trusted baseline. Archived rounds stay available for parser and source checks."
          id="rounds"
          title="Rounds"
        >
          {season.rounds.length === 0 ? (
            <EmptyState detail="Create the first round with the form above." title="No rounds yet" />
          ) : (
            <div className="space-y-6">
              <RoundGroup
                acceptedByRound={acceptedByRound}
                flaggedByRound={flaggedByRound}
                rounds={productionRounds}
                title="Production"
              />
              <RoundGroup
                acceptedByRound={acceptedByRound}
                flaggedByRound={flaggedByRound}
                rounds={archivedRounds}
                title="Archived reference"
              />
            </div>
          )}
        </Section>
      </PageBody>
    </>
  );
}

function RoundGroup({
  title,
  rounds,
  acceptedByRound,
  flaggedByRound,
}: {
  title: string;
  rounds: {
    id: string;
    number: number;
    name: string | null;
    status: string;
    standingRole: string;
    _count: { roundScores: number; matches: number };
  }[];
  acceptedByRound: Map<string, number>;
  flaggedByRound: Map<string, number>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">{title}</h3>
      {rounds.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {title === "Production"
            ? "Create round 12 or later. Its finalized total is added on top of the trusted baseline."
            : "No archived reference rounds."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs tracking-wide text-zinc-500 uppercase">
                <th className="py-2 pr-3 font-medium">Round</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Layer</th>
                <th className="py-2 pr-3 font-medium">Fixtures</th>
                <th className="py-2 pr-3 font-medium">Accepted</th>
                <th className="py-2 pr-3 font-medium">Flagged</th>
                <th className="py-2 font-medium">Review</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((round) => {
                const layer = roundLayerLabel(round.status, round._count.roundScores, round.standingRole);
                const flagged = flaggedByRound.get(round.id) ?? 0;
                return (
                  <tr className="border-b border-zinc-100 last:border-0" key={round.id}>
                    <td className="py-2.5 pr-3">
                      <Link className="font-medium hover:underline" href={`/admin/rounds/${round.id}`} prefetch={false}>
                        {round.number}. {round.name ?? "Round"}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={round.standingRole === ARCHIVED_ROUND ? "neutral" : "info"}>{standingRoleLabel(round.standingRole)}</Badge>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={layer === "Confirmed round" || layer === "Reference total" ? "info" : layer === "Imported raw" ? "warning" : "neutral"}>{layer}</Badge>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-zinc-600">{round._count.matches}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{acceptedByRound.get(round.id) ?? 0}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{flagged > 0 ? <Badge tone="warning">{flagged}</Badge> : "0"}</td>
                    <td className="py-2.5">
                      <Link className="text-zinc-700 hover:underline" href={`/admin/rounds/${round.id}/review`} prefetch={false}>
                        Parser review
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
