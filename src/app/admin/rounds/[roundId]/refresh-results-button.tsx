"use client";

import { useState } from "react";
import { hasUnsavedFieldEdits, snapshotFormControl } from "@/lib/domain/results/refresh-status";
import { SubmitButton } from "../../submit-button";
import { refreshMatchResultsAction } from "./workflow-actions";

export function RefreshResultsButton({ roundId, returnTo }: { roundId: string; returnTo: "review" | "fixtures" }) {
  const [blocked, setBlocked] = useState<string | null>(null);
  return (
    <form
      action={refreshMatchResultsAction}
      onSubmit={(event) => {
        const fields = [...document.querySelectorAll("input, textarea, select")]
          .filter((field) => field instanceof HTMLElement && field.closest("form") !== event.currentTarget)
          .map(snapshotFormControl);
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
