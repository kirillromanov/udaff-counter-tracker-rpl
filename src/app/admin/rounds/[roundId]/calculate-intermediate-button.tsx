"use client";

import { useState } from "react";
import { hasUnsavedFieldEdits, snapshotFormControl } from "@/lib/domain/results/refresh-status";
import { SubmitButton } from "../../submit-button";
import { calculateIntermediateAction } from "./actions";

export function CalculateIntermediateButton({ roundId }: { roundId: string }) {
  const [blocked, setBlocked] = useState<string | null>(null);
  return (
    <form
      action={calculateIntermediateAction}
      className="mt-3"
      onSubmit={(event) => {
        const fields = [...document.querySelectorAll("input, textarea, select")]
          .filter((field) => field instanceof HTMLElement && field.closest("form") !== event.currentTarget)
          .map(snapshotFormControl);
        if (hasUnsavedFieldEdits(fields)) {
          event.preventDefault();
          setBlocked("Save or cancel unsaved edits before calculating intermediate results.");
          return;
        }
        setBlocked(null);
      }}
    >
      <input name="roundId" type="hidden" value={roundId} />
      <SubmitButton pendingLabel="Расчёт…" variant="primary">
        Рассчитать промежуточные результаты
      </SubmitButton>
      {blocked ? <p className="mt-2 text-sm text-amber-800">{blocked}</p> : null}
    </form>
  );
}
