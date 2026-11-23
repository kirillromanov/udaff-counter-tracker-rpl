"use client";

import { useRef, useState, type FormEvent } from "react";
import { LABEL_MANUAL_NOT_VERIFIED } from "@/lib/domain/results/result-label";
import {
  authoritativeScoreChanges,
  draftLockLabel,
  formatDraftScore,
  type ScoreDraftRow,
} from "@/lib/domain/results/score-draft";
import type { RankableObservation } from "@/lib/domain/results/ranking";
import { buttonClass } from "../../../ui";
import { saveActualResultsAction } from "../actions";

export interface ScoreBlockRow {
  id: string;
  version: number;
  homeTeam: string;
  awayTeam: string;
  isMatchOfTheRound: boolean;
  storedHome: number | null;
  storedAway: number | null;
  storedFixed: boolean;
  legacy: boolean;
  verifiedForStandings: boolean;
  editable: boolean;
  storedLabel: string;
  automaticHome: number | null;
  automaticAway: number | null;
  automaticLabel: string;
  observations: RankableObservation[];
  sources: { source: string; score: string; seen: string }[];
}

interface Draft {
  on: boolean;
  home: string;
  away: string;
}

function textOf(value: number | null): string {
  return value == null ? "" : String(value);
}

function parseGoal(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return parsed > 20 ? null : parsed;
}

export function ResultScoreBlock({
  roundId,
  rows,
  justSaved,
}: {
  roundId: string;
  rows: ScoreBlockRow[];
  justSaved: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(rows.map((row) => [row.id, {
    on: row.storedFixed,
    home: textOf(row.storedHome),
    away: textOf(row.storedAway),
  }])));
  const [sourcesFor, setSourcesFor] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [standing, setStanding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sent = useRef(false);

  function draftOf(row: ScoreBlockRow): Draft {
    return drafts[row.id] ?? { on: row.storedFixed, home: textOf(row.storedHome), away: textOf(row.storedAway) };
  }

  function shown(row: ScoreBlockRow): { home: string; away: string } {
    const draft = draftOf(row);
    if (!draft.on) {
      return { home: textOf(row.automaticHome), away: textOf(row.automaticAway) };
    }
    return { home: draft.home, away: draft.away };
  }

  function labelOf(row: ScoreBlockRow): string {
    const draft = draftOf(row);
    if (!draft.on) {
      return row.storedFixed ? row.automaticLabel : row.storedLabel;
    }
    const home = parseGoal(draft.home);
    const away = parseGoal(draft.away);
    const legacyUnchanged = row.legacy && home === row.storedHome && away === row.storedAway;
    return draftLockLabel(home, away, row.observations, legacyUnchanged);
  }

  function plannerRows(): ScoreDraftRow[] {
    return rows.filter((row) => row.editable).map((row) => {
      const draft = draftOf(row);
      const visible = shown(row);
      return {
        id: row.id,
        name: `${row.homeTeam} — ${row.awayTeam}`,
        storedHome: row.storedHome,
        storedAway: row.storedAway,
        verifiedForStandings: row.verifiedForStandings,
        draftFixed: draft.on,
        draftHome: draft.on ? parseGoal(visible.home) : row.automaticHome,
        draftAway: draft.on ? parseGoal(visible.away) : row.automaticAway,
        automaticHome: row.automaticHome,
        automaticAway: row.automaticAway,
      };
    });
  }

  const changes = plannerRows().flatMap((row) => {
    const source = rows.find((item) => item.id === row.id);
    const draft = source ? draftOf(source) : null;
    if (draft?.on && (row.draftHome == null || row.draftAway == null)) {
      return [];
    }
    return authoritativeScoreChanges([row]);
  });
  const needsStanding = changes.some((change) => change.needsStandingConfirm);
  const dirty = rows.some((row) => {
    const draft = draftOf(row);
    if (draft.on !== row.storedFixed) {
      return true;
    }
    if (!draft.on) {
      return false;
    }
    return parseGoal(draft.home) !== row.storedHome || parseGoal(draft.away) !== row.storedAway;
  });

  function update(row: ScoreBlockRow, next: Partial<Draft>): void {
    setAsk(false);
    setProblem(null);
    setDrafts((current) => {
      const previous = current[row.id] ?? { on: row.storedFixed, home: textOf(row.storedHome), away: textOf(row.storedAway) };
      const merged = { ...previous, ...next };
      if (next.on && !previous.on) {
        const visible = shown(row);
        merged.home = visible.home;
        merged.away = visible.away;
      }
      return { ...current, [row.id]: merged };
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    if (sent.current) {
      event.preventDefault();
      return;
    }
    const invalid = rows.some((row) => {
      const draft = draftOf(row);
      return draft.on && row.editable && (parseGoal(draft.home) == null || parseGoal(draft.away) == null);
    });
    if (invalid) {
      event.preventDefault();
      setProblem("Enter a whole number from 0 to 20 for each fixed score.");
      return;
    }
    if (changes.length > 0 && !ask) {
      event.preventDefault();
      setAsk(true);
      setStanding(false);
      return;
    }
    if (ask && needsStanding && !standing) {
      event.preventDefault();
      setProblem("Confirm that standings should use the corrected scores.");
      return;
    }
    sent.current = true;
    setSaving(true);
  }

  function cancel(): void {
    setAsk(false);
    setStanding(false);
    setProblem(null);
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <form action={saveActualResultsAction} className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5" onSubmit={onSubmit}>
      <input name="roundId" type="hidden" value={roundId} />
      <p className="mb-2 text-sm text-zinc-800">Off shows the automatic source result. On keeps a manually fixed score.</p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => {
          const draft = draftOf(row);
          const visible = shown(row);
          const label = labelOf(row);
          const warning = label === LABEL_MANUAL_NOT_VERIFIED;
          const name = `${row.homeTeam} — ${row.awayTeam}`;
          return (
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5" key={row.id}>
              <input name="matchId" type="hidden" value={row.id} />
              <input name={`fixed_${row.id}`} type="hidden" value={draft.on ? "yes" : "no"} />
              <input name={`home_${row.id}`} type="hidden" value={visible.home} />
              <input name={`away_${row.id}`} type="hidden" value={visible.away} />
              <input name={`version_${row.id}`} type="hidden" value={row.version} />
              <p className="min-w-48 flex-1 text-sm leading-tight text-zinc-900">
                {name}
                {row.isMatchOfTheRound ? " МТ" : ""}
                {" "}
                <span className={warning ? "text-xs text-red-700" : "text-xs text-zinc-500"}>{label}</span>
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <input
                  aria-label={`Fix score for ${name}`}
                  checked={draft.on}
                  className="h-4 w-4 shrink-0"
                  disabled={!row.editable}
                  onChange={(event) => update(row, { on: event.target.checked })}
                  role="switch"
                  type="checkbox"
                />
                <input
                  aria-label={`${name} home`}
                  className="w-12 shrink-0 rounded border border-zinc-300 bg-white px-1 py-0.5 text-center text-sm"
                  inputMode="numeric"
                  onChange={(event) => update(row, { home: event.target.value })}
                  readOnly={!draft.on || !row.editable}
                  value={visible.home}
                />
                <input
                  aria-label={`${name} away`}
                  className="w-12 shrink-0 rounded border border-zinc-300 bg-white px-1 py-0.5 text-center text-sm"
                  inputMode="numeric"
                  onChange={(event) => update(row, { away: event.target.value })}
                  readOnly={!draft.on || !row.editable}
                  value={visible.away}
                />
                <div className="relative shrink-0">
                  <button
                    aria-expanded={sourcesFor === row.id}
                    className="text-xs text-zinc-600 underline"
                    onClick={() => setSourcesFor((current) => current === row.id ? null : row.id)}
                    type="button"
                  >
                    Sources
                  </button>
                  {sourcesFor === row.id ? (
                    <div aria-label={`Sources for ${name}`} className="absolute right-0 z-10 mt-1 w-52 rounded border border-zinc-200 bg-white p-2 text-xs text-zinc-700 shadow" role="dialog">
                      {row.sources.length === 0 ? <p>No source rows stored.</p> : row.sources.map((source) => (
                        <p key={`${source.source}-${source.score}`}>{source.source} {source.score} · {source.seen}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button className={buttonClass("primary")} disabled={!dirty || saving} type="submit">Save actual results</button>
        <span className="text-xs text-zinc-600">{dirty ? "Unsaved" : justSaved ? "Saved" : ""}</span>
      </div>
      {problem ? <p className="mt-1 text-xs text-red-700">{problem}</p> : null}
      {ask ? (
        <div aria-modal="true" className="mt-2 rounded border border-zinc-300 bg-white p-2 text-sm" role="dialog" aria-label="Confirm score changes">
          <p>These scores will change:</p>
          <ul className="my-1 list-disc pl-4">
            {changes.map((change) => (
              <li key={change.id}>
                {change.name}: {formatDraftScore(change.previousHome, change.previousAway)} → {formatDraftScore(change.nextHome, change.nextAway)}
              </li>
            ))}
          </ul>
          {needsStanding ? (
            <label className="mt-1 flex items-start gap-2 text-sm">
              <input
                checked={standing}
                className="mt-0.5"
                name="standingChange"
                onChange={(event) => setStanding(event.target.checked)}
                type="checkbox"
                value="yes"
              />
              I confirm standings should use these corrected scores.
            </label>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button className={buttonClass()} onClick={cancel} type="button">Cancel</button>
            <button className={buttonClass("primary")} disabled={saving} type="submit">Save actual results</button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
