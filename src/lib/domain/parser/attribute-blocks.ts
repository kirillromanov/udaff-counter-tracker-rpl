import { parsePredictionLine } from "./parse-prediction-line";

/**
 * Mathematical bold "6aJI6ec". NFKC folds this to ASCII, but the exact
 * sequence is matched on the raw line first so recognition does not depend
 * on normalization alone.
 */
export const BALBES_STYLIZED_ALIAS = "𝟲𝗮𝗝𝗜𝟲𝗲𝗰";

const BALBES_ASCII = /(?:^|[^\p{L}\p{N}])6aji6ec(?:$|[^\p{L}\p{N}])/iu;
const ROUND_MARK = /\[\s*#\s*(\d+)\s*\]|#\s*(\d+)/;
const PHRASES: RegExp[] = [
  /от\s+сашко\s*бубна/iu,
  /от\s+сашки\s*бубна/iu,
  /от\s+бубна/iu,
  /комментари[йи]\s+бубна/iu,
  /(?:^|[^\p{L}\p{N}])бубнов(?:$|[^\p{L}\p{N}])/iu,
];

export interface AttributionBlock {
  ownerName: string;
  method: "author" | "explicit-marker" | "commentary-heuristic";
  evidence: string;
  review: "clear" | "probable" | "review";
  confidence: number;
  excerpt: string;
  text: string;
  warnings: string[];
  blockKey: string;
}

export interface AttributeCommentInput {
  raw: string;
  /** Canonical contest name of the comment author, when one is known. */
  authorName: string;
  roundNumber: number | null;
}

interface RawLine {
  index: number;
  raw: string;
}

function linesOf(raw: string): RawLine[] {
  return raw.split(/\r\n|\n|\r/u).map((rawLine, index) => ({ index, raw: rawLine }));
}

function isBalbesMarker(raw: string): boolean {
  if (raw.includes(BALBES_STYLIZED_ALIAS)) {
    return true;
  }
  const plain = raw.normalize("NFKC");
  if (BALBES_ASCII.test(plain)) {
    return true;
  }
  const compact = raw.replace(/[^\p{L}\p{N}]+/gu, "");
  return compact.toLocaleLowerCase("ru") === "балбес";
}

function isSeparator(raw: string): boolean {
  const compact = raw.replace(/\s/g, "");
  return compact.length >= 6 && /^=+/.test(compact) && /=+$/.test(compact);
}

function phraseIn(raw: string): boolean {
  const plain = raw.normalize("NFKC");
  return PHRASES.some((pattern) => pattern.test(plain));
}

function leadInPhrase(raw: string): boolean {
  return /^\s*от\s+/iu.test(raw.normalize("NFKC"));
}

function roundOn(raw: string): number | null {
  const match = ROUND_MARK.exec(raw);
  const value = match?.[1] ?? match?.[2];
  return value ? Number(value) : null;
}

function commentaryWeight(raw: string): boolean {
  const parsed = parsePredictionLine(raw);
  if (!parsed || parsed.homeGoals == null) {
    return false;
  }
  const normalized = raw.normalize("NFKC");
  const score = /(?<!\d)(\d{1,2})\s*[-:]\s*(\d{1,2})(?!\d)/g;
  const matches = [...normalized.matchAll(score)];
  const last = matches.at(-1);
  if (!last || last.index == null) {
    return false;
  }
  const after = normalized.slice(last.index + last[0].length);
  const words = after.split(/\s+/).filter((word) => /[\p{L}]{3,}/u.test(word));
  const letters = after.match(/\p{L}/gu)?.length ?? 0;
  return words.length >= 3 && letters >= 15;
}

function isPrediction(raw: string): boolean {
  const parsed = parsePredictionLine(raw);
  return Boolean(parsed && parsed.homeName && parsed.awayName);
}

function blockFrom(
  ownerName: string,
  method: AttributionBlock["method"],
  evidence: string,
  review: AttributionBlock["review"],
  confidence: number,
  rows: RawLine[],
  warnings: string[],
  ordinal: number,
): AttributionBlock | null {
  const predictionRows = rows.filter((row) => isPrediction(row.raw));
  if (predictionRows.length === 0) {
    return null;
  }
  const text = rows.map((row) => row.raw).join("\n");
  const first = predictionRows[0]?.raw.trim().slice(0, 120) ?? String(ordinal);
  return {
    ownerName,
    method,
    evidence,
    review,
    confidence,
    excerpt: text.trim().slice(0, 500),
    text,
    warnings,
    blockKey: `${ownerName}:${ordinal}:${first}`,
  };
}

function balbesBlocks(input: AttributeCommentInput, rows: RawLine[]): AttributionBlock[] {
  const marker = rows.find((row) => isBalbesMarker(row.raw));
  if (!marker) {
    const only = blockFrom(input.authorName, "author", "Comment author", "clear", 0.9, rows, [], 0);
    return only ? [only] : [];
  }
  const following = rows.filter((row) => row.index > marker.index);
  const roundLine = [marker, ...following.slice(0, 2)].map((row) => roundOn(row.raw)).find((value) => value != null) ?? null;
  const mismatch = roundLine != null && input.roundNumber != null && roundLine !== input.roundNumber;
  const before = rows.filter((row) => row.index < marker.index && !isSeparator(row.raw));
  const after = following.filter((row) => !isBalbesMarker(row.raw) && !isSeparator(row.raw));
  const warnings = mismatch
    ? [`Round marker #${roundLine} does not match imported round ${input.roundNumber}`]
    : [];
  const author = blockFrom(input.authorName, "author", "Predictions before the delegated marker", "clear", 0.9, before, [], 0);
  const delegated = blockFrom(
    "БалБес",
    "explicit-marker",
    `Stylized alias ${BALBES_STYLIZED_ALIAS} in a comment by ${input.authorName}`,
    mismatch ? "review" : "clear",
    mismatch ? 0.4 : 0.95,
    after,
    warnings,
    1,
  );
  return [author, delegated].filter((block): block is AttributionBlock => block != null);
}

interface Segment {
  rows: RawLine[];
  kind: "prediction" | "phrase" | "other";
}

function segmentsOf(rows: RawLine[]): Segment[] {
  const groups: RawLine[][] = [];
  let current: RawLine[] = [];
  for (const row of rows) {
    if (!row.raw.trim()) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
      continue;
    }
    current.push(row);
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups.map((group) => {
    const phraseLines = group.filter((row) => phraseIn(row.raw));
    const predictionLines = group.filter((row) => isPrediction(row.raw));
    if (predictionLines.length > 0) {
      return { rows: group, kind: "prediction" as const };
    }
    const phraseOnly =
      phraseLines.length > 0 &&
      group.every((row) => isSeparator(row.raw) || (phraseIn(row.raw) && row.raw.trim().length < 80));
    return { rows: group, kind: phraseOnly ? "phrase" as const : "other" as const };
  });
}

function pavelBlocks(input: AttributeCommentInput, rows: RawLine[]): AttributionBlock[] {
  const segments = segmentsOf(rows);
  const owner = new Map<Segment, { name: string; method: AttributionBlock["method"]; review: AttributionBlock["review"]; evidence: string }>();
  segments.forEach((segment, index) => {
    if (segment.kind !== "phrase") {
      return;
    }
    const evidence = segment.rows.map((row) => row.raw.trim()).join(" ").slice(0, 180);
    const next = segments[index + 1];
    const previous = segments[index - 1];
    const target = leadInPhrase(segment.rows[0]?.raw ?? "") && next?.kind === "prediction"
      ? next
      : previous?.kind === "prediction"
        ? previous
        : next?.kind === "prediction"
          ? next
          : null;
    if (!target || owner.has(target)) {
      return;
    }
    owner.set(target, {
      name: "СашкоБубен",
      method: "explicit-marker",
      review: "clear",
      evidence: `Attribution phrase “${evidence}” in a comment by ${input.authorName}`,
    });
  });

  const blocks: AttributionBlock[] = [];
  let ordinal = 0;
  for (const segment of segments) {
    if (segment.kind !== "prediction") {
      continue;
    }
    const explicitInside = segment.rows.some((row) => phraseIn(row.raw));
    const assigned = owner.get(segment);
    const commentaryLines = segment.rows.filter((row) => commentaryWeight(row.raw)).length;
    let name = input.authorName;
    let method: AttributionBlock["method"] = "author";
    let review: AttributionBlock["review"] = "clear";
    let evidence = "Comment author";
    let confidence = 0.9;
    if (assigned || explicitInside) {
      name = "СашкоБубен";
      method = "explicit-marker";
      review = "clear";
      evidence = assigned?.evidence ?? `Attribution phrase inside the prediction block by ${input.authorName}`;
      confidence = 0.93;
    } else if (commentaryLines >= 3) {
      name = "СашкоБубен";
      method = "commentary-heuristic";
      review = "probable";
      evidence = `${commentaryLines} prediction lines in ${input.authorName}'s comment each have match commentary after the score`;
      confidence = 0.62;
    }
    const built = blockFrom(name, method, evidence, review, confidence, segment.rows, review === "probable" ? [evidence] : [], ordinal);
    ordinal += 1;
    if (built) {
      blocks.push(built);
    }
  }
  return blocks;
}

/**
 * Split one forum comment into prediction blocks.
 * The comment author stays the author. БалБес and СашкоБубен are owners of
 * later blocks only, and their names are never written back as aliases.
 *
 * The СашкоБубен commentary rule is a deterministic heuristic: at least three
 * prediction lines in one blank-line block must each have a real sentence
 * after the score. One trailing remark does not move the block. Explicit
 * phrases outrank the heuristic. A phrase in a long discussion does not
 * attach to a neighboring block.
 */
export function attributeComment(input: AttributeCommentInput): AttributionBlock[] {
  const rows = linesOf(input.raw);
  if (input.authorName === "neofit") {
    return balbesBlocks(input, rows);
  }
  if (input.authorName === "Павел Абросимов") {
    const blocks = pavelBlocks(input, rows);
    return blocks.length > 0 ? blocks : [];
  }
  const author = blockFrom(input.authorName, "author", "Comment author", "clear", 0.9, rows, [], 0);
  return author ? [author] : [];
}
