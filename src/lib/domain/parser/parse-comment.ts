import { matchFixture } from "./match-fixture";
import { parsePredictionLine } from "./parse-prediction-line";
import { normalizeCommentText } from "./normalize";
import type { FixtureRef, ParsedComment, ParsedPredictionLine } from "./types";

function lineConfidence(matched: number | null, hasScore: boolean, ambiguous: boolean): number {
  if (ambiguous) {
    return 0.2;
  }
  if (matched == null) {
    return hasScore ? 0.25 : 0.15;
  }
  return hasScore ? Math.max(0.55, matched) : matched * 0.5;
}

export function parseComment(raw: string, fixtures: FixtureRef[]): ParsedComment {
  const text = normalizeCommentText(raw);
  const lines: ParsedPredictionLine[] = [];

  for (const rawLine of text.split("\n")) {
    const parsed = parsePredictionLine(rawLine);
    if (!parsed) {
      continue;
    }
    const fixture = matchFixture(parsed.homeName, parsed.awayName, fixtures);
    const warnings = [...parsed.warnings];
    if (fixture?.ambiguous) {
      warnings.push(`Ambiguous fixture match for ${parsed.homeName} - ${parsed.awayName}`);
    } else if (fixture?.swapped) {
      warnings.push(`Home and away look swapped for ${fixture.label}`);
    } else if (!fixture && (parsed.homeName || parsed.homeGoals != null)) {
      warnings.push(
        parsed.homeName
          ? `Could not match fixture: ${parsed.homeName} - ${parsed.awayName}`
          : "Malformed prediction line",
      );
    }

    const hasScore = parsed.homeGoals != null && parsed.awayGoals != null;
    // A dash in ordinary prose is not a prediction. Keep a scoreless line only
    // when it actually matches a fixture, so the admin can fill the score in.
    if (!hasScore && !fixture) {
      continue;
    }
    lines.push({
      rawLine: parsed.rawLine,
      homeName: parsed.homeName,
      awayName: parsed.awayName,
      homeGoals: parsed.homeGoals,
      awayGoals: parsed.awayGoals,
      markedAsMt: parsed.markedAsMt,
      fixtureId: fixture && !fixture.ambiguous ? fixture.fixtureId : null,
      fixtureLabel: fixture && !fixture.ambiguous ? fixture.label : null,
      swapped: Boolean(fixture?.swapped && !fixture.ambiguous),
      confidence: lineConfidence(fixture && !fixture.ambiguous ? fixture.confidence : null, hasScore, Boolean(fixture?.ambiguous)),
      warnings,
    });
  }

  const kept = new Map<string, ParsedPredictionLine>();
  for (const line of lines) {
    if (!line.fixtureId) {
      continue;
    }
    const current = kept.get(line.fixtureId);
    if (!current) {
      kept.set(line.fixtureId, line);
      continue;
    }
    const winner = line.confidence >= current.confidence ? line : current;
    const loser = winner === line ? current : line;
    winner.warnings = [
      ...winner.warnings,
      `Duplicate prediction for ${winner.fixtureLabel ?? "a fixture"}; kept the stronger line`,
    ];
    loser.fixtureId = null;
    loser.warnings = [...loser.warnings, `Duplicate line ignored for ${current.fixtureLabel}`];
    kept.set(winner.fixtureId ?? line.fixtureId, winner);
  }

  const matchedIds = new Set([...kept.keys()]);
  const warnings = lines.flatMap((line) => line.warnings);
  for (const fixture of fixtures) {
    if (!matchedIds.has(fixture.id)) {
      warnings.push(`No prediction for ${fixture.homeTeam} — ${fixture.awayTeam}`);
    }
  }

  const confidence =
    lines.length === 0 ? 0 : lines.reduce((total, line) => total + line.confidence, 0) / lines.length;

  return {
    lines,
    warnings,
    confidence: Number(confidence.toFixed(3)),
  };
}

export function rowsForStorage(parsed: ParsedComment): ParsedPredictionLine[] {
  const seen = new Set<string>();
  const rows: ParsedPredictionLine[] = [];
  for (const line of parsed.lines) {
    if (!line.fixtureId || seen.has(line.fixtureId)) {
      continue;
    }
    seen.add(line.fixtureId);
    rows.push(line);
  }
  return rows;
}
