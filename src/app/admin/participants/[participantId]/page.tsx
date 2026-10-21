import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { canPermanentlyDelete, isActiveInSeason, type MembershipState } from "@/lib/domain/participants/roster";
import {
  addAliasAction,
  archiveParticipantAction,
  deleteParticipantAction,
  removeAliasAction,
  restoreParticipantAction,
  rosterAction,
  updateParticipantAction,
} from "../actions";
import { SubmitButton } from "../../submit-button";
import { Badge, CrumbLink, Notice, PageBody, PageHeader, Section, fieldClass } from "../../ui";

export const instant = false;

function membershipOf(status: string | undefined): MembershipState {
  if (status === "included" || status === "excluded") {
    return status;
  }
  return "absent";
}

export default async function ParticipantPage({
  params,
  searchParams,
}: {
  params: Promise<{ participantId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await connection();
  const { participantId } = await params;
  const query = await searchParams;
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    include: { aliases: { orderBy: { isPrimary: "desc" } }, seasons: true },
  });
  if (!participant) {
    notFound();
  }
  const seasons = await prisma.season.findMany({ orderBy: { name: "asc" } });
  const [predictionSets, roundScores, snapshots] = await Promise.all([
    prisma.predictionSet.count({ where: { participantId } }),
    prisma.roundScore.count({ where: { participantId } }),
    prisma.standingSnapshot.count({ where: { participantId } }),
  ]);
  const removable = canPermanentlyDelete({ predictionSets, roundScores, snapshots });
  const here = `/admin/participants/${participant.id}`;

  return (
    <>
      <PageHeader
        badges={participant.archivedAt ? <Badge>Archived</Badge> : <Badge tone="success">In registry</Badge>}
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href="/admin/participants">Participants</CrumbLink>
          </>
        }
        description="Aliases collapse nickname variations onto this person. Archive keeps historical scores."
        title={participant.name}
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.saved ? <Notice tone="success">Saved.</Notice> : null}

        <Section title="Name">
          <form action={updateParticipantAction} className="flex flex-wrap items-end gap-2">
            <input name="participantId" type="hidden" value={participant.id} />
            <label className="text-xs font-medium text-zinc-500">
              Display name
              <input className={`${fieldClass} mt-1 w-72`} defaultValue={participant.name} name="name" />
            </label>
            <SubmitButton pendingLabel="Saving…" variant="primary">
              Save name
            </SubmitButton>
          </form>
        </Section>

        <Section description="The primary name is edited above. Extra aliases match forum nicks without creating a second person." title="Aliases">
          <ul className="divide-y divide-zinc-100">
            {participant.aliases.map((alias) => (
              <li className="flex flex-wrap items-center justify-between gap-3 py-2" key={alias.id}>
                <span>
                  {alias.alias}{" "}
                  {alias.isPrimary ? <Badge>Primary</Badge> : <span className="text-xs text-zinc-500">{alias.normalized}</span>}
                </span>
                {alias.isPrimary ? null : (
                  <form action={removeAliasAction}>
                    <input name="participantId" type="hidden" value={participant.id} />
                    <input name="aliasId" type="hidden" value={alias.id} />
                    <SubmitButton pendingLabel="Removing…" variant="ghost">
                      Remove
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <form action={addAliasAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4">
            <input name="participantId" type="hidden" value={participant.id} />
            <label className="text-xs font-medium text-zinc-500">
              Add alias
              <input className={`${fieldClass} mt-1 w-64`} name="alias" placeholder="Another nick" />
            </label>
            <SubmitButton pendingLabel="Adding…">Add alias</SubmitButton>
          </form>
        </Section>

        <Section
          description="Included means active for that season. Excluded keeps the roster row and any past scores."
          title="Season rosters"
        >
          {seasons.length === 0 ? (
            <p className="text-sm text-zinc-500">No seasons yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {seasons.map((season) => {
                const membership = membershipOf(participant.seasons.find((item) => item.seasonId === season.id)?.status);
                const active = isActiveInSeason({ archived: participant.archivedAt != null, membership });
                return (
                  <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={season.id}>
                    <div>
                      <Link className="font-medium hover:underline" href={`/admin/seasons/${season.id}/roster`}>
                        {season.name}
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
                      ) : null}
                      {membership !== "absent" && membership !== "excluded" ? (
                        <form action={rosterAction}>
                          <input name="participantId" type="hidden" value={participant.id} />
                          <input name="seasonId" type="hidden" value={season.id} />
                          <input name="roster" type="hidden" value="exclude" />
                          <input name="returnTo" type="hidden" value={here} />
                          <SubmitButton pendingLabel="Saving…">Exclude</SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          description={
            removable
              ? "No predictions or standings are attached, so this person can be removed permanently."
              : `${predictionSets} prediction sets, ${roundScores} round scores, ${snapshots} standing rows stay if you archive.`
          }
          title="Archive or delete"
        >
          <div className="flex flex-wrap gap-2">
            {participant.archivedAt ? (
              <form action={restoreParticipantAction}>
                <input name="participantId" type="hidden" value={participant.id} />
                <SubmitButton pendingLabel="Restoring…" variant="primary">
                  Restore to registry
                </SubmitButton>
              </form>
            ) : (
              <form action={archiveParticipantAction}>
                <input name="participantId" type="hidden" value={participant.id} />
                <SubmitButton pendingLabel="Archiving…">Archive</SubmitButton>
              </form>
            )}
            {removable ? (
              <form action={deleteParticipantAction}>
                <input name="participantId" type="hidden" value={participant.id} />
                <SubmitButton pendingLabel="Deleting…">Delete permanently</SubmitButton>
              </form>
            ) : null}
          </div>
        </Section>
      </PageBody>
    </>
  );
}
