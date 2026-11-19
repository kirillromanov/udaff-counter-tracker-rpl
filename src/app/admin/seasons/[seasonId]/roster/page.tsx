import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isActiveInSeason, type MembershipState } from "@/lib/domain/participants/roster";
import { rosterAction } from "../../../participants/actions";
import { SubmitButton } from "../../../submit-button";
import { Badge, CrumbLink, EmptyState, Notice, PageBody, PageHeader, Section } from "../../../ui";

export const instant = false;

function membershipOf(status: string | undefined): MembershipState {
  if (status === "included" || status === "excluded") {
    return status;
  }
  return "absent";
}

export default async function SeasonRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ seasonId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await connection();
  const { seasonId } = await params;
  const query = await searchParams;
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { participants: true },
  });
  if (!season) {
    notFound();
  }
  const participants = await prisma.participant.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
  });
  const membershipByParticipant = new Map(season.participants.map((membership) => [membership.participantId, membership.status]));
  const here = `/admin/seasons/${season.id}/roster`;
  const activeCount = participants.filter((participant) =>
    isActiveInSeason({
      archived: false,
      membership: membershipOf(membershipByParticipant.get(participant.id)),
    }),
  ).length;

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
        description={`${activeCount} active on this roster. Excluding someone leaves their past scores in place.`}
        title="Season roster"
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.saved ? <Notice tone="success">Roster updated.</Notice> : null}
        <Section
          action={
            <Link className="text-sm text-zinc-600 hover:text-zinc-950" href="/admin/participants">
              Registry
            </Link>
          }
          description="People archived in the registry are hidden here. Restore them before including them again."
          title={season.name}
        >
          {participants.length === 0 ? (
            <EmptyState detail="Add people from the participant registry." title="No one in the registry" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {participants.map((participant) => {
                const membership = membershipOf(membershipByParticipant.get(participant.id));
                const active = isActiveInSeason({ archived: false, membership });
                return (
                  <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={participant.id}>
                    <div>
                      <Link className="font-medium hover:underline" href={`/admin/participants/${participant.id}`}>
                        {participant.name}
                      </Link>
                      <div className="mt-1">
                        {active ? (
                          <Badge tone="success">Active</Badge>
                        ) : membership === "excluded" ? (
                          <Badge tone="warning">Excluded</Badge>
                        ) : (
                          <Badge>Not on roster</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {membership !== "included" ? (
                        <form action={rosterAction}>
                          <input name="participantId" type="hidden" value={participant.id} />
                          <input name="seasonId" type="hidden" value={season.id} />
                          <input name="roster" type="hidden" value="include" />
                          <input name="returnTo" type="hidden" value={here} />
                          <SubmitButton pendingLabel="Saving…" variant="primary">
                            Include
                          </SubmitButton>
                        </form>
                      ) : (
                        <form action={rosterAction}>
                          <input name="participantId" type="hidden" value={participant.id} />
                          <input name="seasonId" type="hidden" value={season.id} />
                          <input name="roster" type="hidden" value="exclude" />
                          <input name="returnTo" type="hidden" value={here} />
                          <SubmitButton pendingLabel="Saving…">Exclude</SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </PageBody>
    </>
  );
}
