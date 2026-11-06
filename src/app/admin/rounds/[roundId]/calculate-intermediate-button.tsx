"use client";

import { useState } from "react";
import { hasUnsavedFieldEdits, type FieldSnapshot } from "@/lib/domain/results/refresh-status";
import { SubmitButton } from "../../submit-button";
import { calculateIntermediateAction } from "./actions";

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

export function CalculateIntermediateButton({ roundId }: { roundId: string }) {
  const [blocked, setBlocked] = useState<string | null>(null);
  return (
    <form
      action={calculateIntermediateAction}
      className="mt-3"
      onSubmit={(event) => {
        const fields = [...document.querySelectorAll("input, textarea, select")]
          .filter((field) => field instanceof HTMLElement && field.closest("form") !== event.currentTarget)
          .map(snapshot);
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
