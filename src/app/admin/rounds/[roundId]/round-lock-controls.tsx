"use client";

import { useState } from "react";
import { hasUnsavedFieldEdits, snapshotFormControl, type FieldSnapshot } from "@/lib/domain/results/refresh-status";
import { buttonClass } from "../../ui";
import { closeRoundAction, reopenRoundAction, startProductionAction } from "./workflow-actions";

const START_TEXT = [
  "Start production?",
  "This round becomes eligible for the existing automatic comment refresh and result checks.",
  "Nothing is fetched, parsed, or calculated now.",
  "The next check follows the current kickoff schedule and retry rules.",
  "Missing predictions do not need to be filled in.",
].join("\n\n");

const CLOSE_TEXT = [
  "Automatic and manual imports and result refreshes will stop.",
  "Editing and recalculation will be blocked.",
  "Saved data stays available for viewing and export.",
  "The round can be reopened if corrections are needed.",
].join("\n\n");

const REOPEN_TEXT = [
  "Editing and normal operational scheduling are restored.",
  "This does not fetch sources or recalculate scores.",
  "Retry counters stay as they are.",
  "The round stays in production. Start production is not required again.",
].join("\n\n");

function unsavedEdits(): boolean {
  const fields: FieldSnapshot[] = [];
  for (const form of document.forms) {
    for (const element of form.elements) {
      fields.push(snapshotFormControl(element));
    }
  }
  return hasUnsavedFieldEdits(fields);
}

export function RoundLockControls({
  roundId,
  mode,
  warning,
}: {
  roundId: string;
  mode: "start" | "close" | "reopen";
  warning: string | null;
}) {
  const [blocked, setBlocked] = useState<string | null>(null);

  if (mode === "reopen") {
    return (
      <form
        action={reopenRoundAction}
        onSubmit={(event) => {
          if (!window.confirm(REOPEN_TEXT)) {
            event.preventDefault();
          }
        }}
      >
        <input name="roundId" type="hidden" value={roundId} />
        <button className={buttonClass("primary")} type="submit">
          Re-open production
        </button>
      </form>
    );
  }

  const starting = mode === "start";
  return (
    <form
      action={starting ? startProductionAction : closeRoundAction}
      onSubmit={(event) => {
        if (unsavedEdits()) {
          event.preventDefault();
          setBlocked(
            starting
              ? "Save or cancel the open edits before starting production."
              : "Save or cancel the open edits before closing this round.",
          );
          return;
        }
        const message = starting ? START_TEXT : warning ? `Close round?\n\n${CLOSE_TEXT}\n\n${warning}` : `Close round?\n\n${CLOSE_TEXT}`;
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      <input name="roundId" type="hidden" value={roundId} />
      <button className={buttonClass(starting ? "primary" : "secondary")} type="submit">
        {starting ? "Start production" : "Close round"}
      </button>
      {blocked ? <p className="mt-2 text-sm text-amber-800">{blocked}</p> : null}
    </form>
  );
}
