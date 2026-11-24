import { effectiveNextCheck, type FixtureCheckStatus, type RoundPollPlan } from "@/lib/domain/results/poll";
import { describeRefreshQuery, refreshSummaryLine, type RefreshQuery } from "@/lib/domain/results/refresh-status";
import { formatMoscow } from "@/lib/domain/time/moscow";
import { Notice } from "../../ui";
import { RefreshResultsButton } from "./refresh-results-button";
import { RefreshStatusBar } from "./refresh-status-bar";

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
  const summary = refreshSummaryLine({
    query,
    lastAttempt: lastPolledAt ? formatWhen(lastPolledAt) : null,
    automaticChecksActive: plan.active,
    health: pollHealthSummary,
  });
  return (
    <RefreshStatusBar
      action={<RefreshResultsButton returnTo={returnTo} roundId={roundId} />}
      summary={summary.text}
      tone={summary.tone}
    >
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
      <p>
        Last refresh attempt {lastPolledAt ? formatWhen(lastPolledAt) : "not recorded"}
        {" · "}
        Last successful source refresh {lastSuccessfulSource ?? "none"}
        {" · "}
        Next automatic check {nextLabel}
      </p>
      <p>{plan.reason}</p>
      {checks.length > 0 ? (
        <ul className="space-y-1">
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
      {pollHealthSummary ? <p className={summary.tone === "error" || summary.tone === "warning" ? "text-red-700" : undefined}>{pollHealthSummary}</p> : null}
    </RefreshStatusBar>
  );
}
