export interface SelectableSet {
  id: string;
  participantId: string;
  postedAt: Date | null;
  valid: boolean;
  /**
   * A scored slip that is not clean enough to merge. Used only when the
   * participant has no valid set and no manual selection.
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
 * Manual choice stays one set and is not mixed with later imports.
 * Otherwise every valid comment stays selected so partial slips can be merged
 * by fixture. A valid set has at least one clean scored prediction.
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
      chosen.push(...valid.map((set) => set.id).sort());
      continue;
    }
    const provisional = group.filter((set) => set.provisional);
    if (provisional.length > 0) {
      chosen.push(latest(provisional).id);
    }
  }
  return chosen;
}
