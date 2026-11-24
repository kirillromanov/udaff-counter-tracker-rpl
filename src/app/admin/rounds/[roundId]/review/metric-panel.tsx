import type { MetricComment, MetricSet, ResultIssueRow, RoundMetric } from "@/lib/domain/review/round-metrics";
import { explainSetIssue } from "@/lib/domain/review/round-metrics";

const TITLES: Record<RoundMetric, string> = {
  comments: "Comments",
  sets: "Sets",
  selected: "Selected",
  stored: "Stored sets",
  conflicts: "Conflicts",
  corrections: "Need correction",
  scored: "Fixtures scored",
  results: "Result issues",
};

function IssueBody({ reason, evidence, decision, actions, kind }: { reason: string; evidence: string; decision: string; actions: string[]; kind?: string }) {
  return (
    <div className="text-sm">
      <p className="font-medium">{reason}{kind === "notice" ? " · not blocking" : kind === "pending" ? " · not an error" : ""}</p>
      <p className="mt-1 text-zinc-700">{evidence}</p>
      <p className="mt-1 text-zinc-700">Decide: {decision}</p>
      <p className="mt-1 text-zinc-600">Allowed: {actions.join("; ")}.</p>
    </div>
  );
}

export function MetricPanel({
  metric,
  comments,
  sets,
  scored,
  results,
}: {
  metric: RoundMetric;
  comments: MetricComment[];
  sets: MetricSet[];
  scored: { id: string; homeTeam: string; awayTeam: string; actualHomeGoals: number | null; actualAwayGoals: number | null; resultState: string }[];
  results: ResultIssueRow[];
}) {
  const issueSets = metric === "conflicts" || metric === "corrections" || metric === "selected" || metric === "sets" || metric === "stored";
  const shownSets = issueSets ? sets : [];
  const pendingCount = results.filter((row) => row.kind === "pending").length;
  const issueCount = metric === "results"
    ? results.filter((row) => row.kind !== "pending").length
    : metric === "comments"
      ? comments.length
      : metric === "scored"
        ? scored.length
        : shownSets.length;
  return (
    <section aria-labelledby="metric-panel-title" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm" id="metric-panel">
      <h2 className="font-semibold text-zinc-950" id="metric-panel-title">{TITLES[metric]}</h2>
      <p className="mt-1 text-xs text-zinc-600">
        {issueCount} {issueCount === 1 ? "record" : "records"}
        {metric === "results"
          ? `. ${pendingCount} pending ${pendingCount === 1 ? "fixture is" : "fixtures are"} not included.`
          : "."}
      </p>
      {metric === "comments" ? (
        comments.length === 0 ? <p className="mt-2 text-zinc-600">No comments for this counter.</p> : (
          <ul className="mt-2 space-y-2">
            {comments.map((comment) => (
              <li className="rounded-md border border-zinc-200 px-3 py-2" key={comment.id}>
                <p className="font-medium">{comment.authorName}{comment.externalId ? ` · comment ${comment.externalId}` : ""}</p>
                <p className="text-xs text-zinc-600">Status {comment.ingestionStatus}, review {comment.reviewState}.{comment.reviewNote ? ` ${comment.reviewNote}` : " No review note is stored."}</p>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {metric === "scored" ? (
        scored.length === 0 ? <p className="mt-2 text-zinc-600">No scored fixtures for this counter.</p> : (
          <ul className="mt-2 space-y-2">
            {scored.map((fixture) => (
              <li className="rounded-md border border-zinc-200 px-3 py-2" key={fixture.id}>
                <p className="font-medium">{fixture.homeTeam} — {fixture.awayTeam}</p>
                <p className="text-xs text-zinc-600">Stored score {fixture.actualHomeGoals}-{fixture.actualAwayGoals}. Status {fixture.resultState || "none"}.</p>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {issueSets ? (
        shownSets.length === 0 ? <p className="mt-2 text-zinc-600">No records for this counter.</p> : (
          <ul className="mt-2 space-y-2">
            {shownSets.map((set) => {
              const issue = explainSetIssue(set);
              return (
                <li className="rounded-md border border-zinc-200 px-3 py-2" key={set.id}>
                  <p className="font-medium">{set.authorName ?? "Comment"}{set.externalId ? ` · ${set.externalId}` : ""}{set.selected ? " · selected" : ""}</p>
                  {issue ? <div className="mt-1"><IssueBody actions={issue.actions} decision={issue.decision} evidence={issue.evidence} reason={issue.reason} /></div> : <p className="text-xs text-zinc-600">No conflict or correction is stored on this slip.</p>}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      {metric === "results" ? <ResultGroups rows={results} /> : null}
    </section>
  );
}

function ResultGroups({ rows }: { rows: ResultIssueRow[] }) {
  const blocking = rows.filter((row) => row.kind === "blocking");
  const notices = rows.filter((row) => row.kind === "notice");
  const pending = rows.filter((row) => row.kind === "pending");
  if (rows.length === 0) {
    return <p className="mt-2 text-zinc-600">No result issues.</p>;
  }
  return (
    <div className="mt-2 space-y-3">
      <Group heading="Blocking" rows={blocking} empty="No blocking result issues." />
      <Group heading="Not blocking" rows={notices} empty="No manual-result notices." />
      <Group heading="Pending, not an error" rows={pending} empty="No fixtures are waiting for a score." />
    </div>
  );
}

function Group({ heading, rows, empty }: { heading: string; rows: ResultIssueRow[]; empty: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{heading}</h3>
      {rows.length === 0 ? <p className="mt-1 text-zinc-600">{empty}</p> : (
        <ul className="mt-1 space-y-2">
          {rows.map((row) => (
            <li className={row.kind === "blocking" ? "rounded-md border border-rose-200 px-3 py-2" : "rounded-md border border-zinc-200 px-3 py-2"} key={row.id}>
              <p className="font-medium">{row.title}</p>
              <IssueBody actions={row.actions} decision={row.decision} evidence={row.evidence} kind={row.kind} reason={row.reason} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
