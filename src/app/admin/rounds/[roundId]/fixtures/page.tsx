import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { alignToFixture, type AlignedObservation } from "@/lib/domain/results/decide";
import { unavailableFromHealth, SOURCE_POLICY } from "@/lib/domain/results/policy";
import { rankFixtureResult, SOURCE_RANK, type CandidateStanding } from "@/lib/domain/results/ranking";
import { RoundNav } from "../../../round-nav";
import { SubmitButton } from "../../../submit-button";
import { Badge, CrumbLink, EmptyState, Field, Notice, PageBody, PageHeader, Section, fieldClass } from "../../../ui";
import { acceptSourceScoreAction, addFixtureAction, deleteFixtureAction, fetchResultsAction, saveFixturesAction } from "../workflow-actions";

export const instant = false;

function resolutionBadge(resultState: string, classification: string | undefined, hasCandidates: boolean): { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" } {
  if (resultState === "manual") {
    return { label: "manual", tone: "info" };
  }
  if (!hasCandidates) {
    return { label: resultState, tone: resultState === "verified" || resultState === "confirmed" ? "success" : "neutral" };
  }
  if (classification === "verified") {
    return { label: "verified", tone: "success" };
  }
  if (classification === "provisional") {
    return { label: "provisionally accepted", tone: "warning" };
  }
  if (classification === "conflict-review") {
    return { label: "conflict review needed", tone: "danger" };
  }
  return { label: "insufficient data", tone: "neutral" };
}

function standingTone(standing: CandidateStanding): "success" | "warning" | "danger" | "info" | "neutral" {
  if (standing === "selected" || standing === "agrees") {
    return "success";
  }
  if (standing === "downgraded") {
    return "warning";
  }
  if (standing === "flagged") {
    return "danger";
  }
  return "neutral";
}

export default async function FixturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ error?: string; saved?: string; fetched?: string; confirmed?: string; verified?: string; conflicts?: string; insufficient?: string; failed?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const [round, logs, health] = await Promise.all([
    prisma.round.findUnique({
      where: { id: roundId },
      include: {
        season: true,
        matches: { orderBy: { sortOrder: "asc" }, include: { resultObservations: { orderBy: { source: "asc" } } } },
      },
    }),
    prisma.resultFetchLog.findMany({ orderBy: { fetchedAt: "desc" }, take: 10 }),
    prisma.resultSourceHealth.findMany({ orderBy: { source: "asc" } }),
  ]);
  if (!round) {
    notFound();
  }
  const unavailable = unavailableFromHealth(health);
  const rankedAt = new Date();
  const rankings = new Map(
    round.matches.map((match) => {
      const aligned: AlignedObservation[] = match.resultObservations.flatMap((observation) => {
        const score = alignToFixture(match, observation);
        if (!score) {
          return [];
        }
        return [{
          source: observation.source,
          sourceKey: observation.sourceKey,
          homeTeam: observation.homeTeam,
          awayTeam: observation.awayTeam,
          homeGoals: score.homeGoals,
          awayGoals: score.awayGoals,
          role: observation.role === "primary" || observation.role === "verification" ? observation.role : "fallback",
          confidence: observation.confidence === "high" || observation.confidence === "low" ? observation.confidence : "medium",
          matchStatus: observation.matchStatus,
          completeness: observation.completeness,
          fetchedAt: observation.fetchedAt,
        }];
      });
      return [match.id, { aligned, ranking: rankFixtureResult(aligned, { unavailable, now: rankedAt }) }] as const;
    }),
  );

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
            Fetched results for the season. {query.verified ?? "0"} verified, {query.confirmed ?? "0"} provisionally accepted,{" "}
            {query.conflicts ?? "0"} need review, {query.insufficient ?? "0"} insufficient, {query.failed ?? "0"} sources failed. A conflict does not replace the stored score.
          </Notice>
        ) : null}

        <Section
          description={`Ranked sources: ${Object.entries(SOURCE_RANK)
            .map(([source, rank]) => `${source} ${rank.weight}`)
            .join(", ")}. Preferred fetch order: ${SOURCE_POLICY.preferred.join(", ")}. Fallbacks: ${SOURCE_POLICY.fallback.join(", ")}. Verification only: ${SOURCE_POLICY.verification.join(", ")}. A failed, stale, or partial row is downgraded. Two official-strength sources that disagree stay in review.`}
          id="ingest"
          title="Import actual results"
        >
          <form action={fetchResultsAction}>
            <input name="roundId" type="hidden" value={round.id} />
            <SubmitButton pendingLabel="Fetching…" variant="primary">
              Fetch results
            </SubmitButton>
          </form>
          {health.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No source health has been recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm text-zinc-700">
              {health.map((row) => {
                const down = row.degraded || (row.lastFailureAt != null && (row.lastSuccessAt == null || row.lastFailureAt > row.lastSuccessAt));
                return (
                  <li key={row.source}>
                    <Badge tone={row.degraded ? "warning" : down ? "danger" : "success"}>{row.degraded ? "degraded" : down ? "down" : "healthy"}</Badge>{" "}
                    <span className="font-medium">{row.source}</span> · {row.role} · {row.consecutiveFailures} consecutive failures
                    {row.lastSuccessAt ? <span className="text-zinc-500"> · last success {row.lastSuccessAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span> : null}
                    {row.lastFailureAt ? <span className="text-zinc-500"> · last failure {row.lastFailureAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span> : null}
                    {row.lastError ? <span className="text-zinc-500"> · {row.lastError}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {logs.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No fetch has been recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm text-zinc-700">
              {logs.map((log) => (
                <li key={log.id}>
                  <Badge tone={log.status === "ok" ? "success" : "danger"}>{log.status}</Badge>{" "}
                  <span className="font-medium">{log.source}</span> · {log.role} · {log.matchCount} finished matches
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
                    <Badge tone={resolutionBadge(match.resultState, rankings.get(match.id)?.ranking.classification, (rankings.get(match.id)?.ranking.candidates.length ?? 0) > 0).tone}>
                      {resolutionBadge(match.resultState, rankings.get(match.id)?.ranking.classification, (rankings.get(match.id)?.ranking.candidates.length ?? 0) > 0).label}
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
          {round.matches.some((match) => (rankings.get(match.id)?.ranking.candidates.length ?? 0) > 0) ? (
            <div className="mt-4 space-y-4">
              {round.matches.map((match) => {
                const review = rankings.get(match.id);
                const ranking = review?.ranking;
                if (!ranking || ranking.candidates.length === 0) {
                  return null;
                }
                const observations = new Map((review?.aligned ?? []).map((row) => [row.sourceKey, row]));
                return (
                  <div className="text-sm text-zinc-700" key={`sources-${match.id}`}>
                    <p className="font-medium">
                      {match.homeTeam} — {match.awayTeam}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {match.resultState === "manual"
                        ? "Manual score is selected. A later fetch will not replace it."
                        : ranking.selectedSource
                          ? `Selected ${ranking.selectedSource} ${ranking.homeGoals}-${ranking.awayGoals}. ${ranking.selectionReason}`
                          : ranking.selectionReason}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {ranking.candidates.map((candidate) => {
                        const parsed = match.resultObservations.find((row) => row.source === candidate.source && row.sourceKey === candidate.sourceKey);
                        const aligned = observations.get(candidate.sourceKey);
                        const offer =
                          aligned != null &&
                          (candidate.standing === "flagged" || candidate.standing === "downgraded") &&
                          (aligned.homeGoals !== match.actualHomeGoals || aligned.awayGoals !== match.actualAwayGoals);
                        return (
                          <li key={`${candidate.source}-${candidate.sourceKey}`}>
                            <form action={acceptSourceScoreAction} className="flex flex-wrap items-center gap-2">
                              <input name="roundId" type="hidden" value={round.id} />
                              <input name="matchId" type="hidden" value={match.id} />
                              <input name="source" type="hidden" value={candidate.source} />
                              <input name="homeGoals" type="hidden" value={aligned?.homeGoals ?? candidate.homeGoals} />
                              <input name="awayGoals" type="hidden" value={aligned?.awayGoals ?? candidate.awayGoals} />
                              <Badge tone={standingTone(candidate.standing)}>{candidate.standing}</Badge>
                              <span className="text-xs text-zinc-600">
                                {candidate.source} · rank {candidate.weight} · {candidate.homeGoals}-{candidate.awayGoals}
                                {parsed ? ` · parsed ${parsed.homeTeam} ${parsed.homeGoals}-${parsed.awayGoals} ${parsed.awayTeam}` : ""}
                                {parsed ? ` · ${parsed.fetchedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}
                                {" · "}
                                {candidate.reason}
                              </span>
                              {offer ? (
                                <SubmitButton pendingLabel="Saving…" variant="ghost">
                                  Use this score
                                </SubmitButton>
                              ) : null}
                            </form>
                          </li>
                        );
                      })}
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
