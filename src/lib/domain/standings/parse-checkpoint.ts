import { identityOwner, normalizeParticipantName, type KnownIdentity } from "@/lib/domain/participants/identity";

export type CheckpointMovement = "up" | "down" | "same";

export interface ParsedCheckpointRow {
  rank: number;
  movement: CheckpointMovement;
  movementDelta: number;
  previousRank: number;
  displayName: string;
  totalPoints: number;
  markerCount: number;
  rawLine: string;
}

export interface MatchedCheckpointRow extends ParsedCheckpointRow {
  participantId: string | null;
}

export interface ComputedStandingRow {
  participantId: string;
  rank: number;
  totalPoints: number;
  movement: string;
  previousRank: number | null;
  roundWins: number;
}

export interface CheckpointDifference {
  participantId: string;
  displayName: string;
  fields: string[];
}

const LINE = /^(\d+)\s+(▲|▼|◄►)\s+(\d+)\s+==(.+)\s+(\d+)\s*$/u;

function readMovement(symbol: string, delta: number, rank: number): Pick<ParsedCheckpointRow, "movement" | "movementDelta" | "previousRank"> {
  if (symbol === "▲") {
    return { movement: "up", movementDelta: delta, previousRank: rank + delta };
  }
  if (symbol === "▼") {
    return { movement: "down", movementDelta: delta, previousRank: rank - delta };
  }
  return { movement: "same", movementDelta: delta, previousRank: rank };
}

function readName(body: string): { displayName: string; markerCount: number } {
  const withoutPadding = body.replace(/=+\s*$/u, "").trim();
  const markerCount = withoutPadding.match(/☼/gu)?.length ?? 0;
  const displayName = withoutPadding.replace(/(?:\s*☼)+/gu, "").replace(/\s+/g, " ").trim();
  if (!displayName) {
    throw new Error(`Standings line has no participant name: ${body}`);
  }
  return { displayName, markerCount };
}

export function parseStandingsCheckpoint(text: string): ParsedCheckpointRow[] {
  const rows: ParsedCheckpointRow[] = [];
  for (const rawLine of text.split(/\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = LINE.exec(line);
    if (!match) {
      throw new Error(`Could not read standings line: ${line}`);
    }
    const rank = Number(match[1]);
    const delta = Number(match[3]);
    const points = Number(match[5]);
    const { displayName, markerCount } = readName(match[4] ?? "");
    rows.push({
      rank,
      ...readMovement(match[2] ?? "", delta, rank),
      displayName,
      totalPoints: points,
      markerCount,
      rawLine: line,
    });
  }
  return rows;
}

/** Match forum names to the registry. An unknown name stays unmatched and is not created. */
export function matchCheckpointRows(rows: ParsedCheckpointRow[], identities: KnownIdentity[]): MatchedCheckpointRow[] {
  return rows.map((row) => ({
    ...row,
    participantId: identityOwner(normalizeParticipantName(row.displayName), identities),
  }));
}

export function movementDeltaOf(movement: string, rank: number, previousRank: number | null): number {
  if (movement === "new" || previousRank == null) {
    return 0;
  }
  return Math.abs(previousRank - rank);
}

/**
 * Compare a manual checkpoint with a later calculated table.
 * ☼ markers are compared with calculated round wins.
 * Rows are paired by participant id. Names the registry did not match are listed aside.
 */
export function compareCheckpointToComputed(
  checkpoint: MatchedCheckpointRow[],
  computed: ComputedStandingRow[],
): { differences: CheckpointDifference[]; unmatchedNames: string[]; missingParticipantIds: string[] } {
  const computedById = new Map(computed.map((row) => [row.participantId, row]));
  const seen = new Set<string>();
  const differences: CheckpointDifference[] = [];
  const unmatchedNames: string[] = [];

  for (const row of checkpoint) {
    if (!row.participantId) {
      unmatchedNames.push(row.displayName);
      continue;
    }
    seen.add(row.participantId);
    const actual = computedById.get(row.participantId);
    if (!actual) {
      differences.push({
        participantId: row.participantId,
        displayName: row.displayName,
        fields: ["missing from calculated standings"],
      });
      continue;
    }
    const fields: string[] = [];
    if (row.rank !== actual.rank) {
      fields.push(`rank ${row.rank} vs ${actual.rank}`);
    }
    if (row.totalPoints !== actual.totalPoints) {
      fields.push(`points ${row.totalPoints} vs ${actual.totalPoints}`);
    }
    const actualDelta = movementDeltaOf(actual.movement, actual.rank, actual.previousRank);
    if (row.movement !== actual.movement || row.movementDelta !== actualDelta) {
      fields.push(`movement ${row.movement} ${row.movementDelta} vs ${actual.movement} ${actualDelta}`);
    }
    if (row.markerCount !== actual.roundWins) {
      fields.push(`markers ${row.markerCount} vs ${actual.roundWins} round wins`);
    }
    if (fields.length > 0) {
      differences.push({ participantId: row.participantId, displayName: row.displayName, fields });
    }
  }

  const missingParticipantIds = computed
    .map((row) => row.participantId)
    .filter((participantId) => !seen.has(participantId));

  return { differences, unmatchedNames, missingParticipantIds };
}
