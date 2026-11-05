export interface SelectableSet {
  id: string;
  participantId: string;
  postedAt: Date | null;
  valid: boolean;
  /**
   * An incomplete slip that still has scored lines. Used only when the
   * participant has no complete valid set and no manual selection.
   */
  provisional?: boolean;
  selection: "auto" | "manual";
  selected: boolean;
}

function latest(sets: SelectableSet[]): SelectableSet {
  return [...sets].sort((left, right) => {
    const leftTime = left.postedAt?.getTime() ?? 0;
    const rightTime = right.postedAt?.getTime() ?? 0;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return right.id.localeCompare(left.id);
  })[0] as SelectableSet;
}

/**
 * One selected set per participant.
 * A manually chosen set stays selected. Otherwise the latest valid set is used.
 * A set is valid when it contains at least one active scored prediction.
 */
export function resolveSelections(sets: SelectableSet[]): string[] {
  const groups = new Map<string, SelectableSet[]>();
  for (const set of sets) {
    const group = groups.get(set.participantId) ?? [];
    group.push(set);
    groups.set(set.participantId, group);
  }

  const chosen: string[] = [];
  for (const group of groups.values()) {
    const manual = group.filter((set) => set.selection === "manual" && set.selected);
    if (manual.length > 0) {
      chosen.push(latest(manual).id);
      continue;
    }
    const valid = group.filter((set) => set.valid);
    if (valid.length > 0) {
      chosen.push(latest(valid).id);
      continue;
    }
    const provisional = group.filter((set) => set.provisional);
    if (provisional.length > 0) {
      chosen.push(latest(provisional).id);
    }
  }
  return chosen;
}
