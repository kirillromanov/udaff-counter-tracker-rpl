import { KNOWN_PARTICIPANTS } from "@/lib/domain/participants/known-participants";
import { revisionToken } from "@/lib/domain/import/matrix-edits";
import { cellText } from "@/lib/domain/import/save-matrix";
import { scoreMatch } from "@/lib/domain/scoring/score-match";
import { fixtureConfidence, type LiveFixtureInput } from "@/lib/domain/scoring/live-score";
import { fixtureCheckStatus, planRoundPoll, pollIntervals, type PollFixture } from "@/lib/domain/results/poll";
import type { RefreshQuery } from "@/lib/domain/results/refresh-status";
import { prisma } from "@/lib/db/prisma";
import { SubmitButton } from "../../../submit-button";
import { saveMatrixAction, saveMatrixResultsAction } from "../actions";
import { fieldClass, Section } from "../../../ui";
import { CalculateIntermediateButton } from "../calculate-intermediate-button";
import { MatchResultsRefresh } from "../match-results-refresh";
import { classifyIntermediateFixture, exclusionLabel, isFixtureExclusion, ROUND_STATUS_STALE } from "@/lib/domain/standings/intermediate";
import { slipsByParticipant } from "@/lib/domain/import/effective-slip";
import { formatMoscow } from "@/lib/domain/time/moscow";

function liveFixture(match: {
  id: string;
  homeTeam: string;
  awayTeam: string;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledgedAt: Date | null;
  isMatchOfTheRound: boolean;
}): LiveFixtureInput {
  return {
    matchId: match.id,
    label: `${match.homeTeam} — ${match.awayTeam}`,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledged: match.conflictAcknowledgedAt != null,
    isMatchOfTheRound: match.isMatchOfTheRound,
  };
}

export async function CleanMatrix({ roundId, refreshQuery }: { roundId: string; refreshQuery: RefreshQuery }) {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      matches: { orderBy: { sortOrder: "asc" }, include: { resultObservations: { select: { matchStatus: true } } } },
      forumComments: { select: { id: true } },
      season: {
        include: {
          participants: {
            where: { status: "included", participant: { archivedAt: null } },
            include: { participant: true },
          },
        },
      },
      predictionSets: {
        include: {
          participant: true,
          forumComment: true,
          predictions: true,
        },
      },
      roundScores: { select: { participantId: true, totalPoints: true, calculatedAt: true } },
    },
  });
  if (!round) {
    return null;
  }

  const order = new Map<string, number>(KNOWN_PARTICIPANTS.map((name, index) => [name, index]));
  const roster = round.season.participants
    .map((membership) => membership.participant)
    .sort((left, right) => (order.get(left.name) ?? 100) - (order.get(right.name) ?? 100) || left.name.localeCompare(right.name, "ru"));
  const fixtures = round.matches.map((match) => ({ ...match, confidence: fixtureConfidence(liveFixture(match)) }));
  const confirmed = fixtures.length > 0 && fixtures.every((match) => match.confidence === "verified");
  const now = new Date();
  const pollFixtures: PollFixture[] = round.matches.map((match) => ({
    kickoffAt: match.kickoffAt,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledgedAt: match.conflictAcknowledgedAt,
    liveReported: match.resultObservations.some((observation) => observation.matchStatus === "live"),
    providerStatus: (["postponed", "cancelled", "suspended", "live"] as const).find((status) =>
      match.resultObservations.some((observation) => observation.matchStatus === status),
    ) ?? null,
    autoCheckAttempts: match.autoCheckAttempts,
    autoCheckKickoffAt: match.autoCheckKickoffAt,
    autoCheckNextAt: match.autoCheckNextAt,
  }));
  const pollPlan = planRoundPoll(pollFixtures, now, pollIntervals());
  const intermediate = round.matches.map((match) => ({
    label: `${match.homeTeam} — ${match.awayTeam}`,
    klass: classifyIntermediateFixture({
      matchId: match.id,
      label: `${match.homeTeam} — ${match.awayTeam}`,
      actualHomeGoals: match.actualHomeGoals,
      actualAwayGoals: match.actualAwayGoals,
      resultState: match.resultState,
      resultResolution: match.resultResolution,
      resultConflict: match.resultConflict,
      isMatchOfTheRound: match.isMatchOfTheRound,
      observationStatuses: match.resultObservations.map((observation) => observation.matchStatus),
    }),
  }));
  const includedCount = intermediate.filter((fixture) => fixture.klass === "included").length;
  const calculatedAt = round.roundScores.reduce<Date | null>(
    (latest, score) => (!latest || score.calculatedAt > latest ? score.calculatedAt : latest),
    null,
  );
  const excluded = intermediate.filter((fixture) => fixture.klass !== "included");

  return (
    <Section
      title="Чистовая таблица / Прогнозы и расчёт"
      description="One cell per roster participant and fixture. An empty cell is a missing prediction, not 0-0. Saving writes these cells as the effective slips and keeps them ahead of a later parse."
    >
      <MatchResultsRefresh
        lastPolledAt={round.lastPolledAt}
        lastSuccessfulSource={round.lastSuccessfulSource}
        checks={round.matches.map((match) => ({
          label: `${match.homeTeam} — ${match.awayTeam}`,
          status: fixtureCheckStatus({
            kickoffAt: match.kickoffAt,
            actualHomeGoals: match.actualHomeGoals,
            actualAwayGoals: match.actualAwayGoals,
            resultState: match.resultState,
            resultResolution: match.resultResolution,
            resultConflict: match.resultConflict,
            conflictAcknowledgedAt: match.conflictAcknowledgedAt,
            autoCheckAttempts: match.autoCheckAttempts,
            autoCheckKickoffAt: match.autoCheckKickoffAt,
            autoCheckNextAt: match.autoCheckNextAt,
            providerStatus: match.resultObservations.some((observation) => observation.matchStatus === "postponed")
              ? "postponed"
              : match.resultObservations.some((observation) => observation.matchStatus === "cancelled")
                ? "cancelled"
                : match.resultObservations.some((observation) => observation.matchStatus === "suspended")
                  ? "suspended"
                  : null,
          }),
        }))}
        nextPollAt={round.nextPollAt}
        now={now}
        plan={pollPlan}
        pollHealthSummary={round.pollHealthSummary}
        query={refreshQuery}
        returnTo="review"
        roundId={round.id}
      />
      {round.forumComments.length === 0 ? (
        <p className="mb-3 text-sm text-amber-800">
          No source comments are stored for this round. Empty cells are not proof that a participant submitted nothing.
        </p>
      ) : null}
      <form action={saveMatrixResultsAction} className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <input name="roundId" type="hidden" value={round.id} />
        <p className="mb-2 text-sm text-amber-950">
          Actual results are shared. Changing one score changes the points of every participant. This is separate from editing a prediction.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {fixtures.map((match) => (
            <label key={match.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {match.homeTeam} — {match.awayTeam}
                {match.isMatchOfTheRound ? " (МТ)" : ""}
                <span className="ml-1 text-xs text-zinc-500">{match.confidence}</span>
              </span>
              <span className="flex gap-1">
                <input name={`actual_${match.id}_home`} defaultValue={match.actualHomeGoals ?? ""} className={`${fieldClass} w-14`} inputMode="numeric" />
                <input name={`actual_${match.id}_away`} defaultValue={match.actualAwayGoals ?? ""} className={`${fieldClass} w-14`} inputMode="numeric" />
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3">
          <SubmitButton pendingLabel="Saving results…">Save actual results</SubmitButton>
        </div>
      </form>

      <form action={saveMatrixAction}>
        <input name="roundId" type="hidden" value={round.id} />
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white px-2 py-2 text-left">Participant</th>
                {fixtures.map((match) => (
                  <th key={match.id} className="px-2 py-2 text-left font-medium">
                    {match.homeTeam}
                    <br />
                    {match.awayTeam}
                    {match.isMatchOfTheRound ? " МТ" : ""}
                    <div className="font-normal text-zinc-500">
                      {match.kickoffAt ? formatMoscow(match.kickoffAt) : "no kickoff"}
                      <br />
                      {match.actualHomeGoals == null ? match.confidence : `${match.actualHomeGoals}-${match.actualAwayGoals}`}
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2 text-right">Round</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((person) => {
                const owned = round.predictionSets.filter((set) => set.participantId === person.id);
                const selectedSets = owned.filter((set) => set.selected);
                const selected = [...selectedSets].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;
                const slip = slipsByParticipant(
                  fixtures.map((match) => match.id),
                  selectedSets.map((set) => ({
                    id: set.id,
                    participantId: set.participantId,
                    selection: set.selection,
                    manuallyEdited: set.manuallyEdited,
                    createdAt: set.createdAt,
                    postedAt: set.forumComment?.postedAt ?? null,
                    predictions: set.predictions,
                  })),
                )[0];
                const reviewOnly = selectedSets.length === 0 && owned.some((set) => set.attributionReview === "review");
                const alternatives = owned.filter((set) => !selectedSets.some((chosen) => chosen.id === set.id));
                let total = 0;
                let counted = 0;
                const stored = round.roundScores.find((score) => score.participantId === person.id);
                return (
                  <tr key={person.id} className="border-t border-zinc-100 align-top">
                    <th className="sticky left-0 bg-white px-2 py-2 text-left font-medium">
                      {person.name}
                      <input name={`revision_${person.id}`} type="hidden" value={revisionToken(selected?.updatedAt ?? null)} />
                      {slip ? <div className="text-xs font-normal text-zinc-600">{slip.label}</div> : null}
                      {reviewOnly ? <div className="text-xs text-amber-700">Owner needs review. Not in the stored total yet.</div> : null}
                      {selected && selected.attributionMethod !== "author" ? (
                        <div className="mt-1 max-w-56 text-xs font-normal text-zinc-600">
                          {selected.attributionReview === "probable" ? "Probable" : selected.attributionReview === "review" ? "Review" : "Explicit"}
                          : {selected.attributionEvidence}
                          {selected.forumComment ? (
                            <a className="mt-1 block text-zinc-800 underline" href={selected.forumComment.sourceUrl}>
                              Source comment
                            </a>
                          ) : null}
                          <label className="mt-1 block">
                            Owner
                            <select name={`owner_${selected.id}`} defaultValue={person.id} className={`${fieldClass} mt-1`}>
                              {roster.map((option) => (
                                <option key={option.id} value={option.id}>{option.name}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ) : null}
                    </th>
                    {fixtures.map((match) => {
                      const cell = slip?.cells.find((item) => item.matchId === match.id);
                      const cellReview = cell?.state === "review";
                      const prediction = cell?.state === "selected"
                        ? { homeGoals: cell.home, awayGoals: cell.away, ignored: false, markedAsMt: false }
                        : selected?.predictions.find((item) => item.matchId === match.id);
                      const missing = cellReview || !prediction || prediction.ignored || prediction.homeGoals == null || prediction.awayGoals == null;
                      const predicted = missing ? null : { home: prediction.homeGoals as number, away: prediction.awayGoals as number };
                      const scored = !cellReview && match.actualHomeGoals != null && match.actualAwayGoals != null && !reviewOnly
                        ? scoreMatch({
                            matchId: match.id,
                            actual: { home: match.actualHomeGoals, away: match.actualAwayGoals },
                            predicted,
                            isMatchOfTheRound: match.isMatchOfTheRound,
                          })
                        : null;
                      if (scored && match.confidence === "verified") {
                        total += scored.finalMatchPoints;
                        counted += 1;
                      }
                      const picks = alternatives.flatMap((set) => {
                        const candidate = set.predictions.find((item) => item.matchId === match.id && item.homeGoals != null && item.awayGoals != null && !item.ignored);
                        return candidate ? [`${candidate.homeGoals}-${candidate.awayGoals}`] : [];
                      });
                      return (
                        <td key={match.id} className="px-2 py-2">
                          <input
                            name={`score_${person.id}_${match.id}`}
                            defaultValue={cellReview ? "" : cellText(prediction?.homeGoals, prediction?.awayGoals, prediction?.ignored)}
                            placeholder="missing"
                            className={`${fieldClass} w-16`}
                          />
                          {picks.length > 0 ? (
                            <select name={`pick_${person.id}_${match.id}`} defaultValue="" className={`${fieldClass} mt-1 w-24`}>
                              <option value="">Typed score</option>
                              {[...new Set(picks)].map((pick) => (
                                <option key={pick} value={pick}>{pick} candidate</option>
                              ))}
                            </select>
                          ) : null}
                          <div className="text-xs text-zinc-500">
                            {cellReview
                              ? "conflict"
                              : match.confidence !== "verified"
                                ? "prospective"
                                : reviewOnly
                                  ? "review"
                                  : scored
                                    ? `${scored.finalMatchPoints}`
                                    : "no result"}
                            {prediction?.markedAsMt && !match.isMatchOfTheRound ? " · text says MT" : ""}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right tabular-nums">
                      {reviewOnly ? "review" : confirmed && counted === fixtures.length ? total : stored ? `stored ${stored.totalPoints}` : "preliminary"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <SubmitButton name="intent" value="save" pendingLabel="Saving…">Save corrections</SubmitButton>
          <SubmitButton name="intent" value="recalculate" pendingLabel="Saving…">Save and recalculate round</SubmitButton>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          A missing ordinary fixture is −1. A missing Match of the Round is −2, already multiplied once. Eight missing fixtures with one Match of the Round are −9. Open fixtures stay prospective until they are verified.
        </p>
      </form>
      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
        {round.status === ROUND_STATUS_STALE ? (
          <p className="text-red-700">Расчёт устарел. Экспорт не является текущим.</p>
        ) : includedCount === 0 ? (
          <p>Пока нет подтверждённых завершённых матчей.</p>
        ) : (
          <p>
            Рассчитано по {includedCount} из {round.matches.length} матчей
            {calculatedAt ? ` · ${formatMoscow(calculatedAt)}` : ""}.
            {includedCount < round.matches.length ? " Бонус тура ждёт все матчи." : ""}
          </p>
        )}
        {excluded.length > 0 ? (
          <p className="mt-1 text-xs text-zinc-500">
            Не включены: {excluded.flatMap((fixture) => (isFixtureExclusion(fixture.klass) ? [`${fixture.label} (${exclusionLabel(fixture.klass)})`] : [])).join("; ")}
          </p>
        ) : null}
        <CalculateIntermediateButton roundId={round.id} />
      </div>
    </Section>
  );
}
