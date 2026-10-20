import type { Movement } from "./types";

/**
 * Rank 1 is first place. A smaller rank number is an improvement.
 * `new` means there is no previous ranking to compare.
 */
export function rankMovement(rank: number, previousRank: number | null): Movement {
  if (previousRank == null) {
    return "new";
  }
  if (rank < previousRank) {
    return "up";
  }
  if (rank > previousRank) {
    return "down";
  }
  return "same";
}
