export type MembershipState = "absent" | "included" | "excluded";
export type RosterAction = "include" | "exclude";

export interface RosterDecision {
  membership: MembershipState;
  error: string | null;
}

export function applyRosterAction(input: {
  archived: boolean;
  membership: MembershipState;
  action: RosterAction;
}): RosterDecision {
  if (input.action === "exclude") {
    if (input.membership === "absent") {
      return { membership: "absent", error: "This participant is not on the season roster" };
    }
    return { membership: "excluded", error: null };
  }
  if (input.archived) {
    return {
      membership: input.membership,
      error: "Restore the participant before including them in a season",
    };
  }
  return { membership: "included", error: null };
}

export function isActiveInSeason(input: { archived: boolean; membership: MembershipState }): boolean {
  return !input.archived && input.membership === "included";
}

export function canPermanentlyDelete(history: {
  predictionSets: number;
  roundScores: number;
  snapshots: number;
}): boolean {
  return history.predictionSets === 0 && history.roundScores === 0 && history.snapshots === 0;
}
