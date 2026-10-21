import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { formatMovement } from "@/lib/domain/standings/format-movement";
import { Badge, CrumbLink, EmptyState, Notice, PageBody, PageHeader, Section } from "../../../ui";

export const instant = false;

export default async function CheckpointPage({
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
  const checkpoint = await prisma.standingsCheckpoint.findFirst({
    where: { seasonId: season.id, source: "manual" },
    include: {
      rows: { include: { participant: true }, orderBy: { rank: "asc" } },
    },
    orderBy: { afterRoundNumber: "desc" },
  });
  const unmatched = checkpoint?.rows.filter((row) => !row.participantId) ?? [];

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
        description="A hand-checked forum table. Calculated snapshots stay separate and can be reconciled against this later."
        title="Manual checkpoint"
      />
      <PageBody>
        {!checkpoint ? (
          <Section title="No checkpoint">
            <EmptyState detail="Seed the round 11 table, or save a manual checkpoint for this season." title="Nothing stored yet" />
          </Section>
        ) : (
          <>
            <Notice tone="info">
              {checkpoint.label}. {checkpoint.rows.length} rows, source {checkpoint.source}. ☼ is stored as a marker count
              and lines up with round wins when standings are reconciled.
            </Notice>
            {unmatched.length > 0 ? (
              <Notice tone="warning">
                {unmatched.length} {unmatched.length === 1 ? "name was" : "names were"} not in the registry, so no new
                participant was created: {unmatched.map((row) => row.displayName).join(", ")}.
              </Notice>
            ) : (
              <Notice tone="success">Every row matches a participant already in the registry.</Notice>
            )}
            <Section
              action={
                <span className="flex flex-wrap gap-3 text-sm">
                  <Link className="text-zinc-600 hover:text-zinc-950" href={`/admin/seasons/${season.id}/reconciliation`}>
                    Reconciliation report
                  </Link>
                  <Link className="text-zinc-600 hover:text-zinc-950" href={`/admin/seasons/${season.id}/standings`}>
                    Calculated standings
                  </Link>
                </span>
              }
              description="Later calculated standings for this season are compared by participant on rank, points, movement direction and delta, and marker count against round wins. This table is not an input to scoring."
              title={`After round ${checkpoint.afterRoundNumber}`}
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs tracking-wide text-zinc-500 uppercase">
                      <th className="py-2 pr-3 font-medium">Rank</th>
                      <th className="py-2 pr-3 font-medium">Move</th>
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">Registry</th>
                      <th className="py-2 pr-3 font-medium">☼</th>
                      <th className="py-2 text-right font-medium">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkpoint.rows.map((row) => (
                      <tr className="border-b border-zinc-100 last:border-0" key={row.id}>
                        <td className="py-2.5 pr-3 tabular-nums text-zinc-500">{row.rank}</td>
                        <td className="py-2.5 pr-3">
                          <Badge tone={row.movement === "up" ? "success" : row.movement === "down" ? "danger" : "neutral"}>
                            {formatMovement(row.movement, row.rank, row.previousRank)}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3 font-medium">{row.displayName}</td>
                        <td className="py-2.5 pr-3">
                          {row.participant ? (
                            <Link className="text-zinc-700 hover:underline" href={`/admin/participants/${row.participant.id}`}>
                              {row.participant.name}
                            </Link>
                          ) : (
                            <Badge tone="warning">Unmatched</Badge>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums">{row.markerCount}</td>
                        <td className="py-2.5 text-right font-medium tabular-nums">{row.totalPoints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}
      </PageBody>
    </>
  );
}
