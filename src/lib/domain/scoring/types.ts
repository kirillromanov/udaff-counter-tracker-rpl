export type Outcome = "home" | "draw" | "away";

export type BaseCategory = "exact" | "neighbor" | "diff" | "outcome" | "miss";

export type Movement = "up" | "down" | "same" | "new";

export interface Scoreline {
  home: number;
  away: number;
}

export interface MatchScoreInput {
  matchId: string;
  actual: Scoreline;
  predicted: Scoreline | null;
  isMatchOfTheRound: boolean;
}

export interface MatchScoreBreakdown {
  matchId: string;
  baseCategory: BaseCategory;
  basePoints: number;
  bonusPoints: number;
  /** Factor applied to this match. 1 when the Match of the Round multiplier is not used. */
  mtMultiplier: number;
  mtApplied: boolean;
  finalMatchPoints: number;
  explanations: string[];
}

export interface RoundScoreInput {
  roundId: string;
  participantId: string;
  matches: MatchScoreInput[];
}

export interface RoundScoreSummary {
  exactCount: number;
  neighborCount: number;
  diffCount: number;
  outcomeCount: number;
  missCount: number;
}

export interface RoundScoreResult {
  roundId: string;
  participantId: string;
  matches: MatchScoreBreakdown[];
  matchPointsTotal: number;
  roundTotalGoalsBonus: number;
  roundTotal: number;
  summary: RoundScoreSummary;
}

export interface SeasonParticipantInput {
  id: string;
  name: string;
}

export interface SeasonRoundScoreInput {
  participantId: string;
  points: number;
}

export interface SeasonRoundInput {
  roundId: string;
  order: number;
  scores: SeasonRoundScoreInput[];
}

export interface SeasonStandingInput {
  participants: SeasonParticipantInput[];
  rounds: SeasonRoundInput[];
}

export interface SeasonStanding {
  participantId: string;
  participantName: string;
  totalPoints: number;
  roundWins: number;
  rank: number;
  previousRank: number | null;
  movement: Movement;
}
