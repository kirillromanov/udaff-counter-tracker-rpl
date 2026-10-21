import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isActiveInSeason, type MembershipState } from "@/lib/domain/participants/roster";
import { createParticipantAction } from "./actions";
import { SubmitButton } from "../submit-button";
import { Badge, CrumbLink, EmptyState, Field, Notice, PageBody, PageHeader, Section, fieldClass } from "../ui";

export const instant = false;

function membershipOf(status: string | undefined): MembershipState {
  if (status === "included" || status === "excluded") {
    return status;
  }
  return "absent";
}

export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; seasonId?: string; archived?: string }>;
}) {
  await connection();
  const query = await searchParams;
  const [participants, seasons] = await Promise.all([
    prisma.participant.findMany({
      include: { aliases: { orderBy: { alias: "asc" } }, seasons: true },
      orderBy: { name: "asc" },
    }),
    prisma.season.findMany({ orderBy: { name: "asc" } }),
  ]);
  const season = seasons.find((item) => item.id === query.seasonId) ?? seasons[0] ?? null;
  const showArchived = query.archived === "1";
  const visible = participants.filter((participant) => showArchived || participant.archivedAt == null);

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <span>Registry</span>
          </>
        }
        description="The registry is the source of truth. A season roster only includes people you mark active."
        title="Participants"
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.saved ? <Notice tone="success">Participant removed from the registry.</Notice> : null}

        <Section description="New people start in the registry. Choose a season to put them on that roster immediately." title="Create participant">
          <form action={createParticipantAction} className="flex flex-wrap items-end gap-2">
            <Field label="Name">
              <input className={`${fieldClass} w-64`} name="name" placeholder="Forum nick" />
            </Field>
            <Field label="Also include in">
              <select className={`${fieldClass} w-56`} defaultValue={season?.id ?? ""} name="seasonId">
                <option value="">Registry only</option>
                {seasons.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton pendingLabel="Creating…" variant="primary">
              Create
            </SubmitButton>
          </form>
        </Section>

        <Section
          action={
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {season ? (
                <Link className="text-zinc-600 hover:text-zinc-950" href={`/admin/seasons/${season.id}/roster`}>
                  Open {season.name} roster
                </Link>
              ) : null}
              <Link
                className="text-zinc-600 hover:text-zinc-950"
                href={showArchived ? "/admin/participants" : "/admin/participants?archived=1"}
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </Link>
            </div>
          }
          description={
            season
              ? `Active means included on ${season.name} and not archived. Excluded people stay on the roster record.`
              : "Create a season before assigning a roster."
          }
          title="Registry"
        >
          {visible.length === 0 ? (
            <EmptyState detail="Create the first participant with the form above." title="No participants to show" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs tracking-wide text-zinc-500 uppercase">
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Aliases</th>
                    <th className="py-2 pr-3 font-medium">Registry</th>
                    <th className="py-2 font-medium">{season ? season.name : "Season"}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((participant) => {
                    const membership = membershipOf(
                      participant.seasons.find((item) => item.seasonId === season?.id)?.status,
                    );
                    const active = season
                      ? isActiveInSeason({ archived: participant.archivedAt != null, membership })
                      : false;
                    const extraAliases = participant.aliases.filter((alias) => !alias.isPrimary);
                    return (
                      <tr className="border-b border-zinc-100 last:border-0" key={participant.id}>
                        <td className="py-2.5 pr-3">
                          <Link className="font-medium hover:underline" href={`/admin/participants/${participant.id}`}>
                            {participant.name}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 text-zinc-600">
                          {extraAliases.length > 0 ? extraAliases.map((alias) => alias.alias).join(", ") : "—"}
                        </td>
                        <td className="py-2.5 pr-3">
                          {participant.archivedAt ? <Badge>Archived</Badge> : <Badge tone="success">Active</Badge>}
                        </td>
                        <td className="py-2.5">
                          {!season ? (
                            <span className="text-zinc-400">—</span>
                          ) : active ? (
                            <Badge tone="success">Active</Badge>
                          ) : membership === "excluded" ? (
                            <Badge tone="warning">Excluded</Badge>
                          ) : (
                            <span className="text-zinc-400">Not on roster</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageBody>
    </>
  );
}
