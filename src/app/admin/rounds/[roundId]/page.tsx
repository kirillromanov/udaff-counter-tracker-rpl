import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resultVerificationApplies } from "@/lib/domain/results/eligibility";
import { metricTone, primaryConsistencyMetric, resultIssueCount, resultIssueRows, roundConsistency, roundCounters, type MetricFixture, type MetricSet } from "@/lib/domain/review/round-metrics";
import { confidenceLabel } from "@/lib/domain/scoring/live-score";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { fixtureMode } from "@/lib/domain/standings/load-live";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";
import { isRoundClosed } from "@/lib/domain/rounds/round-lock";
import { MutationRegion, RoundLockBadge, RoundLockPanel } from "./round-lock-banner";
import { formatMoscow } from "@/lib/domain/time/moscow";
import { RoundNav } from "../../round-nav";
import { SubmitButton } from "../../submit-button";
import {
  Badge,
  CrumbLink,
  EmptyState,
  KpiGrid,
  Notice,
  PageBody,
  PageHeader,
  RoundScoreTable,
  Section,
  StandingsTable,
  StatusBadge,
  buttonClass,
  fieldClass,
} from "../../ui";
import { calculateRoundAction, saveForumUrlAction } from "./workflow-actions";

export const instant = false;

export default async function RoundPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ error?: string; closed?: string; reopened?: string; started?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      season: true,
      matches: { orderBy: { sortOrder: "asc" } },
      predictionSets: { include: { participant: true, predictions: true, forumComment: { select: { authorName: true, externalId: true, reviewState: true, reviewNote: true } } } },
      roundScores: { include: { participant: true } },
      _count: { select: { forumComments: true, predictionSets: true } },
    },
  });
  if (!round) {
    notFound();
  }

  const preparing = round.standingRole !== ARCHIVED_ROUND && round.productionStartedAt == null && !isRoundClosed(round.closedAt);
  const metricSets: MetricSet[] = round.predictionSets.map((set) => ({
    id: set.id,
    status: set.status,
    selected: set.selected,
    warningsJson: set.warningsJson,
    parsedJson: set.parsedJson,
    rawComment: set.rawComment,
    predictions: set.predictions,
    reviewState: set.forumComment?.reviewState,
    reviewNote: set.forumComment?.reviewNote,
    authorName: set.forumComment?.authorName,
    externalId: set.forumComment?.externalId,
  }));
  const metricFixtures: MetricFixture[] = round.matches.map((match) => ({
    id: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    manuallyCorrected: match.manuallyCorrected,
    resultProvenance: match.resultProvenance,
    resultNote: match.resultNote,
  }));
  const summary = {
    ...roundCounters({ comments: [], sets: metricSets, fixtures: metricFixtures }),
    comments: round._count.forumComments,
  };
  const covered = new Set(round.predictionSets.filter((set) => set.selected).flatMap((set) => set.predictions.map((row) => row.matchId)));
  const verificationApplies = resultVerificationApplies({ seasonSlug: round.season.slug, number: round.number });
  const consistency = roundConsistency({
    counters: summary,
    fixtures: metricFixtures,
    selectedCoversFixture: (fixtureId) => covered.has(fixtureId),
    verificationApplies,
  });
  const reviewBase = `/admin/rounds/${round.id}/review`;
  const participants = [...new Map(round.predictionSets.map((set) => [set.participantId, set.participant])).values()].sort(
    (left, right) => left.name.localeCompare(right.name, "ru"),
  );
  const scores = [...round.roundScores].sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    return left.participant.name.localeCompare(right.participant.name, "ru");
  });
  const snapshot = round.standingRole === ARCHIVED_ROUND ? null : await latestSeasonSnapshot(round.seasonId);
  const archived = round.standingRole === ARCHIVED_ROUND;
  const closed = isRoundClosed(round.closedAt);

  return (
    <>
      <PageHeader
        badges={
          <>
            <StatusBadge status={round.status} />
            <RoundLockBadge closedAt={round.closedAt} productionStartedAt={round.productionStartedAt} standingRole={round.standingRole} />
          </>
        }
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/seasons/${round.seasonId}`}>{round.season.name}</CrumbLink>
          </>
        }
        description={
          archived
            ? "Archived reference round. Use it for parser checks, source checks, and debugging. Its points stay out of production standings."
            : preparing
              ? "Preparation. Load the source and fixtures, then start production. Automatic checks stay off, and this round is not in the season total yet."
              : "Production round. A verified calculation is added on top of the trusted baseline."
        }
        nav={<RoundNav roundId={round.id} seasonId={round.seasonId} />}
        title={`${round.number}. ${round.name ?? "Round"}`}
      />
      <PageBody compact>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.started ? (
          <Notice tone="success">
            Production started. Nothing was fetched or calculated. The existing scheduler can include this round on its next cycle.
          </Notice>
        ) : null}
        {query.closed ? <Notice tone="success">Round closed. Saved data is unchanged.</Notice> : null}
        {query.reopened ? <Notice tone="success">Production reopened. Nothing was fetched or recalculated.</Notice> : null}
        {round.importNotes?.startsWith("Fixture source:") && round.status !== "imported" ? (
          <Notice label="Fixture source" tone="info">
            {round.importNotes}
          </Notice>
        ) : null}
        <RoundLockPanel roundId={round.id} />
        {archived ? (
          <Notice label="Archived reference" tone="info">
            This round is part of the trusted baseline. Parser review, fixtures, and a reference calculation stay available. Calculating it does not change production standings.
          </Notice>
        ) : null}
        {round.status === "imported" ? (
          <Notice label="Imported parser results" tone="info">
            These slips are raw parser output{round.fetchedAt ? `, fetched ${formatMoscow(round.fetchedAt)}` : ""}.
            They are not the trusted baseline and they are not the confirmed season total.
            {round.importNotes ? ` ${round.importNotes}` : ""}
          </Notice>
        ) : null}
        <section id="overview">
          {(() => {
            const issues = resultIssueRows(metricFixtures, (fixtureId) => covered.has(fixtureId), { verificationApplies });
            const issueTotal = resultIssueCount(issues);
            const focus = primaryConsistencyMetric(summary, issues);
            return (
              <>
                <KpiGrid
                  compact
                  items={[
                    { label: "Fixtures scored", value: `${summary.scored}/${summary.fixtures}`, href: `${reviewBase}?metric=scored` },
                    { label: "Comments", value: summary.comments, href: `${reviewBase}?metric=comments` },
                    { label: "Selected sets", value: summary.selected, hint: `${summary.stored} stored`, href: `${reviewBase}?metric=selected`, hintHref: `${reviewBase}?metric=stored` },
                    { label: "Parse conflicts", value: summary.conflicts, href: `${reviewBase}?metric=conflicts`, tone: summary.conflicts > 0 ? "danger" : "default" },
                    { label: "Need correction", value: summary.corrections, href: `${reviewBase}?metric=corrections`, tone: summary.corrections > 0 ? "warning" : "default" },
                    { label: "Result issues", value: issueTotal, href: `${reviewBase}?metric=results`, tone: issues.some((row) => row.kind === "blocking") ? "danger" : issueTotal > 0 ? "warning" : "default" },
                  ]}
                />
                <p className="mt-2 text-sm text-zinc-700">
                  <Link className="font-medium text-zinc-950 underline" href={`${reviewBase}?metric=${focus}`}>{consistency.consistent ? "Consistent" : "Not consistent"}</Link>
                  {consistency.consistent
                    ? issues.some((row) => row.kind === "pending" || row.kind === "notice")
                      ? ". The checks on this round passed. Pending fixtures and manual notices are not errors."
                      : ". The checks on this round passed."
                    : ". Open the counter on review for the records."}
                </p>
              </>
            );
          })()}
        </section>

        <Section compact
          action={
            <Link className={buttonClass("secondary")} href={`/admin/rounds/${round.id}/review`}>
              Open review
            </Link>
          }
          description="Save the thread URL, fetch comments, and parse them into prediction sets."
          id="import"
          title="Import and parser review"
        >
          <MutationRegion closed={closed}>
          <form action={saveForumUrlAction} className="flex flex-wrap items-end gap-2" key={round.id}>
            <input name="roundId" type="hidden" value={round.id} />
            <label className="min-w-72 flex-1 text-xs font-medium text-zinc-500">
              Forum URL
              <input
                className={`${fieldClass} mt-1 w-full`}
                defaultValue={round.forumUrl ?? ""}
                name="forumUrl"
                placeholder="https://..."
                type="url"
              />
            </label>
            <SubmitButton pendingLabel="Saving…">Save URL</SubmitButton>
          </form>
          </MutationRegion>
          <p className="mt-3 text-sm text-zinc-500">
            {round._count.forumComments} comments stored. Fetch and parse from the review page so the URL you type is the one that is downloaded.
          </p>
          {round.matches.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">Add fixtures before expecting the parser to match lines.</p>
          ) : null}
        </Section>

        <Section compact
          description="People with at least one prediction set on this round."
          id="participants"
          title="Participants"
        >
          {participants.length === 0 ? (
            <EmptyState detail="Fetch and parse a thread, or add a set by hand on the review page." title="No participants yet" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {participants.map((participant) => {
                const sets = round.predictionSets.filter((set) => set.participantId === participant.id);
                const selected = sets.find((set) => set.selected);
                const tone = selected ? metricTone(metricSets.find((set) => set.id === selected.id)!) : "ok";
                return (
                  <li className="flex flex-wrap items-center justify-between gap-3 py-2.5" key={participant.id}>
                    <div>
                      <p className="font-medium">{participant.name}</p>
                      <p className="text-xs text-zinc-500">
                        {sets.length} {sets.length === 1 ? "set" : "sets"}
                        {selected ? " · selected" : " · nothing selected"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {tone === "conflict" ? <Badge tone="danger">Parse conflict</Badge> : null}
                      {tone === "correction" ? <Badge tone="warning">Needs correction</Badge> : null}
                      {selected && tone === "ok" ? (
                        <Badge tone="success">Ready</Badge>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section compact
          action={
            <Link className={buttonClass("secondary")} href={`/admin/rounds/${round.id}/fixtures`}>
              Edit fixtures
            </Link>
          }
          description="Verified fixtures can be stored as a confirmed total. Provisional, pending, and conflict fixtures stay on the live results page."
          id="results"
          title="Round results"
        >
          {round.matches.length === 0 ? (
            <EmptyState detail="Add the matches for this round before entering scores." title="No fixtures yet" />
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {round.matches.map((match) => {
                const played = match.actualHomeGoals != null && match.actualAwayGoals != null;
                const confidence = fixtureMode(match);
                const tone = confidence === "verified" ? "success" : confidence === "conflict" ? "danger" : confidence === "provisional" ? "warning" : "neutral";
                return (
                  <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={match.id}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span>
                        {match.homeTeam} — {match.awayTeam}
                      </span>
                      {match.isMatchOfTheRound ? <Badge tone="info">Official MT</Badge> : null}
                      <Badge tone={tone}>{confidenceLabel(confidence, match.resultConflict && match.conflictAcknowledgedAt != null)}</Badge>
                    </span>
                    {played ? (
                      <span className="font-medium tabular-nums">
                        {match.actualHomeGoals}–{match.actualAwayGoals}
                      </span>
                    ) : (
                      <span className="text-zinc-400">Pending</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-sm text-zinc-600">
            {archived
              ? "Live points on Round results are diagnostic. Calculate stores a reference total for this round only, after every fixture is verified."
              : "Live points update on Round results without being stored. Calculate writes this round onto the production season total only after every fixture is verified."}
          </p>
          <MutationRegion closed={closed}>
          <form action={calculateRoundAction} className="mt-4">
            <input name="roundId" type="hidden" value={round.id} />
            <SubmitButton pendingLabel="Calculating…" variant="primary">
              Calculate round
            </SubmitButton>
          </form>
          </MutationRegion>
          {scores.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">No calculation stored yet.</p>
          ) : (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Stored confirmed ranking</h3>
                <Link className="text-sm text-zinc-600 hover:text-zinc-950" href={`/admin/rounds/${round.id}/results`}>
                  Breakdown
                </Link>
              </div>
              <RoundScoreTable rows={scores} />
            </div>
          )}
        </Section>

        <Section compact
          action={
            <Link className={buttonClass("secondary")} href={`/admin/seasons/${round.seasonId}/standings`}>
              Full season table
            </Link>
          }
          description={
            archived
              ? "Production standings stay on the season page. This archived round is not added to them."
              : snapshot
                ? `Production table after ${snapshot.name ?? `round ${snapshot.number}`}. Changed places are tinted.`
                : "Production standings are the trusted baseline until this round is calculated."
          }
          id="standings"
          title="Production standings"
        >
          {archived ? (
            <EmptyState detail="Open the season standings page. The trusted baseline is the current production total." title="Not part of the season total" />
          ) : snapshot ? (
            <StandingsTable rows={snapshot.standingSnapshots} />
          ) : (
            <EmptyState detail="Calculate this production round after every fixture is verified." title="Baseline is still the season total" />
          )}
        </Section>
      </PageBody>
    </>
  );
}
