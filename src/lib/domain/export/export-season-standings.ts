import { formatMovement, medalSymbols } from "@/lib/domain/standings/format-movement";

export interface SeasonExportRow {
  rank: number;
  name: string;
  totalPoints: number;
  medals: number;
  movement: string;
  previousRank: number | null;
}

/**
 * Forum season table. Movement is ▲ N, ▼ N, or ◄► 0.
 * Each round win is a ☼ before the padding.
 */
export function exportSeasonStandings(rows: SeasonExportRow[]): string {
  const ranked = [...rows].sort((left, right) => left.rank - right.rank);
  const bodies = ranked.map((row) => {
    const medals = medalSymbols(row.medals);
    return `==${row.name}${medals ? ` ${medals}` : ""}`;
  });
  const width = Math.max(32, ...bodies.map((body) => body.length + 4));
  return ranked
    .map((row, index) => {
      const movement = formatMovement(row.movement, row.rank, row.previousRank).padEnd(5, " ");
      const bar = (bodies[index] ?? "").padEnd(width, "=");
      return `${row.rank} ${movement} ${bar} ${row.totalPoints}`;
    })
    .join("\n");
}
