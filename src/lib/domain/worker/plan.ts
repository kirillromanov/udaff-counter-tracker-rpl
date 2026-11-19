import { planPredictionRefresh, selectDuePredictionRoundIds } from "@/lib/domain/import/incremental";
import { CHECK_EXHAUSTED_TEXT, planRoundPoll, pollIntervals, selectDueRoundIds, type PollFixture, type PollIntervals } from "@/lib/domain/results/poll";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";

export interface WorkerRound {
  id: string;
  number: number;
  standingRole: string;
  forumUrl: string | null;
  nextPollAt: Date | null;
  nextPredictionFetchAt: Date | null;
  closedAt: Date | null;
  productionStartedAt: Date | null;
  matches: readonly PollFixture[];
}

export type WorkerJob = "prediction-refresh" | "result-check";

export interface PlanLine {
  roundId: string;
  number: number;
  job: WorkerJob;
  /** Eligible under the existing selector. Result checks stay unrun. */
  eligible: boolean;
  disposition: "run" | "skip";
  reason: string;
  nextAt: string | null;
}

/** Read-only eligibility. This does not fetch, claim, or write. */
export function planWorker(rounds: readonly WorkerRound[], now: Date, intervals: PollIntervals = pollIntervals()): PlanLine[] {
  const lines: PlanLine[] = [];
  for (const round of rounds) {
    lines.push(predictionLine(round, now, intervals));
    lines.push(resultLine(round, now, intervals));
  }
  return lines;
}

export function nextPredictionDueAt(lines: readonly PlanLine[], now: Date): Date | null {
  const stamps = lines.flatMap((line) => {
    if (line.job !== "prediction-refresh" || !line.nextAt) {
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
  const results = planRoundPoll(round.matches, now, intervals);
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
  if (due) {
    return line(round, "prediction-refresh", true, "run", "due", plan.nextAt);
  }
  if (!round.forumUrl && !round.closedAt && round.standingRole !== ARCHIVED_ROUND && round.productionStartedAt !== null) {
    return line(round, "prediction-refresh", false, "skip", "no-forum-url", null);
  }
  return line(round, "prediction-refresh", false, "skip", inactiveReason(round, plan.active, results.reason, plan.nextAt, round.nextPredictionFetchAt, now), plan.nextAt ?? round.nextPredictionFetchAt);
}

function resultLine(round: WorkerRound, now: Date, intervals: PollIntervals): PlanLine {
  const due = selectDueRoundIds([round], now, intervals).includes(round.id);
  const plan = planRoundPoll(round.matches, now, intervals);
  if (due) {
    return line(round, "result-check", true, "skip", "scoring-decision", plan.nextPollAt);
  }
  return line(round, "result-check", false, "skip", inactiveReason(round, plan.active, plan.reason, plan.nextPollAt, round.nextPollAt, now), plan.nextPollAt ?? round.nextPollAt);
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
