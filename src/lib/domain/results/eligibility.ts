/**
 * Result verification is scoped to one season and one starting round.
 * Another season's round 16 is not included. Database ids are not used.
 */
export const RESULT_VERIFICATION_SEASON_SLUG = "rpl-demo-2026";
export const RESULT_VERIFICATION_FIRST_ROUND = 16;

export function resultVerificationApplies(round: { seasonSlug: string; number: number }): boolean {
  return round.seasonSlug === RESULT_VERIFICATION_SEASON_SLUG && round.number >= RESULT_VERIFICATION_FIRST_ROUND;
}

export class ResultScopeError extends Error {
  constructor() {
    super("Result verification starts at round 16 of this season. Earlier rounds keep their stored results.");
    this.name = "ResultScopeError";
  }
}
