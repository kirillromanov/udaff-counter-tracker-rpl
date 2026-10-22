/**
 * Rank a fixture's source rows.
 * Official-strength sources can accept a score. Verification sources can only support one.
 * A disagreement between official-strength sources is left for review.
 */

export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export const SOURCE_RANK: Readonly<Record<string, { weight: number; material: boolean; label: string }>> = {
  premierliga: { weight: 100, label: "official JSON API", material: true },
  "sport-ru": { weight: 80, label: "near-official HTML results", material: true },
  "football-data": { weight: 70, label: "structured API", material: true },
  championat: { weight: 45, label: "HTML scrape", material: true },
  sportbox: { weight: 40, label: "HTML scrape", material: true },
  understat: { weight: 35, label: "verification JSON", material: false },
  footbolno: { weight: 25, label: "verification HTML, recent matches only", material: false },
};

export type ResolutionClass = "verified" | "provisional" | "conflict-review" | "insufficient";
export type CandidateStanding = "selected" | "agrees" | "downgraded" | "flagged" | "excluded";

export interface RankableObservation {
  source: string;
  sourceKey: string;
  homeGoals: number;
  awayGoals: number;
  role: string;
  confidence: string;
  matchStatus?: string | null;
  completeness?: string | null;
  fetchedAt?: Date | null;
}

export interface RankedCandidate {
  source: string;
  sourceKey: string;
  homeGoals: number;
  awayGoals: number;
  weight: number;
  standing: CandidateStanding;
  reason: string;
}

export interface FixtureRanking {
  classification: ResolutionClass;
  homeGoals: number | null;
  awayGoals: number | null;
  selectedSource: string | null;
  selectionReason: string;
  candidates: RankedCandidate[];
  note: string;
}

export function isStaleObservation(observation: { fetchedAt?: Date | null }, now?: Date): boolean {
  if (!now || !observation.fetchedAt) {
    return false;
  }
  return now.getTime() - observation.fetchedAt.getTime() > STALE_AFTER_MS;
}

function profile(source: string, role: string): { weight: number; material: boolean; label: string } {
  return (
    SOURCE_RANK[source] ?? {
      weight: role === "verification" ? 20 : 30,
      material: role !== "verification",
      label: role === "verification" ? "verification source" : "unlisted source",
    }
  );
}

function scoreKey(homeGoals: number, awayGoals: number): string {
  return `${homeGoals}-${awayGoals}`;
}

interface Judged {
  observation: RankableObservation;
  weight: number;
  label: string;
  material: boolean;
  kind: "voter" | "stale" | "excluded";
  block: string | null;
}

function judge(observation: RankableObservation, unavailable: ReadonlySet<string> | undefined, now: Date | undefined): Judged {
  const info = profile(observation.source, observation.role);
  const base = { observation, weight: info.weight, label: info.label, material: info.material && observation.role !== "verification" };
  if (unavailable?.has(observation.source)) {
    return { ...base, kind: "excluded", block: "Failed or degraded, so this row cannot decide the score." };
  }
  if (observation.completeness === "partial") {
    return { ...base, kind: "excluded", block: "Partial parse is evidence only." };
  }
  if ((observation.matchStatus ?? "finished") !== "finished") {
    return { ...base, kind: "excluded", block: "Match is not finished." };
  }
  if (isStaleObservation(observation, now)) {
    return { ...base, kind: "stale", block: "Fetched score is older than 36 hours, so it does not decide against a fresher source." };
  }
  return { ...base, kind: "voter", block: null };
}

function listed(rows: readonly Judged[]): string {
  return rows
    .map((row) => `${row.observation.source} (${row.observation.role}, ${row.observation.confidence}) ${row.observation.homeGoals}-${row.observation.awayGoals}`)
    .join(", ");
}

export function rankFixtureResult(
  observations: readonly RankableObservation[],
  options?: { now?: Date; unavailable?: ReadonlySet<string> },
): FixtureRanking {
  if (observations.length === 0) {
    return {
      classification: "insufficient",
      homeGoals: null,
      awayGoals: null,
      selectedSource: null,
      selectionReason: "",
      candidates: [],
      note: "",
    };
  }
  const judged = observations.map((observation) => judge(observation, options?.unavailable, options?.now));
  const voters = judged.filter((row) => row.kind === "voter");
  const material = voters.filter((row) => row.material);
  const scores = new Set(material.map((row) => scoreKey(row.observation.homeGoals, row.observation.awayGoals)));
  const conflict = scores.size > 1;

  if (conflict) {
    const candidates = judged.map((row) => candidate(row, "conflict", null));
    return {
      classification: "conflict-review",
      homeGoals: null,
      awayGoals: null,
      selectedSource: null,
      selectionReason: "Official-strength sources disagree, so no score was auto-selected.",
      candidates,
      note: `Sources disagree: ${listed(voters)}. The stored score was left unchanged.`,
    };
  }

  if (material.length === 0) {
    const candidates = judged.map((row) => candidate(row, "insufficient", null));
    const reasons = candidates.map((row) => `${row.source}: ${row.reason}`).join(" ");
    return {
      classification: "insufficient",
      homeGoals: null,
      awayGoals: null,
      selectedSource: null,
      selectionReason: "No official-strength source provided a finished score.",
      candidates,
      note: `Insufficient data. ${reasons}`.trim(),
    };
  }

  const selected = [...material].sort((left, right) => right.weight - left.weight || left.observation.source.localeCompare(right.observation.source))[0] as Judged;
  const selectedKey = scoreKey(selected.observation.homeGoals, selected.observation.awayGoals);
  const agreeing = voters.filter((row) => scoreKey(row.observation.homeGoals, row.observation.awayGoals) === selectedKey);
  const classification: ResolutionClass = agreeing.length >= 2 ? "verified" : "provisional";
  const names = agreeing.map((row) => row.observation.source).join(" and ");
  const selectionReason =
    classification === "verified"
      ? `Selected ${selected.observation.source} (${selected.label}, rank ${selected.weight}) because ${names} agree.`
      : `Selected ${selected.observation.source} (${selected.label}, rank ${selected.weight}). No second source agreed.`;
  const candidates = judged.map((row) => candidate(row, "chosen", selectedKey, selected.observation.source));
  const aside = candidates
    .filter((row) => row.standing === "downgraded" || row.standing === "excluded" || row.standing === "flagged")
    .map((row) => `${row.source} was ${row.standing}: ${row.reason}`)
    .join(" ");
  const lead = classification === "verified" ? `Verified by ${names}.` : `Provisionally accepted from ${selected.observation.source}.`;
  return {
    classification,
    homeGoals: selected.observation.homeGoals,
    awayGoals: selected.observation.awayGoals,
    selectedSource: selected.observation.source,
    selectionReason,
    candidates,
    note: [lead, selectionReason, aside].filter(Boolean).join(" "),
  };
}

function candidate(row: Judged, mode: "conflict" | "insufficient" | "chosen", selectedKey: string | null, selectedSource?: string): RankedCandidate {
  const score = scoreKey(row.observation.homeGoals, row.observation.awayGoals);
  let standing: CandidateStanding = "downgraded";
  let reason = row.block ?? `${row.label}, rank ${row.weight}.`;
  if (row.kind === "excluded") {
    standing = "excluded";
    reason = row.block ?? "Excluded.";
  } else if (row.kind === "stale") {
    standing = "downgraded";
    reason = row.block ?? "Stale.";
  } else if (mode === "conflict" && row.material) {
    standing = "flagged";
    reason = "Disagrees with another official-strength source, so the result was not auto-finalized.";
  } else if (mode === "conflict") {
    standing = "downgraded";
    reason = "Weaker source cannot settle a disagreement between official-strength sources.";
  } else if (mode === "insufficient") {
    standing = "downgraded";
    reason = "Verification-only source cannot accept a score alone.";
  } else if (row.observation.source === selectedSource && score === selectedKey) {
    standing = "selected";
    reason = `Highest-ranked source for this score (${row.label}, rank ${row.weight}).`;
  } else if (score === selectedKey) {
    standing = "agrees";
    reason = `Agrees with the selected score (${row.label}, rank ${row.weight}).`;
  } else {
    standing = "downgraded";
    reason = row.material
      ? "Another official-strength source was ranked higher."
      : "Weaker source disagrees and does not outrank the selected source.";
  }
  return {
    source: row.observation.source,
    sourceKey: row.observation.sourceKey,
    homeGoals: row.observation.homeGoals,
    awayGoals: row.observation.awayGoals,
    weight: row.weight,
    standing,
    reason,
  };
}
