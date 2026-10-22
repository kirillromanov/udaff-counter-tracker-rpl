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
}

export interface PollIntervals {
  regularMinutes: number;
  liveMinutes: number;
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

/** Hourly by default. A live or disputed round uses the shorter gap. Both come from the environment. */
export function pollIntervals(env: NodeJS.ProcessEnv = process.env): PollIntervals {
  return {
    regularMinutes: clampMinutes(env.RESULT_POLL_INTERVAL_MINUTES, 60),
    liveMinutes: clampMinutes(env.RESULT_POLL_LIVE_INTERVAL_MINUTES, 15),
  };
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
  const phases = fixtures.map((fixture) => fixturePhase(fixture, now));
  const pollStatus: RoundPollStatus = phases.includes("live") ? "live" : "scheduled";
  const urgent = blocking.some((fixture) => {
    const phase = fixturePhase(fixture, now);
    return phase === "live" || phase === "finished-unverified" || phase === "conflict-review";
  });
  const minutes = urgent ? intervals.liveMinutes : intervals.regularMinutes;
  let nextPollAt = new Date(now.getTime() + minutes * 60_000);
  const nextKickoff = fixtures
    .filter((fixture) => fixturePhase(fixture, now) === "scheduled" && fixture.kickoffAt && fixture.kickoffAt.getTime() > now.getTime())
    .map((fixture) => fixture.kickoffAt as Date)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (nextKickoff && nextKickoff.getTime() < nextPollAt.getTime()) {
    nextPollAt = nextKickoff;
  }
  const unacknowledged = blocking.some((fixture) => fixturePhase(fixture, now) === "conflict-review");
  const unverified = blocking.some((fixture) => fixturePhase(fixture, now) === "finished-unverified");
  const reason = unacknowledged
    ? "Polling continues until the source conflict is resolved or acknowledged."
    : unverified
      ? "Polling continues until finished scores are verified."
      : phases.includes("live")
        ? "A match is in progress, so the next check is sooner."
        : "Polling continues until the remaining matches finish.";
  return { pollStatus, active: true, nextPollAt, reason };
}

export function isPollDue(plan: RoundPollPlan, nextPollAt: Date | null, now: Date, force: boolean): boolean {
  if (!plan.active) {
    return false;
  }
  if (force) {
    return true;
  }
  if (!nextPollAt) {
    return true;
  }
  return nextPollAt.getTime() <= now.getTime();
}

export function selectDueRoundIds(
  rounds: readonly { id: string; nextPollAt: Date | null; matches: readonly PollFixture[] }[],
  now: Date,
  intervals: PollIntervals,
  forceRoundId?: string,
): string[] {
  return rounds.flatMap((round) => {
    const plan = planRoundPoll(round.matches, now, intervals);
    return isPollDue(plan, round.nextPollAt, now, forceRoundId === round.id) ? [round.id] : [];
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
