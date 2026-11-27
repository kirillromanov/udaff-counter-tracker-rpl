export interface FixtureRef {
  id: string;
  homeTeam: string;
  awayTeam: string;
  /** Extra spellings for this fixture only. They do not change the stored team strings. */
  homeAliases?: readonly string[];
  awayAliases?: readonly string[];
}

export interface ParsedPredictionLine {
  rawLine: string;
  homeName: string | null;
  awayName: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  markedAsMt: boolean;
  fixtureId: string | null;
  fixtureLabel: string | null;
  swapped: boolean;
  confidence: number;
  warnings: string[];
}

export interface ParsedComment {
  lines: ParsedPredictionLine[];
  warnings: string[];
  confidence: number;
}
