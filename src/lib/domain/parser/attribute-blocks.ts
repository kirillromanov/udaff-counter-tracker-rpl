import { parsePredictionLine } from "./parse-prediction-line";

/**
 * Mathematical bold "6aJI6ec". NFKC folds this to ASCII, but the exact
 * sequence is matched on the raw line first so recognition does not depend
 * on normalization alone.
 */
export const BALBES_STYLIZED_ALIAS = "𝟲𝗮𝗝𝗜𝟲𝗲𝗰";

const BALBES_ASCII = /(?:^|[^\p{L}\p{N}])6aji6ec(?:$|[^\p{L}\p{N}])/iu;
const ROUND_MARK = /\[\s*#\s*(\d+)\s*\]|#\s*(\d+)/u;
const COMMENTARY_DECORATION = /\(\s*(?:мт|mt)\s*\)|\*\s*2(?!\d)|матч\s+тура!?|[\p{Extended_Pictographic}\uFE0F]/giu;
/**
 * A disclaimer line is the whole line, not a name mentioned inside a sentence.
 * Compact equality keeps "Бубен" from matching "бубновский" or match commentary.
 */
const SASHKO_DISCLAIMERS: ReadonlyArray<readonly [string, string]> = [
  ["отсашкобубна", "от СашкоБубна"],
  ["отсашкобубен", "от СашкоБубен"],
  ["отсашкибубна", "от Сашки Бубна"],
  ["отсашкибубен", "от Сашки Бубен"],
  ["отбубна", "от Бубна"],
  ["комментариибубна", "комментарии Бубна"],
  ["комментарийбубна", "комментарий Бубна"],
  ["комментариибубен", "комментарии Бубен"],
  ["сашкобубен", "СашкоБубен"],
  ["сашкобубна", "СашкоБубна"],
  ["бубнов", "Бубнов"],
  ["бубен", "Бубен"],
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

function disclaimerOf(raw: string): string | null {
  if (isPrediction(raw)) {
    return null;
  }
  const compact = raw
    .normalize("NFKC")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase("ru");
  return SASHKO_DISCLAIMERS.find(([key]) => key === compact)?.[1] ?? null;
}

function isSelfMarker(raw: string): boolean {
  if (isBalbesMarker(raw)) {
    return false;
  }
  const compact = raw.replace(/[^\p{L}\p{N}]+/gu, "");
  return compact.toLocaleLowerCase("ru") === "мну";
}

/**
 * Round headers use a normalized copy so mathematical-bold digits (`𝟭𝟰`)
 * compare with the imported round. The season banner `𝟐𝟔’𝟐𝟳` has no `#`
 * and is not a round header. The original line is left unchanged.
 */
export function roundHeaderNumber(raw: string): number | null {
  const match = ROUND_MARK.exec(raw.normalize("NFKC"));
  const value = match?.[1] ?? match?.[2];
  if (!value || !/^\d+$/u.test(value)) {
    return null;
  }
  const round = Number(value);
  return Number.isInteger(round) ? round : null;
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
  const after = normalized.slice(last.index + last[0].length).replace(COMMENTARY_DECORATION, " ");
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

interface OwnerSegment {
  ownerName: string;
  method: AttributionBlock["method"];
  evidence: string;
  rows: RawLine[];
  rounds: number[];
}

/**
 * Walk neofit's comment once. The stylized alias switches the owner to БалБес.
 * A marker line whose only word is "мну" switches it back to neofit.
 * Headers, banners, underscores, and tilde rules stay with the current owner.
 * The owner starts as neofit for every comment and is not remembered after it.
 */
function balbesBlocks(input: AttributeCommentInput, rows: RawLine[]): AttributionBlock[] {
  const segments: OwnerSegment[] = [];
  let ownerName = input.authorName;
  let method: AttributionBlock["method"] = "author";
  let evidence = "Comment author";
  let currentRows: RawLine[] = [];
  let rounds: number[] = [];

  const flush = () => {
    if (currentRows.some((row) => isPrediction(row.raw))) {
      segments.push({ ownerName, method, evidence, rows: currentRows, rounds });
    }
    currentRows = [];
    rounds = [];
  };

  for (const row of rows) {
    if (isBalbesMarker(row.raw)) {
      flush();
      ownerName = "БалБес";
      method = "explicit-marker";
      evidence = `Stylized alias ${BALBES_STYLIZED_ALIAS} in a comment by ${input.authorName}`;
      continue;
    }
    if (isSelfMarker(row.raw)) {
      flush();
      ownerName = input.authorName;
      method = "explicit-marker";
      evidence = `Self marker “мну” returns the following predictions to ${input.authorName}`;
      continue;
    }
    const round = roundHeaderNumber(row.raw);
    if (round != null) {
      rounds.push(round);
    }
    currentRows.push(row);
  }
  flush();

  return segments.flatMap((segment, ordinal) => {
    const distinct = [...new Set(segment.rounds)];
    const contradicted = input.roundNumber == null ? null : distinct.find((round) => round !== input.roundNumber);
    const warnings = contradicted == null ? [] : [`Round marker #${contradicted} does not match imported round ${input.roundNumber}`];
    const block = blockFrom(
      segment.ownerName,
      segment.method,
      segment.evidence,
      contradicted == null ? "clear" : "review",
      contradicted == null ? (segment.method === "explicit-marker" ? 0.95 : 0.9) : 0.4,
      segment.rows,
      warnings,
      ordinal,
    );
    return block ? [block] : [];
  });
}

interface DisclaimerLine {
  row: RawLine;
  leadIn: boolean;
  label: string;
}

interface PavelDraft {
  rows: RawLine[];
  predictions: RawLine[];
  keys: Set<string>;
  before: DisclaimerLine[];
  after: DisclaimerLine[];
  ambiguous: boolean;
}

function isDecoration(raw: string): boolean {
  if (isSeparator(raw) || roundHeaderNumber(raw) != null) {
    return true;
  }
  const compact = raw.replace(/\s/g, "");
  return compact.length >= 5 && /^[_=~\\|. *-]+$/u.test(compact);
}

function fixtureKey(raw: string): string | null {
  const parsed = parsePredictionLine(raw);
  if (!parsed?.homeName || !parsed.awayName || parsed.homeGoals == null) {
    return null;
  }
  return `${parsed.homeName.toLocaleLowerCase("ru")}|${parsed.awayName.toLocaleLowerCase("ru")}`;
}

function attachHeld(previous: PavelDraft | undefined, next: PavelDraft, held: DisclaimerLine[]): void {
  if (held.length === 0) {
    return;
  }
  const lead = held.filter((item) => item.leadIn);
  const trailing = held.filter((item) => !item.leadIn);
  if (!previous) {
    next.before.push(...held);
    return;
  }
  if (lead.length > 0 && trailing.length === 0) {
    next.before.push(...lead);
    return;
  }
  previous.ambiguous = true;
  next.ambiguous = true;
  previous.after.push(...trailing, ...lead);
  next.before.push(...trailing, ...lead);
}

/**
 * Pavel's own slip is the plain fixture template. СашкоБубен is either named
 * by a standalone disclaimer or written as one slip where every prediction
 * line continues with match commentary. Blank lines stay inside the slip.
 * A repeated fixture starts another slip. A name inside a sentence does not.
 */
function pavelBlocks(input: AttributeCommentInput, rows: RawLine[]): AttributionBlock[] {
  const drafts: PavelDraft[] = [];
  let current: PavelDraft | null = null;
  let held: DisclaimerLine[] = [];
  let preface: RawLine[] = [];

  const close = () => {
    if (current && current.predictions.length > 0) {
      drafts.push(current);
    }
    current = null;
  };

  for (const row of rows) {
    if (!row.raw.trim()) {
      if (current) {
        current.rows.push(row);
      } else {
        preface.push(row);
      }
      continue;
    }
    const label = disclaimerOf(row.raw);
    if (label) {
      close();
      held.push({ row, label, leadIn: /^от(?:\s|$)/iu.test(label) });
      continue;
    }
    if (isDecoration(row.raw)) {
      if (current) {
        current.rows.push(row);
      } else {
        preface.push(row);
      }
      continue;
    }
    const key = fixtureKey(row.raw);
    if (!key) {
      close();
      if (held.length > 0) {
        const previous = drafts.at(-1);
        if (previous) {
          previous.after.push(...held);
        }
        held = [];
      }
      preface = [];
      continue;
    }
    if (current?.keys.has(key)) {
      close();
    }
    if (!current) {
      current = { rows: [...preface], predictions: [], keys: new Set(), before: [], after: [], ambiguous: false };
      preface = [];
      attachHeld(drafts.at(-1), current, held);
      held = [];
    }
    current.rows.push(row);
    current.predictions.push(row);
    current.keys.add(key);
  }
  close();
  if (held.length > 0) {
    drafts.at(-1)?.after.push(...held);
  }

  return drafts.flatMap((draft, ordinal) => {
    const commentary = draft.predictions.filter((row) => commentaryWeight(row.raw)).length;
    const total = draft.predictions.length;
    const labels = [...draft.before, ...draft.after].map((item) => item.label);
    let name = input.authorName;
    let method: AttributionBlock["method"] = "author";
    let review: AttributionBlock["review"] = "clear";
    let evidence = "Comment author";
    let confidence = 0.9;
    const warnings: string[] = [];
    if (draft.ambiguous) {
      method = "explicit-marker";
      review = "review";
      confidence = 0.4;
      evidence = `Disclaimer “${labels.join(", ")}” has ambiguous scope between prediction blocks in a comment by ${input.authorName}`;
      warnings.push(evidence);
    } else if (labels.length > 0) {
      name = "СашкоБубен";
      method = "explicit-marker";
      review = "clear";
      confidence = 0.93;
      evidence = `Attribution phrase “${labels.join(", ")}” in a comment by ${input.authorName}`;
    } else if (total >= 2 && commentary === total) {
      name = "СашкоБубен";
      method = "commentary-heuristic";
      review = "clear";
      confidence = 0.9;
      evidence = `${commentary} of ${total} prediction lines in ${input.authorName}'s comment each have match commentary after the score`;
    } else if (commentary >= 2 && commentary < total) {
      method = "commentary-heuristic";
      review = "review";
      confidence = 0.45;
      evidence = `${commentary} of ${total} prediction lines have match commentary, so the block is not a consistent СашкоБубен slip`;
      warnings.push(evidence);
    }
    const contradicted = input.roundNumber == null
      ? null
      : draft.rows.map((row) => roundHeaderNumber(row.raw)).find((round) => round != null && round !== input.roundNumber);
    if (contradicted != null) {
      review = "review";
      confidence = Math.min(confidence, 0.4);
      warnings.push(`Round marker #${contradicted} does not match imported round ${input.roundNumber}`);
    }
    const built = blockFrom(
      name,
      method,
      evidence,
      review,
      confidence,
      [...draft.before.map((item) => item.row), ...draft.rows, ...draft.after.map((item) => item.row)],
      warnings,
      ordinal,
    );
    return built ? [built] : [];
  });
}

/**
 * Split one forum comment into prediction blocks.
 * The comment author stays the author. Inside a neofit comment, the stylized
 * БалБес alias and the self marker "мну" switch the owner of the following
 * lines. Inside a Павел Абросимов comment, a standalone СашкоБубен disclaimer
 * or a slip whose every line has match commentary selects СашкоБубен.
 * Neither name is written back as an alias. Owner state ends with the comment.
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
