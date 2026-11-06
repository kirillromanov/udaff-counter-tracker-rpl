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
}

export interface PollIntervals {
  regularMinutes: number;
  liveMinutes: number;
  matchDurationMinutes?: number;
}

/** Two hours after finish. This is not kickoff plus two hours. */
export const RESULT_CHECK_DELAY_MINUTES = 120;
export const DEFAULT_MATCH_DURATION_MINUTES = 120;

export type ResultCheckBasis = "finished" | "estimated" | "retry";

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

/**
 * When to check one fixture.
 * A recorded finish schedules finishedAt + 2 hours.
 * Otherwise kickoff + expected duration is the estimated finish, and the check is 2 hours after that.
 * The clock alone never marks the match finished. A postponed or still-live provider status is a retry.
 */
export function resultCheckAt(fixture: PollFixture, now: Date, durationMinutes: number, retryMinutes: number): ResultCheck | null {
  if (!fixtureBlocksPolling(fixture, now)) {
    return null;
  }
  const status = fixture.providerStatus;
  if (status === "postponed" || status === "cancelled" || status === "suspended") {
    return { at: addMinutes(now, retryMinutes), basis: "retry" };
  }
  if (fixture.finishedAt) {
    return { at: addMinutes(fixture.finishedAt, RESULT_CHECK_DELAY_MINUTES), basis: "finished" };
  }
  if (fixture.kickoffAt) {
    return { at: addMinutes(addMinutes(fixture.kickoffAt, durationMinutes), RESULT_CHECK_DELAY_MINUTES), basis: "estimated" };
  }
  return { at: addMinutes(now, retryMinutes), basis: "retry" };
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

export function nextPollAfterCheck(plan: RoundPollPlan, checkedAt: Date, retryMinutes: number): Date | null {
  if (!plan.active || !plan.nextPollAt) {
    return null;
  }
  if (plan.nextPollAt.getTime() > checkedAt.getTime()) {
    return plan.nextPollAt;
  }
  return addMinutes(checkedAt, retryMinutes);
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
  const duration = intervals.matchDurationMinutes ?? DEFAULT_MATCH_DURATION_MINUTES;
  const checks = blocking.flatMap((fixture) => {
    const check = resultCheckAt(fixture, now, duration, intervals.liveMinutes);
    return check ? [check] : [];
  });
  const earliest = checks.sort((left, right) => left.at.getTime() - right.at.getTime())[0];
  const nextPollAt = earliest?.at ?? addMinutes(now, intervals.liveMinutes);
  const phases = fixtures.map((fixture) => fixturePhase(fixture, now));
  const pollStatus: RoundPollStatus = phases.includes("live") ? "live" : "scheduled";
  const unacknowledged = blocking.some((fixture) => fixturePhase(fixture, now) === "conflict-review");
  const held = blocking.some((fixture) => {
    const status = fixture.providerStatus;
    return status === "postponed" || status === "cancelled" || status === "suspended" || status === "live";
  });
  const windowPassed = Boolean(earliest && earliest.basis !== "retry" && earliest.at.getTime() <= now.getTime());
  const reason = held
    ? "The provider has not finished the match, so elapsed time does not finalize it. The next check uses the retry interval."
    : unacknowledged
      ? "Polling continues until the source conflict is resolved or acknowledged."
      : windowPassed
        ? `The finish window has passed and the result is still open, so the next check waits ${intervals.liveMinutes} minutes.`
        : earliest?.basis === "finished"
          ? "Next check is 2 hours after the recorded finish."
          : earliest?.basis === "estimated"
            ? `Next check is 2 hours after the estimated finish (kickoff plus ${duration} minutes).`
            : `The finish window has passed and the result is still open, so the next check waits ${intervals.liveMinutes} minutes.`;
  return { pollStatus, active: true, nextPollAt, reason };
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
