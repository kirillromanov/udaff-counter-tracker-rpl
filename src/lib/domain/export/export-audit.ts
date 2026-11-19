export interface StoredMatchBreakdown {
  label: string;
  predicted: string;
  actual: string;
  baseCategory: string;
  basePoints: number;
  bonusPoints: number;
  mtMultiplier: number;
  mtApplied: boolean;
  finalMatchPoints: number;
  explanations: string[];
}

export interface StoredBreakdown {
  matches: StoredMatchBreakdown[];
  matchPointsTotal: number;
  roundTotalGoalsBonus: number;
  roundTotal: number;
}

export interface AuditParticipant {
  name: string;
  isWinner: boolean;
  breakdown: StoredBreakdown;
}

export function parseBreakdown(value: string): StoredBreakdown | null {
  try {
    const parsed = JSON.parse(value) as StoredBreakdown;
    if (!parsed || !Array.isArray(parsed.matches)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function matchLine(match: StoredMatchBreakdown): string {
  const multiplier = match.mtApplied ? ` x${match.mtMultiplier}` : "";
  const bonus = match.bonusPoints ? ` bonus ${match.bonusPoints}` : "";
  return [
    `${match.label}: pred ${match.predicted} actual ${match.actual}`,
    `${match.baseCategory} ${match.basePoints}${bonus}${multiplier} = ${match.finalMatchPoints}`,
    ...match.explanations.map((line) => `  ${line}`),
  ].join("\n");
}

export function exportAudit(participants: AuditParticipant[]): string {
  const ordered = [...participants].sort((left, right) => {
    if (right.breakdown.roundTotal !== left.breakdown.roundTotal) {
      return right.breakdown.roundTotal - left.breakdown.roundTotal;
    }
    return left.name.localeCompare(right.name, "ru");
  });

  return ordered
    .map((participant) => {
      const winner = participant.isWinner ? " — round winner" : "";
      const header = `${participant.name}${winner} — ${participant.breakdown.roundTotal}`;
      const matches = participant.breakdown.matches.map(matchLine).join("\n");
      const bonus = `Round total-goals bonus: ${participant.breakdown.roundTotalGoalsBonus}`;
      const total = `Match points ${participant.breakdown.matchPointsTotal} + bonus ${participant.breakdown.roundTotalGoalsBonus} = ${participant.breakdown.roundTotal}`;
      return [header, matches, bonus, total].filter(Boolean).join("\n");
    })
    .join("\n\n");
}
