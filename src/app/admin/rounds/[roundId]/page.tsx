import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { summarizeSets, toSetToneInput } from "@/lib/domain/import/review-status";
import { confidenceLabel } from "@/lib/domain/scoring/live-score";
import { latestSeasonSnapshot } from "@/lib/domain/standings/build-season-standings";
import { fixtureMode } from "@/lib/domain/standings/load-live";
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
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      season: true,
      matches: { orderBy: { sortOrder: "asc" } },
      predictionSets: { include: { participant: true, predictions: true } },
      roundScores: { include: { participant: true } },
      _count: { select: { forumComments: true, predictionSets: true } },
    },
  });
  if (!round) {
    notFound();
  }

  const summary = summarizeSets(round.predictionSets.map(toSetToneInput));
  const scoredFixtures = round.matches.filter(
    (match) => match.actualHomeGoals != null && match.actualAwayGoals != null,
  ).length;
  const participants = [...new Map(round.predictionSets.map((set) => [set.participantId, set.participant])).values()].sort(
    (left, right) => left.name.localeCompare(right.name, "ru"),
  );
  const scores = [...round.roundScores].sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    return left.participant.name.localeCompare(right.participant.name, "ru");
  });
  const snapshot = await latestSeasonSnapshot(round.seasonId);

  return (
    <>
      <PageHeader
        badges={<StatusBadge status={round.status} />}
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/seasons/${round.seasonId}`}>{round.season.name}</CrumbLink>
          </>
        }
        description="Import the thread, correct the parser, enter results, then calculate."
        nav={<RoundNav roundId={round.id} seasonId={round.seasonId} />}
        title={`${round.number}. ${round.name ?? "Round"}`}
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {round.status === "imported" ? (
          <Notice label="Imported parser results" tone="info">
            These slips are raw parser output{round.fetchedAt ? `, fetched ${round.fetchedAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}.
            They are not the trusted baseline and they are not computed standings.
            {round.importNotes ? ` ${round.importNotes}` : ""}
          </Notice>
        ) : null}
        {summary.conflicts > 0 ? (
          <Notice tone="warning">
            {summary.conflicts} prediction {summary.conflicts === 1 ? "set has" : "sets have"} a parse conflict. Open review
            and decide which line counts.
          </Notice>
        ) : null}
        {summary.corrections > 0 ? (
          <Notice tone="warning">
            {summary.corrections} {summary.corrections === 1 ? "set needs" : "sets need"} a manual correction before scoring.
          </Notice>
        ) : null}

        <section id="overview">
          <KpiGrid
            items={[
              { label: "Fixtures scored", value: `${scoredFixtures}/${round.matches.length}` },
              { label: "Comments", value: round._count.forumComments },
              { label: "Selected sets", value: summary.selected, hint: `${round._count.predictionSets} stored` },
              {
                label: "Parse conflicts",
                value: summary.conflicts,
                tone: summary.conflicts > 0 ? "danger" : "default",
              },
              {
                label: "Need correction",
                value: summary.corrections,
                tone: summary.corrections > 0 ? "warning" : "default",
              },
            ]}
          />
        </section>

        <Section
          action={
            <Link className={buttonClass("secondary")} href={`/admin/rounds/${round.id}/review`}>
              Open review
            </Link>
          }
          description="Save the thread URL, fetch comments, and parse them into prediction sets."
          id="import"
          title="Import and parser review"
        >
          <form action={saveForumUrlAction} className="flex flex-wrap items-end gap-2">
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
          <p className="mt-3 text-sm text-zinc-500">
            {round._count.forumComments} comments stored. Fetch and parse from the review page so the URL you type is the one that is downloaded.
          </p>
          {round.matches.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">Add fixtures before expecting the parser to match lines.</p>
          ) : null}
        </Section>

        <Section
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
                const tone = selected ? summarizeSets([toSetToneInput(selected)]) : null;
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
                      {tone && tone.conflicts > 0 ? <Badge tone="danger">Parse conflict</Badge> : null}
                      {tone && tone.corrections > 0 ? <Badge tone="warning">Needs correction</Badge> : null}
                      {selected && tone && tone.conflicts === 0 && tone.corrections === 0 ? (
                        <Badge tone="success">Ready</Badge>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
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
            Live points update on Round results without being stored. Calculate writes the confirmed season total only after every fixture is verified.
          </p>
          <form action={calculateRoundAction} className="mt-4">
            <input name="roundId" type="hidden" value={round.id} />
            <SubmitButton pendingLabel="Calculating…" variant="primary">
              Calculate round
            </SubmitButton>
          </form>
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

        <Section
          action={
            <Link className={buttonClass("secondary")} href={`/admin/seasons/${round.seasonId}/standings`}>
              Full season table
            </Link>
          }
          description={
            snapshot
              ? `After ${snapshot.name ?? `round ${snapshot.number}`}. Changed places are tinted.`
              : "The season table appears after the first calculation."
          }
          id="standings"
          title="Season standings"
        >
          {snapshot ? (
            <StandingsTable rows={snapshot.standingSnapshots} />
          ) : (
            <EmptyState detail="Calculate this round, or an earlier one, to publish the table." title="No season table yet" />
          )}
        </Section>
      </PageBody>
    </>
  );
}
