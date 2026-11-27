import { planPredictionRefresh, selectDuePredictionRoundIds } from "@/lib/domain/import/incremental";
import { resultVerificationApplies } from "@/lib/domain/results/eligibility";
import { CHECK_EXHAUSTED_TEXT, planRoundPoll, pollIntervals, selectDueRoundIds, type PollFixture, type PollIntervals } from "@/lib/domain/results/poll";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";

export interface WorkerRound {
  id: string;
  number: number;
  seasonSlug: string;
  standingRole: string;
  forumUrl: string | null;
  nextPollAt: Date | null;
  nextPredictionFetchAt: Date | null;
  closedAt: Date | null;
  productionStartedAt: Date | null;
  /** Per-round result switch. The env flag remains the boot-time kill switch. */
  resultsProcessing: boolean;
  matches: readonly PollFixture[];
}

export type WorkerJob = "prediction-refresh" | "result-check";

export interface PlanLine {
  roundId: string;
  number: number;
  job: WorkerJob;
  /** Eligible under the existing selector. */
  eligible: boolean;
  disposition: "run" | "skip";
  reason: string;
  nextAt: string | null;
  /** Count summary from a fetch that just ran. Absent on a plan-only line. */
  outcome?: string;
}

/** Read-only eligibility. This does not fetch, claim, or write. */
export function planWorker(
  rounds: readonly WorkerRound[],
  now: Date,
  intervals: PollIntervals = pollIntervals(),
  options?: { resultsEnabled?: boolean },
): PlanLine[] {
  const lines: PlanLine[] = [];
  for (const round of rounds) {
    lines.push(predictionLine(round, now, intervals));
    lines.push(resultLine(round, now, intervals, options?.resultsEnabled === true));
  }
  return lines;
}

/** Earliest future prediction or result time. The two clocks are not combined into one field. */
export function nextScheduledAt(lines: readonly PlanLine[], now: Date): Date | null {
  const stamps = lines.flatMap((line) => {
    if (!line.nextAt) {
      return [];
    }
    const at = new Date(line.nextAt);
    return at.getTime() > now.getTime() ? [at] : [];
  });
  stamps.sort((left, right) => left.getTime() - right.getTime());
  return stamps[0] ?? null;
}

function predictionLine(round: WorkerRound, now: Date, intervals: PollIntervals): PlanLine {
  const due = selectDuePredictionRoundIds([round], now, intervals).includes(round.id);
  const plan = planPredictionRefresh(
    {
      standingRole: round.standingRole,
      hasForumUrl: Boolean(round.forumUrl),
      productionStartedAt: round.productionStartedAt,
      fixtures: round.matches,
    },
    now,
    intervals,
  );
  const stored = round.nextPredictionFetchAt;
  if (due) {
    return line(round, "prediction-refresh", true, "run", "due", stored);
  }
  if (!round.forumUrl && !round.closedAt && round.standingRole !== ARCHIVED_ROUND && round.productionStartedAt !== null) {
    return line(round, "prediction-refresh", false, "skip", "no-forum-url", null);
  }
  return line(round, "prediction-refresh", false, "skip", inactiveReason(round, plan.active, plan.reason, null, stored, now), stored);
}

function resultLine(round: WorkerRound, now: Date, intervals: PollIntervals, resultsEnabled: boolean): PlanLine {
  const due = selectDueRoundIds([round], now, intervals).includes(round.id);
  const plan = planRoundPoll(round.matches, now, intervals);
  if (due) {
    if (!resultsEnabled) {
      return line(round, "result-check", true, "skip", "results-disabled", plan.nextPollAt);
    }
    if (!round.resultsProcessing) {
      return line(round, "result-check", true, "skip", "round-switch-off", plan.nextPollAt);
    }
    if (!resultVerificationApplies(round)) {
      return line(round, "result-check", false, "skip", "outside-result-scope", plan.nextPollAt);
    }
    return line(round, "result-check", true, "run", "due", plan.nextPollAt);
  }
  return line(round, "result-check", false, "skip", inactiveReason(round, plan.active, plan.reason, plan.nextPollAt, null, now), plan.nextPollAt);
}

function inactiveReason(
  round: WorkerRound,
  active: boolean,
  planReason: string,
  planNext: Date | null,
  storedNext: Date | null,
  now: Date,
): string {
  if (round.closedAt) {
    return "closed";
  }
  if (round.standingRole === ARCHIVED_ROUND) {
    return "archived";
  }
  if (round.productionStartedAt === null) {
    return "preparation";
  }
  if (!active && planReason.includes("forum URL")) {
    return "no-forum-url";
  }
  if (!active && planReason === CHECK_EXHAUSTED_TEXT) {
    return "exhausted";
  }
  if (!active && planReason.includes("no fixtures")) {
    return "no-fixtures";
  }
  if (!active && (planReason.includes("final") || planReason.includes("postponed") || planReason.includes("cancelled"))) {
    return "stopped";
  }
  const next = planNext ?? storedNext;
  if (next && next.getTime() > now.getTime()) {
    return "not-due";
  }
  return "not-due";
}

function line(
  round: WorkerRound,
  job: WorkerJob,
  eligible: boolean,
  disposition: "run" | "skip",
  reason: string,
  nextAt: Date | null,
): PlanLine {
  return {
    roundId: round.id,
    number: round.number,
    job,
    eligible,
    disposition,
    reason,
    nextAt: nextAt ? nextAt.toISOString() : null,
  };
}
