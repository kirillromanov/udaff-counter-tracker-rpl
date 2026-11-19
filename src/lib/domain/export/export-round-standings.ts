export interface RoundExportRow {
  name: string;
  matchPoints: number;
  roundBonus: number;
  totalPoints: number;
  isWinner: boolean;
}

function compareRows(left: RoundExportRow, right: RoundExportRow): number {
  if (right.totalPoints !== left.totalPoints) {
    return right.totalPoints - left.totalPoints;
  }
  if (left.isWinner !== right.isWinner) {
    return left.isWinner ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "ru");
}

/**
 * Forum round table. `25+ 0` is match points, then the round-goals bonus.
 * Tied winners each get the medal note.
 */
export function intermediateRoundHeading(roundNumber: number, included: number, total: number): string {
  return `Промежуточные итоги тура ${roundNumber} — после ${included} из ${total} матчей`;
}

export const STALE_EXPORT_HEADING = "Расчёт устарел и не является текущим итогом.";

export function exportRoundStandings(rows: RoundExportRow[], options?: { heading?: string }): string {
  const ranked = [...rows].sort(compareRows);
  const width = Math.max(28, ...ranked.map((row) => row.name.length + 2), 28);
  const table = ranked
    .map((row, index) => {
      const bar = `==${row.name}`.padEnd(width, "=");
      const score = `${row.matchPoints}+ ${row.roundBonus}`;
      const note = row.isWinner ? " (мидалько, епт)" : "";
      return `${index + 1} ${bar} ${score}${note}`;
    })
    .join("\n");
  return options?.heading ? `${options.heading}\n${table}` : table;
}
