import { effectiveNextCheck, type RoundPollPlan } from "@/lib/domain/results/poll";
import { describeRefreshQuery, type RefreshQuery } from "@/lib/domain/results/refresh-status";
import { Notice } from "../../ui";
import { RefreshResultsButton } from "./refresh-results-button";

function formatUtc(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function MatchResultsRefresh({
  roundId,
  returnTo,
  lastPolledAt,
  nextPollAt,
  lastSuccessfulSource,
  pollHealthSummary,
  plan,
  now,
  query,
}: {
  roundId: string;
  returnTo: "review" | "fixtures";
  lastPolledAt: Date | null;
  nextPollAt: Date | null;
  lastSuccessfulSource: string | null;
  pollHealthSummary: string | null;
  plan: RoundPollPlan;
  now: Date;
  query: RefreshQuery;
}) {
  const outcome = describeRefreshQuery(query);
  const next = effectiveNextCheck(plan, nextPollAt, now);
  const nextLabel = !plan.active ? "stopped" : next && next.getTime() > now.getTime() ? formatUtc(next) : "due now";
  const sourcesFailed = Boolean(pollHealthSummary && !pollHealthSummary.includes(" ok") && pollHealthSummary.includes("failed"));
  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      {outcome ? <Notice tone={outcome.tone}>{outcome.text}</Notice> : null}
      <p className="mt-2 text-xs text-zinc-600">
        Last refresh attempt {lastPolledAt ? formatUtc(lastPolledAt) : "not recorded"}
        {" · "}
        Last successful source refresh {lastSuccessfulSource ?? "none"}
        {" · "}
        Next automatic check {nextLabel}
      </p>
      <p className="mt-1 text-xs text-zinc-600">{plan.reason}</p>
      {sourcesFailed ? <p className="mt-1 text-xs text-red-700">{pollHealthSummary}</p> : pollHealthSummary ? <p className="mt-1 text-xs text-zinc-600">{pollHealthSummary}</p> : null}
      <div className="mt-3">
        <RefreshResultsButton returnTo={returnTo} roundId={roundId} />
      </div>
    </div>
  );
}
