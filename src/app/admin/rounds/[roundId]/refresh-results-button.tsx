"use client";

import { useState } from "react";
import { hasUnsavedFieldEdits, type FieldSnapshot } from "@/lib/domain/results/refresh-status";
import { SubmitButton } from "../../submit-button";
import { refreshMatchResultsAction } from "./workflow-actions";

function snapshot(field: Element): FieldSnapshot {
  if (field instanceof HTMLInputElement) {
    return {
      type: field.type,
      value: field.value,
      defaultValue: field.defaultValue,
      checked: field.checked,
      defaultChecked: field.defaultChecked,
    };
  }
  if (field instanceof HTMLTextAreaElement) {
    return { value: field.value, defaultValue: field.defaultValue };
  }
  if (field instanceof HTMLSelectElement) {
    const initial = [...field.options].find((option) => option.defaultSelected)?.value ?? field.options[0]?.value ?? "";
    return { value: field.value, defaultValue: initial };
  }
  return { ignored: true };
}

export function RefreshResultsButton({ roundId, returnTo }: { roundId: string; returnTo: "review" | "fixtures" }) {
  const [blocked, setBlocked] = useState<string | null>(null);
  return (
    <form
      action={refreshMatchResultsAction}
      onSubmit={(event) => {
        const fields = [...document.querySelectorAll("input, textarea, select")]
          .filter((field) => field instanceof HTMLElement && field.closest("form") !== event.currentTarget)
          .map(snapshot);
        if (hasUnsavedFieldEdits(fields)) {
          event.preventDefault();
          setBlocked("Save or cancel unsaved edits before refreshing match results.");
          return;
        }
        setBlocked(null);
      }}
    >
      <input name="roundId" type="hidden" value={roundId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <SubmitButton pendingLabel="Обновление…" variant="primary">
        Обновить результаты матчей
      </SubmitButton>
      {blocked ? <p className="mt-2 text-sm text-amber-800">{blocked}</p> : null}
    </form>
  );
}
