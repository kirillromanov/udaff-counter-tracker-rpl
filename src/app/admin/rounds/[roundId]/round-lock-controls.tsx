"use client";

import { useState } from "react";
import { buttonClass } from "../../ui";
import { closeRoundAction, reopenRoundAction } from "./workflow-actions";

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
].join("\n\n");

function unsavedEdits(): boolean {
  for (const form of document.forms) {
    for (const element of form.elements) {
      if (element instanceof HTMLInputElement) {
        if (element.type === "hidden" || element.type === "submit" || element.type === "button") {
          continue;
        }
        if (element.type === "checkbox" || element.type === "radio") {
          if (element.checked !== element.defaultChecked) {
            return true;
          }
          continue;
        }
        if (element.value !== element.defaultValue) {
          return true;
        }
      }
      if (element instanceof HTMLTextAreaElement && element.value !== element.defaultValue) {
        return true;
      }
      if (element instanceof HTMLSelectElement) {
        const selected = [...element.options].some((option) => option.selected !== option.defaultSelected);
        if (selected) {
          return true;
        }
      }
    }
  }
  return false;
}

export function RoundLockControls({
  roundId,
  closed,
  warning,
}: {
  roundId: string;
  closed: boolean;
  warning: string | null;
}) {
  const [blocked, setBlocked] = useState<string | null>(null);

  if (closed) {
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

  return (
    <form
      action={closeRoundAction}
      onSubmit={(event) => {
        if (unsavedEdits()) {
          event.preventDefault();
          setBlocked("Save or cancel the open edits before closing this round.");
          return;
        }
        const message = warning ? `${CLOSE_TEXT}\n\n${warning}` : CLOSE_TEXT;
        if (!window.confirm(`Close round?\n\n${message}`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="roundId" type="hidden" value={roundId} />
      <button className={buttonClass("secondary")} type="submit">
        Close round
      </button>
      {blocked ? <p className="mt-2 text-sm text-amber-800">{blocked}</p> : null}
    </form>
  );
}
