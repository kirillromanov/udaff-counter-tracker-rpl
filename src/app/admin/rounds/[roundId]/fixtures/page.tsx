import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { alignToFixture } from "@/lib/domain/results/decide";
import { RoundNav } from "../../../round-nav";
import { SubmitButton } from "../../../submit-button";
import { Badge, CrumbLink, EmptyState, Field, Notice, PageBody, PageHeader, Section, fieldClass } from "../../../ui";
import { acceptSourceScoreAction, addFixtureAction, deleteFixtureAction, fetchResultsAction, saveFixturesAction } from "../workflow-actions";

export const instant = false;

export default async function FixturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ error?: string; saved?: string; fetched?: string; confirmed?: string; conflicts?: string; failed?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const [round, logs] = await Promise.all([
    prisma.round.findUnique({
      where: { id: roundId },
      include: {
        season: true,
        matches: { orderBy: { sortOrder: "asc" }, include: { resultObservations: { orderBy: { source: "asc" } } } },
      },
    }),
    prisma.resultFetchLog.findMany({ orderBy: { fetchedAt: "desc" }, take: 6 }),
  ]);
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
        description="One match can be the official Match of the Round. Fetched scores stay empty until a source reports the match finished."
        nav={<RoundNav roundId={round.id} seasonId={round.seasonId} />}
        title="Fixtures and results"
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.saved ? <Notice tone="success">Fixtures saved.</Notice> : null}
        {query.fetched ? (
          <Notice tone={query.conflicts && query.conflicts !== "0" ? "warning" : "success"}>
            Fetched results for the season. {query.confirmed ?? "0"} matches confirmed, {query.conflicts ?? "0"} conflicts,{" "}
            {query.failed ?? "0"} sources failed. A conflict does not replace the stored score.
          </Notice>
        ) : null}

        <Section
          description="Sport.ru is the primary table. Championat and Sportbox are fallbacks and may be blocked. Fetching again updates the same rows."
          id="ingest"
          title="Import actual results"
        >
          <form action={fetchResultsAction}>
            <input name="roundId" type="hidden" value={round.id} />
            <SubmitButton pendingLabel="Fetching…" variant="primary">
              Fetch results
            </SubmitButton>
          </form>
          {logs.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No fetch has been recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm text-zinc-700">
              {logs.map((log) => (
                <li key={log.id}>
                  <Badge tone={log.status === "ok" ? "success" : "danger"}>{log.status}</Badge>{" "}
                  <span className="font-medium">{log.source}</span> · {log.matchCount} finished matches
                  {log.error ? <span className="text-zinc-500"> · {log.error}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

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
                    <Badge
                      tone={
                        match.resultConflict ? "danger" : match.resultState === "confirmed" ? "success" : match.resultState === "manual" ? "info" : "neutral"
                      }
                    >
                      {match.resultConflict ? "Conflict" : match.resultState}
                    </Badge>
                  </div>
                  {match.resultNote ? <p className="mt-2 text-xs text-zinc-600">{match.resultNote}</p> : null}
                </div>
              ))}
              <SubmitButton pendingLabel="Saving…" variant="primary">
                Save fixtures
              </SubmitButton>
            </form>
          )}
          {round.matches.some((match) => match.resultObservations.length > 0) ? (
            <div className="mt-4 space-y-2">
              {round.matches.map((match) => {
                const rows = match.resultObservations.flatMap((observation) => {
                  const aligned = alignToFixture(match, observation);
                  return aligned ? [{ observation, aligned }] : [];
                });
                if (rows.length === 0) {
                  return null;
                }
                return (
                  <div className="text-sm text-zinc-700" key={`sources-${match.id}`}>
                    <span className="font-medium">
                      {match.homeTeam} — {match.awayTeam}
                    </span>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {rows.map(({ observation, aligned }) => (
                        <li key={observation.id}>
                          <form action={acceptSourceScoreAction} className="flex items-center gap-2">
                            <input name="roundId" type="hidden" value={round.id} />
                            <input name="matchId" type="hidden" value={match.id} />
                            <input name="source" type="hidden" value={observation.source} />
                            <input name="homeGoals" type="hidden" value={aligned.homeGoals} />
                            <input name="awayGoals" type="hidden" value={aligned.awayGoals} />
                            <span className="text-xs text-zinc-600">
                              {observation.source} {aligned.homeGoals}-{aligned.awayGoals}
                            </span>
                            {match.resultConflict ? (
                              <SubmitButton pendingLabel="Saving…" variant="ghost">
                                Use this score
                              </SubmitButton>
                            ) : null}
                          </form>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : null}
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
