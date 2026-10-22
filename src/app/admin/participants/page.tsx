import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isActiveInSeason, type MembershipState } from "@/lib/domain/participants/roster";
import { createParticipantAction, stopIgnoringAuthorAction } from "./actions";
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
  searchParams: Promise<{ error?: string; saved?: string; ignored?: string; seasonId?: string; archived?: string; q?: string }>;
}) {
  await connection();
  const query = await searchParams;
  const search = (query.q ?? "").trim().toLocaleLowerCase("ru");
  const [participants, seasons, ignoredAuthors] = await Promise.all([
    prisma.participant.findMany({
      include: { aliases: { orderBy: { alias: "asc" } }, seasons: true },
      orderBy: { name: "asc" },
    }),
    prisma.season.findMany({ orderBy: { name: "asc" } }),
    prisma.ignoredForumAuthor.findMany({ orderBy: { name: "asc" } }),
  ]);
  const season = seasons.find((item) => item.id === query.seasonId) ?? seasons[0] ?? null;
  const showArchived = query.archived === "1";
  const visible = participants.filter((participant) => {
    if (!showArchived && participant.archivedAt != null) {
      return false;
    }
    if (!search) {
      return true;
    }
    const aliases = participant.aliases.map((alias) => alias.alias.toLocaleLowerCase("ru")).join(" ");
    return participant.name.toLocaleLowerCase("ru").includes(search) || aliases.includes(search);
  });

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
        {query.ignored ? <Notice tone="success">Stopped ignoring that forum user. Their comments were parsed again.</Notice> : null}

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
          description="These forum accounts stay in the thread and are skipped during prediction import."
          title="Ignored users"
        >
          {ignoredAuthors.length === 0 ? (
            <EmptyState title="No ignored users" />
          ) : (
            <ul className="space-y-2">
              {ignoredAuthors.map((author) => (
                <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={author.id}>
                  <span>
                    <span className="font-medium">{author.name}</span>
                    {author.note ? <span className="ml-2 text-zinc-500">{author.note}</span> : null}
                  </span>
                  <form action={stopIgnoringAuthorAction}>
                    <input name="authorName" type="hidden" value={author.name} />
                    <SubmitButton pendingLabel="Updating…">Stop ignoring</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          action={
            <form className="flex flex-wrap items-center gap-2" method="get">
              {query.seasonId ? <input name="seasonId" type="hidden" value={query.seasonId} /> : null}
              {showArchived ? <input name="archived" type="hidden" value="1" /> : null}
              <input
                aria-label="Search participants"
                className={`${fieldClass} w-48`}
                defaultValue={query.q ?? ""}
                name="q"
                placeholder="Name or alias"
              />
              <button className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-800" type="submit">
                Search
              </button>
              {season ? (
                <Link className="text-sm text-zinc-600 hover:text-zinc-950" href={`/admin/seasons/${season.id}/roster`}>
                  Roster
                </Link>
              ) : null}
              <Link
                className="text-sm text-zinc-600 hover:text-zinc-950"
                href={showArchived ? "/admin/participants" : "/admin/participants?archived=1"}
              >
                {showArchived ? "Hide archived participants" : "Show archived participants"}
              </Link>
            </form>
          }
          description={
            season
              ? `Active means included on ${season.name} and not archived. Excluded people stay on the roster record.`
              : "Create a season before assigning a roster."
          }
          title="Registry"
        >
          {visible.length === 0 ? (
            <EmptyState
              detail={search ? "Try another nick or alias." : "Create the first participant with the form above."}
              title={search ? "No names match" : "No participants to show"}
            />
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
                          {extraAliases.length > 0 ? (
                            <span className="inline-flex flex-wrap items-center gap-1">
                              <Badge tone="info">Alias</Badge>
                              {extraAliases.map((alias) => alias.alias).join(", ")}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          {participant.archivedAt ? <Badge>Archived participant</Badge> : <Badge tone="success">Active</Badge>}
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
