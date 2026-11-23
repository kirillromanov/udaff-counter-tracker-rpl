import { prisma } from "@/lib/db/prisma";
import { RoundClosedError, isRoundClosed } from "@/lib/domain/rounds/round-lock";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";
import { recalculateRound } from "@/lib/domain/standings/recalculate-round";
import { alignToFixture } from "./decide";
import { rankFixtureResult, type RankableObservation } from "./ranking";
import { fixturePhase, type FixturePhase, type PollFixture } from "./poll";

/** Full-time scores only. This model has no extra-time or penalty fields. */
export const MAX_RESULT_GOALS = 20;
export const LOCAL_OPERATOR = "local-admin";

export class ResultCorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultCorrectionError";
  }
}

export function parseFullTimeScore(home: unknown, away: unknown): { home: number; away: number } {
  const left = readGoal(home, "home");
  const right = readGoal(away, "away");
  return { home: left, away: right };
}

function readGoal(value: unknown, side: string): number {
  const text = String(value ?? "").trim();
  if (!/^\d+$/u.test(text)) {
    throw new ResultCorrectionError(`Enter a whole number for the ${side} score.`);
  }
  const parsed = Number(text);
  if (parsed > MAX_RESULT_GOALS) {
    throw new ResultCorrectionError(`A full-time score above ${MAX_RESULT_GOALS} is not accepted.`);
  }
  return parsed;
}

export const LABEL_MANUAL_NOT_VERIFIED = "manual corrected, not source verified";
export const LABEL_VERIFIED_FIXED = "verified, fixed manually";
export const LABEL_FIXED_ONE_SOURCE = "fixed manually. Only one source agrees.";
export const LABEL_OLDER_MANUAL = "older manual score";
export const LABEL_FIXED = "fixed manually";

export type SourceAgreement = "verified" | "provisional" | "other";

export function scoreIsFixed(match: {
  manuallyCorrected: boolean;
  resultProvenance: string;
  resultState?: string;
}): boolean {
  const state = match.resultState ?? "";
  return match.manuallyCorrected
    || match.resultProvenance === "manual"
    || match.resultProvenance === "operator-confirmed"
    || (state === "manual" && match.resultProvenance === "");
}

export function isLegacyManualScore(match: {
  manuallyCorrected: boolean;
  resultProvenance: string;
  resultState?: string;
}): boolean {
  return (match.resultState ?? "") === "manual" && match.resultProvenance === "" && !match.manuallyCorrected;
}

/** How the stored source rows relate to the score on screen. Stale or unfinished rows do not confirm it. */
export function sourceAgreement(
  home: number | null,
  away: number | null,
  observations: readonly RankableObservation[],
): SourceAgreement {
  const ranking = rankFixtureResult(observations);
  if (ranking.homeGoals == null || ranking.homeGoals !== home || ranking.awayGoals !== away) {
    return "other";
  }
  if (ranking.classification === "verified") {
    return "verified";
  }
  if (ranking.classification === "provisional") {
    return "provisional";
  }
  return "other";
}

/** Legacy rows have an empty provenance and keep their existing label. A fixed score uses the source comparison. */
export function displayedResultLabel(match: {
  resultProvenance: string;
  manuallyCorrected: boolean;
  resultConflict: boolean;
  resultState?: string;
}, legacy: string, agreement?: SourceAgreement | null): string {
  if (isLegacyManualScore(match)) {
    return LABEL_OLDER_MANUAL;
  }
  if (scoreIsFixed(match)) {
    if (agreement === "verified") {
      return LABEL_VERIFIED_FIXED;
    }
    if (agreement === "provisional") {
      return LABEL_FIXED_ONE_SOURCE;
    }
    if (agreement === "other") {
      return LABEL_MANUAL_NOT_VERIFIED;
    }
    return LABEL_FIXED;
  }
  if (match.resultProvenance === "two-source") {
    return match.resultConflict ? "Result conflict. Verified, two sources." : "Verified, two sources";
  }
  if (match.resultProvenance === "one-source") {
    return match.resultConflict ? "Result conflict. Provisional." : "Provisional";
  }
  return legacy;
}

export type FixtureScoreEdit = "leave" | "clear" | "edit" | "partial";

/** How the fixtures form treats the two score boxes. Empty boxes do not clear a stored score. */
export function readFixtureScoreEdit(
  storedHome: number | null,
  storedAway: number | null,
  homeRaw: unknown,
  awayRaw: unknown,
): FixtureScoreEdit {
  const homeBlank = String(homeRaw ?? "").trim() === "";
  const awayBlank = String(awayRaw ?? "").trim() === "";
  if (homeBlank !== awayBlank) {
    return "partial";
  }
  if (homeBlank && awayBlank) {
    return storedHome == null && storedAway == null ? "leave" : "clear";
  }
  const home = Number(String(homeRaw).trim());
  const away = Number(String(awayRaw).trim());
  if (home === storedHome && away === storedAway) {
    return "leave";
  }
  return "edit";
}

export function correctionAllowed(phase: FixturePhase): boolean {
  return phase === "finished-unverified" || phase === "finished-verified" || phase === "conflict-review";
}

export interface RecomputedResult {
  home: number | null;
  away: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  resultProvenance: string;
  note: string;
  awaitingRecheck: boolean;
}

/** Status after the manual marker is removed. Source rows are the only evidence. */
export function recomputeFromSources(observations: readonly RankableObservation[]): RecomputedResult {
  const ranking = rankFixtureResult(observations);
  if (ranking.classification === "verified" && ranking.homeGoals != null && ranking.awayGoals != null) {
    return {
      home: ranking.homeGoals,
      away: ranking.awayGoals,
      resultState: "verified",
      resultResolution: "verified",
      resultConflict: false,
      resultProvenance: "two-source",
      note: ranking.note,
      awaitingRecheck: false,
    };
  }
  if (ranking.classification === "provisional" && ranking.homeGoals != null && ranking.awayGoals != null) {
    return {
      home: ranking.homeGoals,
      away: ranking.awayGoals,
      resultState: "confirmed",
      resultResolution: "provisional",
      resultConflict: false,
      resultProvenance: "",
      note: `${ranking.note} Awaiting the next result check.`,
      awaitingRecheck: true,
    };
  }
  if (ranking.classification === "conflict-review") {
    return {
      home: null,
      away: null,
      resultState: "conflict",
      resultResolution: "conflict-review",
      resultConflict: true,
      resultProvenance: "",
      note: `${ranking.note} Awaiting the next result check.`,
      awaitingRecheck: true,
    };
  }
  return {
    home: null,
    away: null,
    resultState: "open",
    resultResolution: "",
    resultConflict: false,
    resultProvenance: "",
    note: "No finished source score is stored. Awaiting the next result check.",
    awaitingRecheck: true,
  };
}

interface MatchRow {
  id: string;
  roundId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date | null;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledgedAt: Date | null;
  manuallyCorrected: boolean;
  resultVersion: number;
  resultProvenance: string;
}

function pollOf(match: MatchRow): PollFixture {
  return {
    kickoffAt: match.kickoffAt,
    actualHomeGoals: match.actualHomeGoals,
    actualAwayGoals: match.actualAwayGoals,
    resultState: match.resultState,
    resultResolution: match.resultResolution,
    resultConflict: match.resultConflict,
    conflictAcknowledgedAt: match.conflictAcknowledgedAt,
  };
}

async function loadMutableMatch(matchId: string): Promise<{ match: MatchRow; standingRole: string }> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { round: { select: { id: true, closedAt: true, standingRole: true } } },
  });
  if (!match) {
    throw new ResultCorrectionError("That fixture is not stored.");
  }
  if (isRoundClosed(match.round.closedAt)) {
    throw new RoundClosedError();
  }
  if (match.round.standingRole === ARCHIVED_ROUND) {
    throw new ResultCorrectionError("An archived reference round keeps its stored result. This action does not change it.");
  }
  return {
    standingRole: match.round.standingRole,
    match: {
      id: match.id,
      roundId: match.roundId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
      actualHomeGoals: match.actualHomeGoals,
      actualAwayGoals: match.actualAwayGoals,
      resultState: match.resultState,
      resultResolution: match.resultResolution,
      resultConflict: match.resultConflict,
      conflictAcknowledgedAt: match.conflictAcknowledgedAt,
      manuallyCorrected: match.manuallyCorrected,
      resultVersion: match.resultVersion,
      resultProvenance: match.resultProvenance,
    },
  };
}

function assertVersion(match: MatchRow, version: number): void {
  if (match.resultVersion !== version) {
    throw new ResultCorrectionError("The score changed while this page was open. Reload the fixture and try again.");
  }
}

function assertFinished(match: MatchRow, now: Date): void {
  if (!correctionAllowed(fixturePhase(pollOf(match), now))) {
    throw new ResultCorrectionError("This fixture is not finished, so its score cannot be fixed by hand.");
  }
}

async function storedSourceRows(match: MatchRow): Promise<RankableObservation[]> {
  const rows = await prisma.resultObservation.findMany({ where: { matchId: match.id } });
  return rows.flatMap((row) => {
    const aligned = alignToFixture({ id: match.id, homeTeam: match.homeTeam, awayTeam: match.awayTeam }, row);
    if (!aligned) {
      return [];
    }
    return [{
      source: row.source,
      sourceKey: row.sourceKey,
      homeGoals: aligned.homeGoals,
      awayGoals: aligned.awayGoals,
      role: row.role,
      confidence: row.confidence,
      matchStatus: row.matchStatus,
      completeness: row.completeness,
      fetchedAt: row.lastSeenAt ?? row.fetchedAt,
    }];
  });
}

function sourceSnapshot(observations: readonly RankableObservation[]): string {
  if (observations.length === 0) {
    return "none stored";
  }
  return observations.map((row) => `${row.source} ${row.homeGoals}-${row.awayGoals}`).join("; ");
}

export async function applyManualResult(input: {
  matchId: string;
  home: unknown;
  away: unknown;
  version: number;
  standingChangeConfirmed: boolean;
  reason: string;
  now?: Date;
  /** A multi-fixture save recalculates once after every score write. */
  deferRecalculation?: boolean;
}): Promise<{ recalculated: boolean; scoreChanged: boolean }> {
  const score = parseFullTimeScore(input.home, input.away);
  const now = input.now ?? new Date();
  const { match } = await loadMutableMatch(input.matchId);
  assertVersion(match, input.version);
  assertFinished(match, now);
  const alreadyVerified = match.resultState === "verified"
    || match.resultResolution === "verified"
    || match.manuallyCorrected
    || match.resultState === "manual"
    || match.resultProvenance === "operator-confirmed"
    || match.resultProvenance === "manual";
  const scoreChanges = match.actualHomeGoals !== score.home || match.actualAwayGoals !== score.away;
  const alreadyOperator = scoreIsFixed(match);
  if (!scoreChanges && alreadyOperator) {
    return { recalculated: false, scoreChanged: false };
  }
  if (alreadyVerified && scoreChanges && !input.standingChangeConfirmed) {
    throw new ResultCorrectionError("Confirm that standings should use this corrected score.");
  }
  const observations = await storedSourceRows(match);
  const agreement = sourceAgreement(score.home, score.away, observations);
  const nextState = "verified";
  const nextResolution = "verified";
  const claimed = await prisma.match.updateMany({
    where: { id: match.id, resultVersion: match.resultVersion },
    data: {
      actualHomeGoals: score.home,
      actualAwayGoals: score.away,
      resultState: nextState,
      resultResolution: nextResolution,
      resultConflict: agreement === "other",
      resultProvenance: "manual",
      manuallyCorrected: true,
      resultNote: input.reason.trim() || "Fixed on the review page.",
      conflictAcknowledgedAt: null,
      resultVersion: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    throw new ResultCorrectionError("The score changed while this page was open. Reload the fixture and try again.");
  }
  await prisma.resultAudit.create({
    data: {
      matchId: match.id,
      roundId: match.roundId,
      action: scoreChanges ? "correct" : "confirm",
      actor: LOCAL_OPERATOR,
      previousHome: match.actualHomeGoals,
      previousAway: match.actualAwayGoals,
      previousState: match.resultState,
      previousResolution: match.resultResolution,
      previousMarker: match.manuallyCorrected,
      nextHome: score.home,
      nextAway: score.away,
      nextState,
      nextResolution,
      nextMarker: true,
      reason: `${input.reason.trim()} Sources at lock: ${sourceSnapshot(observations)}`.trim(),
    },
  });
  if (!scoreChanges || input.deferRecalculation) {
    return { recalculated: false, scoreChanged: scoreChanges };
  }
  await recalculateRound(match.roundId);
  return { recalculated: true, scoreChanged: true };
}

export async function rollbackManualResult(input: {
  matchId: string;
  version: number;
  confirmed: boolean;
  reason: string;
  now?: Date;
}): Promise<{ recalculated: boolean }> {
  if (!input.confirmed) {
    throw new ResultCorrectionError("Confirm the return to automatic confirmation.");
  }
  const now = input.now ?? new Date();
  const { match } = await loadMutableMatch(input.matchId);
  assertVersion(match, input.version);
  if (!scoreIsFixed(match)) {
    return { recalculated: false };
  }
  const next = recomputeFromSources(await storedSourceRows(match));
  const claimed = await prisma.match.updateMany({
    where: { id: match.id, resultVersion: match.resultVersion },
    data: {
      actualHomeGoals: next.home,
      actualAwayGoals: next.away,
      resultState: next.resultState,
      resultResolution: next.resultResolution,
      resultConflict: next.resultConflict,
      resultProvenance: next.resultProvenance,
      manuallyCorrected: false,
      resultNote: next.note,
      conflictAcknowledgedAt: null,
      resultVersion: { increment: 1 },
      ...(next.awaitingRecheck ? { autoCheckAttempts: 0, autoCheckNextAt: now } : { autoCheckNextAt: null }),
    },
  });
  if (claimed.count !== 1) {
    throw new ResultCorrectionError("The score changed while this page was open. Reload the fixture and try again.");
  }
  await prisma.resultAudit.create({
    data: {
      matchId: match.id,
      roundId: match.roundId,
      action: "rollback",
      actor: LOCAL_OPERATOR,
      previousHome: match.actualHomeGoals,
      previousAway: match.actualAwayGoals,
      previousState: match.resultState,
      previousResolution: match.resultResolution,
      previousMarker: match.manuallyCorrected || match.resultState === "manual",
      nextHome: next.home,
      nextAway: next.away,
      nextState: next.resultState,
      nextResolution: next.resultResolution,
      nextMarker: false,
      reason: input.reason.trim(),
    },
  });
  const sameScore = match.actualHomeGoals === next.home && match.actualAwayGoals === next.away;
  if (sameScore) {
    return { recalculated: false };
  }
  await recalculateRound(match.roundId);
  return { recalculated: true };
}
