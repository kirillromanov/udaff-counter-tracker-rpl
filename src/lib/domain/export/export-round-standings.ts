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
export function exportRoundStandings(rows: RoundExportRow[]): string {
  const ranked = [...rows].sort(compareRows);
  const width = Math.max(28, ...ranked.map((row) => row.name.length + 2), 28);
  return ranked
    .map((row, index) => {
      const bar = `==${row.name}`.padEnd(width, "=");
      const score = `${row.matchPoints}+ ${row.roundBonus}`;
      const note = row.isWinner ? " (мидалько, епт)" : "";
      return `${index + 1} ${bar} ${score}${note}`;
    })
    .join("\n");
}
