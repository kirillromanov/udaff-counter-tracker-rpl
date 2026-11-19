export interface RefreshQuery {
  refreshed?: string;
  busy?: string;
  updated?: string;
  conflicts?: string;
  failed?: string;
  sourceOk?: string;
  calc?: string;
  included?: string;
  fixtureCount?: string;
  intermediate?: string;
}

export interface SelectOptionSnapshot {
  value: string;
  defaultSelected?: boolean;
}

export interface FieldSnapshot {
  ignored?: boolean;
  type?: string;
  value?: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  options?: readonly SelectOptionSnapshot[];
}

const MISSING_TEXT = new Set(["", "—", "-"]);

/** Empty, null, and the matrix placeholders are the same saved missing prediction. */
export function canonicalEditableText(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return MISSING_TEXT.has(text) ? "" : text;
}

function savedSelectValue(field: FieldSnapshot): string {
  const marked = field.options?.find((option) => option.defaultSelected);
  if (marked) {
    return marked.value;
  }
  if (field.options && field.options.length > 0) {
    return field.options[0]?.value ?? "";
  }
  return field.defaultValue ?? "";
}

export function hasUnsavedFieldEdits(fields: readonly FieldSnapshot[]): boolean {
  return fields.some((field) => {
    if (field.ignored || field.type === "hidden" || field.type === "submit" || field.type === "button") {
      return false;
    }
    if (field.type === "checkbox" || field.type === "radio") {
      return field.checked !== field.defaultChecked;
    }
    if (field.type === "select" || field.options) {
      return (field.value ?? "") !== savedSelectValue(field);
    }
    return canonicalEditableText(field.value) !== canonicalEditableText(field.defaultValue);
  });
}

export function snapshotFormControl(element: Element | RadioNodeList): FieldSnapshot {
  if (!(element instanceof HTMLElement)) {
    return { ignored: true };
  }
  if (element instanceof HTMLInputElement) {
    return {
      type: element.type,
      value: element.value,
      defaultValue: element.defaultValue,
      checked: element.checked,
      defaultChecked: element.defaultChecked,
    };
  }
  if (element instanceof HTMLTextAreaElement) {
    return { value: element.value, defaultValue: element.defaultValue };
  }
  if (element instanceof HTMLSelectElement) {
    return {
      type: "select",
      value: element.value,
      options: [...element.options].map((option) => ({
        value: option.value,
        defaultSelected: option.defaultSelected,
      })),
    };
  }
  return { ignored: true };
}

/**
 * A completed attempt is not the same as a successful source check,
 * and a successful check is not the same as a stored score change.
 * Every source failing keeps the previous scores and is not shown as an update.
 */
export function describeRefreshQuery(query: RefreshQuery): { tone: "error" | "success" | "info" | "warning"; text: string } | null {
  if (query.busy === "1") {
    return { tone: "info", text: "A refresh for this round is already running. Stored results were left unchanged." };
  }
  if (query.refreshed !== "1") {
    return null;
  }
  const failed = Number(query.failed ?? 0);
  const ok = Number(query.sourceOk ?? 0);
  const updated = Number(query.updated ?? 0);
  const conflicts = Number(query.conflicts ?? 0);
  if (ok === 0 && failed > 0) {
    return { tone: "error", text: `Sources failed (${failed}). Stored results were left unchanged.` };
  }
  if (conflicts > 0) {
    return {
      tone: "warning",
      text: `Source check completed. ${updated} fixtures updated, ${conflicts} conflicts still need review. Manual scores were kept.`,
    };
  }
  if (updated === 0) {
    return { tone: "success", text: "Source check completed. Stored scores were unchanged." };
  }
  return { tone: "success", text: `Source check completed. ${updated} fixtures updated.` };
}
