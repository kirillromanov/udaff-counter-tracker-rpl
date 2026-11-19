/**
 * A fixture prediction is eligible only when its source publication instant
 * is strictly before the stored kickoff instant.
 * Fetch time and row creation time are not inputs.
 * Comment permalinks are stored as UTC with no zone conversion.
 * Kickoffs are Moscow wall times stored as UTC. This comparison uses those
 * stored instants and does not apply a second offset.
 */
export type FixtureDeadline = "eligible" | "late" | "unknown";

export function fixtureDeadline(publicationAt: Date | null, kickoffAt: Date | null): FixtureDeadline {
  if (publicationAt == null || kickoffAt == null) {
    return "unknown";
  }
  return publicationAt.getTime() < kickoffAt.getTime() ? "eligible" : "late";
}

export const EDIT_TIME_UNKNOWN_NOTE =
  "Forum comment text changed without a reliable edit timestamp. Stored predictions were left in place.";

export const EDIT_AFTER_KICKOFF_NOTE =
  "Forum comment text changed at or after a fixture kickoff. Earlier eligible predictions were left in place.";

/** Which incoming fixture rows an edited comment may replace. Omitted fixtures are never cleared. */
export function editWritePlan(input: {
  editedAt: Date | null;
  fixtures: readonly { id: string; kickoffAt: Date | null }[];
  incomingMatchIds: readonly string[];
}): { writeMatchIds: string[]; note: string | null } {
  if (input.editedAt == null) {
    return { writeMatchIds: [], note: EDIT_TIME_UNKNOWN_NOTE };
  }
  const kickoff = new Map(input.fixtures.map((fixture) => [fixture.id, fixture.kickoffAt]));
  const writeMatchIds: string[] = [];
  let refused = false;
  for (const matchId of input.incomingMatchIds) {
    const decision = fixtureDeadline(input.editedAt, kickoff.get(matchId) ?? null);
    if (decision === "eligible") {
      writeMatchIds.push(matchId);
    } else {
      refused = true;
    }
  }
  return { writeMatchIds, note: refused ? EDIT_AFTER_KICKOFF_NOTE : null };
}
