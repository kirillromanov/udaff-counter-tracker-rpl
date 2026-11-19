export function formatMovement(
  movement: string,
  rank: number,
  previousRank: number | null,
): string {
  if (movement === "new" || previousRank == null) {
    return "new";
  }
  if (movement === "up") {
    return `▲ ${Math.abs(previousRank - rank)}`;
  }
  if (movement === "down") {
    return `▼ ${Math.abs(previousRank - rank)}`;
  }
  return "◄► 0";
}

export function medalSymbols(count: number): string {
  if (count <= 0) {
    return "";
  }
  return Array.from({ length: count }, () => "☼").join(" ");
}
