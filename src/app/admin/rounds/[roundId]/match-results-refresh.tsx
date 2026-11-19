import { effectiveNextCheck, type FixtureCheckStatus, type RoundPollPlan } from "@/lib/domain/results/poll";
import { describeRefreshQuery, type RefreshQuery } from "@/lib/domain/results/refresh-status";
import { Notice } from "../../ui";
import { RefreshResultsButton } from "./refresh-results-button";

import { formatMoscow } from "@/lib/domain/time/moscow";

function formatWhen(value: Date): string {
  return formatMoscow(value);
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
  checks = [],
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
  checks?: { label: string; status: FixtureCheckStatus }[];
}) {
  const outcome = describeRefreshQuery(query);
  const next = effectiveNextCheck(plan, nextPollAt, now);
  const nextLabel = !plan.active ? "stopped" : next && next.getTime() > now.getTime() ? formatWhen(next) : "due now";
  const sourcesFailed = Boolean(pollHealthSummary && !pollHealthSummary.includes(" ok") && pollHealthSummary.includes("failed"));
  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      {outcome ? <Notice tone={outcome.tone}>{outcome.text}</Notice> : null}
      {query.calc === "stale" ? (
        <Notice tone="error">Results were saved. Standings calculation failed, so the export is stale.</Notice>
      ) : query.calc === "partial" || query.calc === "complete" || query.calc === "empty" ? (
        <Notice tone={query.calc === "empty" ? "info" : "success"}>
          {query.calc === "empty"
            ? "No verified completed matches yet. Pending fixtures were skipped."
            : `Рассчитано по ${query.included ?? "0"} из ${query.fixtureCount ?? "0"} матчей.`}
        </Notice>
      ) : null}
      <p className="mt-2 text-xs text-zinc-600">
        Last refresh attempt {lastPolledAt ? formatWhen(lastPolledAt) : "not recorded"}
        {" · "}
        Last successful source refresh {lastSuccessfulSource ?? "none"}
        {" · "}
        Next automatic check {nextLabel}
      </p>
      <p className="mt-1 text-xs text-zinc-600">{plan.reason}</p>
      {checks.length > 0 ? (
        <ul className="mt-1 space-y-1 text-xs text-zinc-600">
          {checks.map((check) => (
            <li key={check.label}>
              {check.label}
              {": "}
              {check.status.verified
                ? "Итоговый результат подтверждён"
                : check.status.exhausted
                  ? "Автопроверка остановлена: 10 попыток, итоговый результат не подтверждён"
                  : `Попытки ${check.status.attempts}/${check.status.limit}`}
              {check.status.nextAt ? ` · следующая проверка ${formatWhen(check.status.nextAt)}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {sourcesFailed ? <p className="mt-1 text-xs text-red-700">{pollHealthSummary}</p> : pollHealthSummary ? <p className="mt-1 text-xs text-zinc-600">{pollHealthSummary}</p> : null}
      <div className="mt-3">
        <RefreshResultsButton returnTo={returnTo} roundId={roundId} />
      </div>
    </div>
  );
}
