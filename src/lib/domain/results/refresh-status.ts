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

export interface FieldSnapshot {
  ignored?: boolean;
  type?: string;
  value?: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
}

export function hasUnsavedFieldEdits(fields: readonly FieldSnapshot[]): boolean {
  return fields.some((field) => {
    if (field.ignored || field.type === "hidden" || field.type === "submit" || field.type === "button") {
      return false;
    }
    if (field.type === "checkbox" || field.type === "radio") {
      return field.checked !== field.defaultChecked;
    }
    return field.value !== field.defaultValue;
  });
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
