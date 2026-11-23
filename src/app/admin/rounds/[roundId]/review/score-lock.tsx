"use client";

import { useState } from "react";
import { SubmitButton } from "../../../submit-button";
import { fieldClass } from "../../../ui";
import { setFixtureScoreLockAction } from "../actions";

export function ScoreLockRow({
  roundId,
  matchId,
  version,
  homeTeam,
  awayTeam,
  home,
  away,
  fixed,
  label,
  warning,
  sources,
  editable,
  lockedReason,
  needsStandingConfirm,
}: {
  roundId: string;
  matchId: string;
  version: number;
  homeTeam: string;
  awayTeam: string;
  home: number | null;
  away: number | null;
  fixed: boolean;
  label: string;
  warning: boolean;
  sources: { source: string; score: string; seen: string }[];
  editable: boolean;
  lockedReason: string | null;
  needsStandingConfirm: boolean;
}) {
  const [on, setOn] = useState(fixed);
  const [homeText, setHomeText] = useState(home == null ? "" : String(home));
  const [awayText, setAwayText] = useState(away == null ? "" : String(away));
  const changed = homeText.trim() !== (home == null ? "" : String(home)) || awayText.trim() !== (away == null ? "" : String(away));
  return (
    <form action={setFixtureScoreLockAction} className="rounded-md border border-zinc-200 bg-white p-3">
      <input name="roundId" type="hidden" value={roundId} />
      <input name="matchId" type="hidden" value={matchId} />
      <input name="version" type="hidden" value={version} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-zinc-950">
            {homeTeam} — {awayTeam}
          </p>
          <p className={`text-sm ${warning ? "font-semibold text-red-700" : "text-zinc-700"}`}>
            {warning ? "! " : ""}
            {label}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-900">
          <input
            checked={on}
            className="h-4 w-4"
            disabled={!editable}
            name="fixed"
            onChange={(event) => {
              const next = event.target.checked;
              setOn(next);
              if (!next && fixed) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
            type="checkbox"
            value="yes"
          />
          Fix score
        </label>
        <div className="flex gap-2">
          <label className="text-xs font-medium text-zinc-700">
            Home
            <input
              aria-label={`${homeTeam} home goals`}
              className={`${fieldClass} mt-1 w-16`}
              inputMode="numeric"
              name="homeGoals"
              onChange={(event) => setHomeText(event.target.value)}
              readOnly={!on || !editable}
              value={homeText}
            />
          </label>
          <label className="text-xs font-medium text-zinc-700">
            Away
            <input
              aria-label={`${awayTeam} away goals`}
              className={`${fieldClass} mt-1 w-16`}
              inputMode="numeric"
              name="awayGoals"
              onChange={(event) => setAwayText(event.target.value)}
              readOnly={!on || !editable}
              value={awayText}
            />
          </label>
        </div>
        {lockedReason ? <p className="text-xs text-zinc-600">{lockedReason}</p> : null}
        {on && editable && needsStandingConfirm && changed ? (
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input className="mt-1" name="standingChange" type="checkbox" value="yes" />
            I confirm this corrected score should be used in the standings.
          </label>
        ) : null}
        {on && editable ? <SubmitButton pendingLabel="Saving…">Save fixed score</SubmitButton> : null}
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer">Sources</summary>
          {sources.length === 0 ? <p className="mt-1">No per-source result is stored.</p> : (
            <ul className="mt-1 space-y-1">
              {sources.map((source) => (
                <li className="whitespace-nowrap" key={`${source.source}-${source.score}`}>
                  {source.source} {source.score} · {source.seen}
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </form>
  );
}
