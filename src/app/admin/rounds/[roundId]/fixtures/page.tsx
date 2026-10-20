import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { RoundNav } from "../../../round-nav";
import { SubmitButton } from "../../../submit-button";
import { CrumbLink, EmptyState, Field, Notice, PageBody, PageHeader, Section, fieldClass } from "../../../ui";
import { addFixtureAction, deleteFixtureAction, saveFixturesAction } from "../workflow-actions";

export const instant = false;

export default async function FixturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: { season: true, matches: { orderBy: { sortOrder: "asc" } } },
  });
  if (!round) {
    notFound();
  }

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
        description="One match can be the official Match of the Round. Leave scores empty until the match is played."
        nav={<RoundNav roundId={round.id} seasonId={round.seasonId} />}
        title="Fixtures and results"
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.saved ? <Notice tone="success">Fixtures saved.</Notice> : null}

        <Section description="Order, clubs, actual score, and the official MT flag." id="results" title="Round results">
          {round.matches.length === 0 ? (
            <EmptyState detail="Add the first fixture below." title="No fixtures yet" />
          ) : (
            <form action={saveFixturesAction} className="space-y-3">
              <input name="roundId" type="hidden" value={round.id} />
              {round.matches.map((match) => (
                <div className="rounded-lg border border-zinc-200 p-3" key={match.id}>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Order">
                      <input className={`${fieldClass} w-16`} defaultValue={match.sortOrder} name={`order_${match.id}`} />
                    </Field>
                    <Field label="Home">
                      <input className={`${fieldClass} w-40`} defaultValue={match.homeTeam} name={`home_${match.id}`} />
                    </Field>
                    <Field label="Away">
                      <input className={`${fieldClass} w-40`} defaultValue={match.awayTeam} name={`away_${match.id}`} />
                    </Field>
                    <Field label="Home goals">
                      <input
                        className={`${fieldClass} w-20`}
                        defaultValue={match.actualHomeGoals ?? ""}
                        name={`homeGoals_${match.id}`}
                        placeholder="—"
                      />
                    </Field>
                    <Field label="Away goals">
                      <input
                        className={`${fieldClass} w-20`}
                        defaultValue={match.actualAwayGoals ?? ""}
                        name={`awayGoals_${match.id}`}
                        placeholder="—"
                      />
                    </Field>
                    <label className="mb-2 flex items-center gap-2 text-sm text-zinc-700">
                      <input defaultChecked={match.isMatchOfTheRound} name="matchOfTheRound" type="radio" value={match.id} />
                      Official MT
                    </label>
                  </div>
                </div>
              ))}
              <SubmitButton pendingLabel="Saving…" variant="primary">
                Save fixtures
              </SubmitButton>
            </form>
          )}
          {round.matches.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-3">
              {round.matches.map((match) => (
                <form action={deleteFixtureAction} key={`delete-${match.id}`}>
                  <input name="roundId" type="hidden" value={round.id} />
                  <input name="matchId" type="hidden" value={match.id} />
                  <SubmitButton pendingLabel="Deleting…" variant="ghost">
                    {`Delete ${match.homeTeam} — ${match.awayTeam}`}
                  </SubmitButton>
                </form>
              ))}
            </div>
          ) : null}
        </Section>

        <Section description="New matches are added at the end of the list." id="add-fixture" title="Add a fixture">
          <form action={addFixtureAction} className="flex flex-wrap items-end gap-2">
            <input name="roundId" type="hidden" value={round.id} />
            <Field label="Home">
              <input className={`${fieldClass} w-40`} name="homeTeam" placeholder="Home" />
            </Field>
            <Field label="Away">
              <input className={`${fieldClass} w-40`} name="awayTeam" placeholder="Away" />
            </Field>
            <SubmitButton pendingLabel="Adding…" variant="primary">
              Add
            </SubmitButton>
          </form>
        </Section>
      </PageBody>
    </>
  );
}
