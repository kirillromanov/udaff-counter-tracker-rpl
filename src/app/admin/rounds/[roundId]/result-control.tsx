import { SubmitButton } from "@/app/admin/submit-button";
import { fieldClass } from "@/app/admin/ui";
import { correctionAllowed, displayedResultLabel } from "@/lib/domain/results/correction";
import { fixturePhase, fixturePhaseLabel, type PollFixture } from "@/lib/domain/results/poll";
import { confirmFixtureResultAction, rollbackFixtureResultAction } from "./workflow-actions";

export function ResultControl({
  roundId,
  closed,
  archived,
  now,
  match,
  sources,
}: {
  roundId: string;
  closed: boolean;
  archived: boolean;
  now: Date;
  match: PollFixture & {
    id: string;
    homeTeam: string;
    awayTeam: string;
    resultProvenance: string;
    manuallyCorrected: boolean;
    resultVersion: number;
    resultNote: string | null;
  };
  sources: { source: string; homeGoals: number; awayGoals: number; firstSeenAt: Date | null; lastSeenAt: Date | null }[];
}) {
  const phase = fixturePhase(match, now);
  const legacy = fixturePhaseLabel(phase, match.conflictAcknowledgedAt != null);
  const label = displayedResultLabel(match, legacy);
  const offered = !closed && !archived && correctionAllowed(phase);
  const caseB = match.resultState === "verified" || match.resultResolution === "verified" || match.manuallyCorrected || match.resultState === "manual";
  return (
    <div className="mt-3 rounded-md border border-zinc-200 p-3">
      <p className="text-sm font-medium text-zinc-950">
        Status: {label}
        {match.manuallyCorrected || match.resultProvenance === "manual" ? " Marker: manually corrected." : ""}
      </p>
      {sources.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-zinc-600">
          {sources.map((source) => (
            <li key={source.source}>
              {source.source}: {source.homeGoals}-{source.awayGoals}
              {source.firstSeenAt ? `, first ${source.firstSeenAt.toISOString()}` : ", first seen not stored"}
              {source.lastSeenAt ? `, last ${source.lastSeenAt.toISOString()}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">No per-source result is stored for this fixture.</p>
      )}
      {offered ? (
        <form action={confirmFixtureResultAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="roundId" type="hidden" value={roundId} />
          <input name="matchId" type="hidden" value={match.id} />
          <input name="version" type="hidden" value={match.resultVersion} />
          <p className="sm:col-span-2 text-xs text-zinc-600">
            {match.homeTeam} — {match.awayTeam}. Stored score {match.actualHomeGoals ?? "none"}-{match.actualAwayGoals ?? "none"}.
            Submitting sets status to verified and marks it manually corrected.
            {caseB ? " The standings checkbox is required only when the score changes." : ""}
            Recalculation runs once only if the score changes.
          </p>
          <label className="text-xs font-medium text-zinc-700">
            Home goals
            <input aria-label={`${match.homeTeam} home goals`} className={`${fieldClass} mt-1 w-full`} defaultValue={match.actualHomeGoals ?? ""} inputMode="numeric" name="homeGoals" />
          </label>
          <label className="text-xs font-medium text-zinc-700">
            Away goals
            <input aria-label={`${match.awayTeam} away goals`} className={`${fieldClass} mt-1 w-full`} defaultValue={match.actualAwayGoals ?? ""} inputMode="numeric" name="awayGoals" />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-zinc-700">
            Reason, optional
            <input className={`${fieldClass} mt-1 w-full`} name="reason" />
          </label>
          {caseB ? (
            <label className="sm:col-span-2 flex items-start gap-2 text-sm text-zinc-800">
              <input className="mt-1" name="standingChange" type="checkbox" value="yes" />
              I confirm this corrected score should be used in the standings.
            </label>
          ) : null}
          <SubmitButton pendingLabel="Saving…">Verify this score</SubmitButton>
        </form>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">
          {closed || archived ? "This round is locked for result correction." : "A score can be verified only after the fixture is finished."}
        </p>
      )}
      {offered && (match.manuallyCorrected || match.resultProvenance === "manual") ? (
        <form action={rollbackFixtureResultAction} className="mt-3 grid gap-2">
          <input name="roundId" type="hidden" value={roundId} />
          <input name="matchId" type="hidden" value={match.id} />
          <input name="version" type="hidden" value={match.resultVersion} />
          <p className="text-xs text-zinc-600">
            Removing the marker recomputes the score from the stored sources and does not fetch them. The next ordinary result check can run later.
          </p>
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input className="mt-1" name="confirmRollback" type="checkbox" value="yes" />
            I confirm the return to automatic confirmation.
          </label>
          <label className="text-xs font-medium text-zinc-700">
            Reason, optional
            <input className={`${fieldClass} mt-1 w-full`} name="reason" />
          </label>
          <SubmitButton pendingLabel="Removing…" variant="secondary">Remove manual correction</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
