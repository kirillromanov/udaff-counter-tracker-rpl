import { SOURCE_RANK } from "./ranking";

export type FixturePhase = "scheduled" | "live" | "finished-unverified" | "finished-verified" | "conflict-review";
export type RoundPollStatus = "scheduled" | "live" | "finalized";

export interface PollFixture {
  kickoffAt: Date | null;
  actualHomeGoals: number | null;
  actualAwayGoals: number | null;
  resultState: string;
  resultResolution: string;
  resultConflict: boolean;
  conflictAcknowledgedAt: Date | null;
  liveReported?: boolean;
  /** A provider finish time, when one was actually recorded. Never inferred from the clock. */
  finishedAt?: Date | null;
  providerStatus?: "finished" | "live" | "scheduled" | "postponed" | "cancelled" | "suspended" | "unknown" | null;
  /** Automatic attempts already used for autoCheckKickoffAt. */
  autoCheckAttempts?: number;
  autoCheckKickoffAt?: Date | null;
  autoCheckNextAt?: Date | null;
  autoCheckHistory?: string;
}

export interface PollIntervals {
  regularMinutes: number;
  liveMinutes: number;
  matchDurationMinutes?: number;
}

/** First automatic check is two hours after the stored kickoff, not after an estimated finish. */
export const FIRST_CHECK_MINUTES = 120;
export const AUTO_RETRY_MINUTES = 5;
export const MAX_AUTO_ATTEMPTS = 10;
export const CHECK_POLICY_TEXT =
  "Первая проверка — через 2 часа после начала матча. Затем каждые 5 минут, до 10 автоматических попыток всего.";
export const CHECK_EXHAUSTED_TEXT = "Автопроверка остановлена: 10 попыток, итоговый результат не подтверждён";
export const DEFAULT_MATCH_DURATION_MINUTES = 120;

export type ResultCheckBasis = "kickoff" | "retry";

export interface ResultCheck {
  at: Date;
  basis: ResultCheckBasis;
}

export interface RoundPollPlan {
  pollStatus: RoundPollStatus;
  active: boolean;
  nextPollAt: Date | null;
  reason: string;
}

const DAY_MINUTES = 24 * 60;

function clampMinutes(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.round(parsed), DAY_MINUTES);
}

/** Hourly by default. A retry after the finish window uses the shorter gap. Both come from the environment. */
export function pollIntervals(env: NodeJS.ProcessEnv = process.env): PollIntervals {
  return {
    regularMinutes: clampMinutes(env.RESULT_POLL_INTERVAL_MINUTES, 60),
    liveMinutes: clampMinutes(env.RESULT_POLL_LIVE_INTERVAL_MINUTES, 15),
    matchDurationMinutes: clampMinutes(env.MATCH_DURATION_MINUTES, DEFAULT_MATCH_DURATION_MINUTES),
  };
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

export interface FixtureCheckStatus {
  attempts: number;
  limit: number;
  nextAt: Date | null;
  exhausted: boolean;
  verified: boolean;
  held: boolean;
}

function sameInstant(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return left != null && right != null && left.getTime() === right.getTime();
}

/** A new accepted kickoff starts at zero. The same kickoff, including a repeated import, keeps the budget. */
export function checkCycle(fixture: PollFixture): { attempts: number; reset: boolean } {
  const reset = Boolean(fixture.kickoffAt && fixture.autoCheckKickoffAt && !sameInstant(fixture.kickoffAt, fixture.autoCheckKickoffAt));
  return { attempts: reset ? 0 : (fixture.autoCheckAttempts ?? 0), reset };
}

function isHeldFixture(fixture: PollFixture): boolean {
  return fixture.providerStatus === "postponed" || fixture.providerStatus === "cancelled" || fixture.providerStatus === "suspended";
}

/** Next automatic check for one fixture. This does not write or increment the attempt counter. */
export function fixtureCheckStatus(fixture: PollFixture): FixtureCheckStatus {
  const cycle = checkCycle(fixture);
  const verified = isVerified(fixture);
  const held = isHeldFixture(fixture);
  const acknowledged = fixture.resultConflict && fixture.conflictAcknowledgedAt != null;
  const exhausted = !cycle.reset && !verified && !held && cycle.attempts >= MAX_AUTO_ATTEMPTS;
  let nextAt: Date | null = null;
  if (!verified && !held && !acknowledged && !exhausted && fixture.kickoffAt) {
    nextAt = cycle.attempts === 0 ? addMinutes(fixture.kickoffAt, FIRST_CHECK_MINUTES) : (fixture.autoCheckNextAt ?? null);
  }
  return { attempts: cycle.attempts, limit: MAX_AUTO_ATTEMPTS, nextAt, exhausted, verified, held };
}

/**
 * The first automatic check is the stored kickoff plus two hours.
 * A later retry uses the time stored after the previous attempt.
 * A postponed or cancelled fixture is not polled against the obsolete kickoff.
 */
export function resultCheckAt(fixture: PollFixture, now: Date, durationMinutes?: number, retryMinutes?: number): ResultCheck | null {
  void durationMinutes;
  void retryMinutes;
  if (!fixtureBlocksPolling(fixture, now)) {
    return null;
  }
  const status = fixtureCheckStatus(fixture);
  if (!status.nextAt) {
    return null;
  }
  return { at: status.nextAt, basis: status.attempts === 0 ? "kickoff" : "retry" };
}

/** The next time a check may run. A future kickoff estimate wins. An overdue fixture waits out a stored retry. */
export function effectiveNextCheck(plan: RoundPollPlan, stored: Date | null, now: Date): Date | null {
  if (!plan.active) {
    return null;
  }
  const target = plan.nextPollAt;
  if (target && target.getTime() > now.getTime()) {
    return target;
  }
  if (stored && stored.getTime() > now.getTime()) {
    return stored;
  }
  return target ?? stored;
}

export function nextPollAfterCheck(plan: RoundPollPlan, checkedAt: Date, retryMinutes?: number): Date | null {
  void retryMinutes;
  if (!plan.active || !plan.nextPollAt) {
    return null;
  }
  if (plan.nextPollAt.getTime() > checkedAt.getTime()) {
    return plan.nextPollAt;
  }
  return addMinutes(checkedAt, AUTO_RETRY_MINUTES);
}

export interface StoredFixtureCheck {
  kickoffAt: Date | null;
  autoCheckAttempts: number;
  autoCheckKickoffAt: Date | null;
  autoCheckNextAt: Date | null;
  autoCheckHistory?: string;
  verified: boolean;
  held: boolean;
  acknowledged: boolean;
}

function readHistory(value: string | undefined): { kickoffAt: string | null; attempts: number; endedAt: string }[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as { kickoffAt: string | null; attempts: number; endedAt: string }[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * One completed automatic check uses one attempt and schedules the next five minutes later.
 * A manual refresh leaves the budget unchanged. Ten attempts, or a verified result, clears the next check.
 * A changed kickoff archives the old cycle and starts again. The same kickoff does not.
 */
export function advanceFixtureCheck(fixture: StoredFixtureCheck, checkedAt: Date, automatic: boolean): StoredFixtureCheck {
  const reset = Boolean(fixture.kickoffAt && fixture.autoCheckKickoffAt && !sameInstant(fixture.kickoffAt, fixture.autoCheckKickoffAt));
  let attempts = reset ? 0 : fixture.autoCheckAttempts;
  let history = fixture.autoCheckHistory ?? "[]";
  if (reset && fixture.autoCheckAttempts > 0) {
    const previous = readHistory(history);
    previous.push({
      kickoffAt: fixture.autoCheckKickoffAt?.toISOString() ?? null,
      attempts: fixture.autoCheckAttempts,
      endedAt: checkedAt.toISOString(),
    });
    history = JSON.stringify(previous);
  }
  let nextAt = attempts === 0 && fixture.kickoffAt ? addMinutes(fixture.kickoffAt, FIRST_CHECK_MINUTES) : fixture.autoCheckNextAt;
  if (reset && fixture.kickoffAt) {
    nextAt = addMinutes(fixture.kickoffAt, FIRST_CHECK_MINUTES);
  }
  const due = nextAt != null && nextAt.getTime() <= checkedAt.getTime() && attempts < MAX_AUTO_ATTEMPTS && !fixture.held && !fixture.acknowledged;
  if (automatic && due) {
    attempts += 1;
  }
  if (fixture.verified || fixture.acknowledged || fixture.held || attempts >= MAX_AUTO_ATTEMPTS) {
    nextAt = null;
  } else if (automatic && due) {
    nextAt = addMinutes(checkedAt, AUTO_RETRY_MINUTES);
  }
  return { ...fixture, autoCheckAttempts: attempts, autoCheckKickoffAt: fixture.kickoffAt, autoCheckNextAt: nextAt, autoCheckHistory: history };
}

function hasScore(fixture: PollFixture): boolean {
  return fixture.actualHomeGoals != null && fixture.actualAwayGoals != null;
}

function isVerified(fixture: PollFixture): boolean {
  if (fixture.resultConflict) {
    return false;
  }
  if (fixture.resultState === "manual") {
    return true;
  }
  return fixture.resultResolution === "verified" || fixture.resultState === "verified";
}

/** Derive the operator-facing fixture state from the stored result and kickoff. */
export function fixturePhase(fixture: PollFixture, now: Date): FixturePhase {
  if (fixture.resultConflict) {
    return "conflict-review";
  }
  if (isVerified(fixture)) {
    return "finished-verified";
  }
  if (hasScore(fixture)) {
    return "finished-unverified";
  }
  if (fixture.liveReported) {
    return "live";
  }
  if (fixture.kickoffAt && fixture.kickoffAt.getTime() <= now.getTime()) {
    return "live";
  }
  return "scheduled";
}

export function fixturePhaseLabel(phase: FixturePhase, acknowledged: boolean): string {
  if (phase === "conflict-review") {
    return acknowledged ? "Source conflict acknowledged" : "Source conflict";
  }
  if (phase === "finished-verified") {
    return "Source verified";
  }
  if (phase === "finished-unverified") {
    return "Finished, not source verified";
  }
  if (phase === "live") {
    return "Live round";
  }
  return "Scheduled";
}

export function pollStatusLabel(status: RoundPollStatus): "Live round" | "Finalized round" | "Scheduled" {
  if (status === "live") {
    return "Live round";
  }
  if (status === "finalized") {
    return "Finalized round";
  }
  return "Scheduled";
}

/** A verified fixture is final. An acknowledged conflict stays visible but no longer blocks the round. */
export function fixtureBlocksPolling(fixture: PollFixture, now: Date): boolean {
  const phase = fixturePhase(fixture, now);
  if (phase === "conflict-review") {
    return fixture.conflictAcknowledgedAt == null;
  }
  return phase !== "finished-verified";
}

export function planRoundPoll(fixtures: readonly PollFixture[], now: Date, intervals: PollIntervals): RoundPollPlan {
  void intervals;
  if (fixtures.length === 0) {
    return { pollStatus: "scheduled", active: false, nextPollAt: null, reason: "This round has no fixtures." };
  }
  const blocking = fixtures.filter((fixture) => fixtureBlocksPolling(fixture, now));
  if (blocking.length === 0) {
    return {
      pollStatus: "finalized",
      active: false,
      nextPollAt: null,
      reason: "All fixtures are final. Unresolved conflicts are absent or acknowledged.",
    };
  }
  const statuses = fixtures.map((fixture) => fixtureCheckStatus(fixture));
  const nextPollAt = statuses
    .flatMap((status) => (status.nextAt ? [status.nextAt] : []))
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const phases = fixtures.map((fixture) => fixturePhase(fixture, now));
  const pollStatus: RoundPollStatus = phases.includes("live") ? "live" : "scheduled";
  if (!nextPollAt) {
    const exhausted = statuses.some((status) => status.exhausted);
    return {
      pollStatus,
      active: false,
      nextPollAt: null,
      reason: exhausted ? CHECK_EXHAUSTED_TEXT : "The provider postponed or cancelled the match, so the old kickoff is not polled.",
    };
  }
  return { pollStatus, active: true, nextPollAt, reason: CHECK_POLICY_TEXT };
}

export function isPollDue(plan: RoundPollPlan, nextPollAt: Date | null, now: Date, force: boolean): boolean {
  if (!plan.active) {
    return false;
  }
  if (force) {
    return true;
  }
  const due = effectiveNextCheck(plan, nextPollAt, now);
  if (!due) {
    return true;
  }
  return due.getTime() <= now.getTime();
}

export function selectDueRoundIds(
  rounds: readonly { id: string; nextPollAt: Date | null; matches: readonly PollFixture[]; standingRole?: string }[],
  now: Date,
  intervals: PollIntervals,
  forceRoundId?: string,
): string[] {
  return rounds.flatMap((round) => {
    const forced = forceRoundId === round.id;
    if (round.standingRole === "archived" && !forced) {
      return [];
    }
    const plan = planRoundPoll(round.matches, now, intervals);
    return isPollDue(plan, round.nextPollAt, now, forced) ? [round.id] : [];
  });
}

export function strongestSuccessfulSource(sources: readonly { source: string; status: string }[]): string | null {
  const ready = sources.filter((source) => source.status === "ok");
  if (ready.length === 0) {
    return null;
  }
  return [...ready].sort((left, right) => (SOURCE_RANK[right.source]?.weight ?? 0) - (SOURCE_RANK[left.source]?.weight ?? 0))[0]?.source ?? null;
}

export function sourceHealthSummary(sources: readonly { source: string; status: string; error: string | null }[]): string {
  if (sources.length === 0) {
    return "No sources were checked.";
  }
  return sources.map((source) => (source.error ? `${source.source} ${source.status}: ${source.error}` : `${source.source} ${source.status}`)).join("; ");
}
