/**
 * Selected slips are scored as submitted, with a miss for each fixture they
 * omit. A roster participant with no slip is scored as missing every fixture.
 * An unresolved owner block is not treated as a confirmed blank slip.
 */
export function rosterIdsToScore(input: {
  rosterIds: string[];
  selectedIds: string[];
  unresolvedIds: string[];
}): string[] {
  const selected = new Set(input.selectedIds);
  const unresolved = new Set(input.unresolvedIds.filter((id) => !selected.has(id)));
  const ids = [...selected];
  for (const id of input.rosterIds) {
    if (!selected.has(id) && !unresolved.has(id)) {
      ids.push(id);
    }
  }
  return ids;
}
