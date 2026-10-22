import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  OPERATOR_LABEL,
  comparisonLabel,
  operatorTone,
  reconciliationViewOf,
  rowInReconciliationView,
  unknownAuthorLabel,
  type ReconciliationView,
} from "@/lib/domain/review/operator-status";
import { loadReconciliation } from "@/lib/domain/standings/load-reconciliation";
import type { ComparisonRow, ReconciliationCause, ReconciliationReport } from "@/lib/domain/standings/reconcile";
import { SeasonLayers } from "../../../layers";
import { SubmitButton } from "../../../submit-button";
import {
  Badge,
  CrumbLink,
  EmptyState,
  Field,
  FilterLink,
  KpiGrid,
  Notice,
  PageBody,
  PageHeader,
  Section,
  buttonClass,
  fieldClass,
} from "../../../ui";
import { markAliasAction, rebuildComputedAction, reconciliationDecisionAction } from "./actions";

export const instant = false;

const CAUSE_LABEL: Record<ReconciliationCause, string> = {
  parser_extraction: "Parser extraction",
  participant_matching: "Participant matching",
  scoring_logic: "Scoring logic",
  missing_round_data: "Missing round data",
  source_content: "Source content",
};

const DECISION_LABEL = {
  accept_computed: "Accepted computed",
  keep_manual: "Keeping manual",
  alias: "Alias marked",
  manual_correction: "Needs correction",
} as const;

function causeTone(cause: ReconciliationCause | null): "success" | "warning" | "danger" | "info" | "neutral" {
  if (cause === "parser_extraction" || cause === "scoring_logic") {
    return "danger";
  }
  if (cause === "participant_matching" || cause === "missing_round_data" || cause === "source_content") {
    return "warning";
  }
  return "success";
}

function statusLabel(status: ComparisonRow["status"]): string {
  if (status === "exact") {
    return "Exact match";
  }
  if (status === "missing") {
    return "Missing";
  }
  if (status === "unmatched_name") {
    return "Unmatched name";
  }
  return "Differs";
}

function DecisionControls({
  seasonId,
  afterRoundNumber,
  row,
}: {
  seasonId: string;
  afterRoundNumber: number;
  row: ComparisonRow;
}) {
  const fields = () => (
    <>
      <input name="seasonId" type="hidden" value={seasonId} />
      <input name="afterRoundNumber" type="hidden" value={afterRoundNumber} />
      <input name="subjectName" type="hidden" value={row.displayName} />
      <input name="participantId" type="hidden" value={row.participantId ?? ""} />
    </>
  );
  return (
    <div className="flex min-w-56 flex-col gap-2">
      {row.computed ? (
        <form action={reconciliationDecisionAction}>
          {fields()}
          <input name="action" type="hidden" value="accept_computed" />
          <SubmitButton pendingLabel="Saving…" variant="primary">
            Accept reference result
          </SubmitButton>
        </form>
      ) : null}
      <form action={reconciliationDecisionAction}>
        {fields()}
        <input name="action" type="hidden" value="keep_manual" />
        <SubmitButton pendingLabel="Saving…">Keep trusted baseline</SubmitButton>
      </form>
      <form action={reconciliationDecisionAction} className="flex flex-wrap items-center gap-2">
        {fields()}
        <input name="action" type="hidden" value="manual_correction" />
        <input className={`${fieldClass} w-36`} name="note" placeholder="What to correct" />
        <SubmitButton pendingLabel="Saving…">Mark for correction</SubmitButton>
      </form>
    </div>
  );
}

function ComparisonTable({
  rows,
  seasonId,
  afterRoundNumber,
}: {
  rows: ComparisonRow[];
  seasonId: string;
  afterRoundNumber: number;
}) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing in this group" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs tracking-wide text-zinc-500 uppercase">
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Trusted baseline</th>
            <th className="py-2 pr-3 font-medium">Reference calculation</th>
            <th className="py-2 pr-3 font-medium">Cause</th>
            <th className="py-2 font-medium">Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-zinc-100 align-top last:border-0" key={row.displayName}>
              <td className="py-3 pr-3">
                <div className="font-medium">{row.displayName}</div>
                <div className="mt-1">
                  <Badge tone={row.status === "exact" ? "success" : "warning"}>{statusLabel(row.status)}</Badge>
                </div>
              </td>
              <td className="py-3 pr-3 tabular-nums text-zinc-700">
                #{row.checkpoint.rank} · {row.checkpoint.totalPoints} pts · {row.checkpoint.movement} {row.checkpoint.movementDelta} · ☼ {row.checkpoint.markerCount}
              </td>
              <td className="py-3 pr-3 tabular-nums text-zinc-700">
                {row.computed
                  ? `#${row.computed.rank} · ${row.computed.totalPoints} pts · ${row.computed.movement} ${row.computed.movementDelta} · ☼ ${row.computed.roundWins}`
                  : "Not calculated"}
                {row.fields.length > 0 ? <p className="mt-1 text-xs text-zinc-500">{row.fields.join("; ")}</p> : null}
              </td>
              <td className="max-w-xs py-3 pr-3">
                {comparisonLabel(row) ? (
                  <Badge tone={operatorTone(comparisonLabel(row)!)}>{OPERATOR_LABEL[comparisonLabel(row)!]}</Badge>
                ) : (
                  <Badge tone="success">Exact match</Badge>
                )}
                {row.cause ? (
                  <span className="ml-1">
                    <Badge tone={causeTone(row.cause)}>{CAUSE_LABEL[row.cause]}</Badge>
                  </span>
                ) : null}
                <p className="mt-1 text-xs text-zinc-500">{row.causeDetail}</p>
                {row.decision ? (
                  <p className="mt-2 text-xs text-zinc-700">
                    <Badge tone="info">{DECISION_LABEL[row.decision.action]}</Badge>
                    {row.decision.note ? <span className="ml-1">{row.decision.note}</span> : null}
                  </p>
                ) : null}
              </td>
              <td className="py-3">
                {row.status === "exact" ? (
                  <span className="text-xs text-zinc-400">No action</span>
                ) : (
                  <DecisionControls afterRoundNumber={afterRoundNumber} row={row} seasonId={seasonId} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function reportBody(
  report: ReconciliationReport,
  seasonId: string,
  roundHref: Map<number, string>,
  participants: { id: string; name: string }[],
  view: ReconciliationView,
  query: string,
) {
  const visibleRows = report.rows.filter((row) => rowInReconciliationView(row, view, query));
  const filterHref = (next: ReconciliationView) => {
    const params = new URLSearchParams();
    if (next !== "open") {
      params.set("view", next);
    }
    if (query.trim()) {
      params.set("q", query.trim());
    }
    const suffix = params.toString();
    return `/admin/seasons/${seasonId}/reconciliation${suffix ? `?${suffix}` : ""}`;
  };
  return (
    <>
      <Notice label={report.trustworthy ? "Exact match" : "Unresolved review"} tone={report.trustworthy ? "success" : "warning"}>
        {report.summary}
      </Notice>
      <Section title="What to look at first">
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
          {report.highlights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>
      <KpiGrid
        items={[
          { label: "Exact", value: report.exactMatches.length, hint: "Rank, points, movement, wins" },
          { label: "Missing", value: report.missingParticipants.length, tone: report.missingParticipants.length ? "warning" : "default" },
          { label: "Points", value: report.pointMismatches.length, tone: report.pointMismatches.length ? "danger" : "default" },
          { label: "Ambiguous", value: report.parserAmbiguities.length, tone: report.parserAmbiguities.length ? "warning" : "default" },
          { label: "Unmatched", value: report.aliasIssues.length, hint: "Authors not in the registry" },
        ]}
      />

      <Section
        description="Actual scores have to be entered on each round before a rebuild can run. The manual checkpoint stays as it is."
        id="rounds"
        title="Imported rounds"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs tracking-wide text-zinc-500 uppercase">
                <th className="py-2 pr-3 font-medium">Round</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Actuals</th>
                <th className="py-2 pr-3 font-medium">Accepted</th>
                <th className="py-2 pr-3 font-medium">Flagged</th>
                <th className="py-2 font-medium">Unknown</th>
              </tr>
            </thead>
            <tbody>
              {report.rounds.map((round) => {
                const href = roundHref.get(round.number);
                return (
                  <tr className="border-b border-zinc-100 last:border-0" key={round.number}>
                    <td className="py-2.5 pr-3 font-medium">
                      {href ? (
                        <Link className="hover:underline" href={href}>
                          {round.number}. {round.name ?? "Round"}
                        </Link>
                      ) : (
                        `${round.number}. ${round.name ?? "Round"}`
                      )}
                    </td>
                    <td className="max-w-xs py-2.5 pr-3 text-xs break-all text-zinc-500">{round.forumUrl ?? "—"}</td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {round.scoredFixtureCount}/{round.fixtureCount}
                      {round.scoredFixtureCount < round.fixtureCount ? (
                        <span className="ml-2">
                          <Badge tone="warning">Missing</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{round.acceptedParticipantIds.length}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{round.flagged.length}</td>
                    <td className="py-2.5 tabular-nums">{round.unknownAuthors.reduce((total, author) => total + author.commentCount, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        description="Paired by registry id. A decision here is a review note. It does not replace the manual checkpoint."
        id="differences"
        title="Checkpoint comparison"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterLink current={view === "open"} href={filterHref("open")}>
            Open ({report.rows.filter((row) => row.status !== "exact").length})
          </FilterLink>
          <FilterLink current={view === "baseline"} href={filterHref("baseline")}>
            Baseline mismatch
          </FilterLink>
          <FilterLink current={view === "scoring"} href={filterHref("scoring")}>
            Scoring mismatch
          </FilterLink>
          <FilterLink current={view === "exact"} href={filterHref("exact")}>
            Exact ({report.exactMatches.length})
          </FilterLink>
          <FilterLink current={view === "all"} href={filterHref("all")}>
            All
          </FilterLink>
          <form className="flex items-center gap-2" method="get">
            {view !== "open" ? <input name="view" type="hidden" value={view} /> : null}
            <input aria-label="Search checkpoint rows" className={`${fieldClass} w-44`} defaultValue={query} name="q" placeholder="Name" />
            <button className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm" type="submit">
              Search
            </button>
          </form>
        </div>
        <ComparisonTable afterRoundNumber={report.afterRoundNumber} rows={visibleRows} seasonId={seasonId} />
      </Section>

      <Section description="These rows agree on rank, points, movement, and round wins." id="exact" title="Exact matches">
        {report.exactMatches.length === 0 ? (
          <EmptyState detail="They appear after a full calculation agrees with the checkpoint." title="No exact matches yet" />
        ) : (
          <p className="text-sm text-zinc-700">{report.exactMatches.map((row) => row.displayName).join(", ")}</p>
        )}
      </Section>

      <Section
        description="Duplicate or ambiguous lines. The parser left them in review instead of picking a silent winner."
        id="ambiguity"
        title="Parser ambiguity"
      >
        {report.parserAmbiguities.length === 0 ? (
          <EmptyState title="No ambiguous slips" />
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {report.parserAmbiguities.map((item, index) => {
              const href = roundHref.get(item.roundNumber);
              return (
                <li className="py-2" key={`${item.roundNumber}-${item.participantId}-${index}`}>
                  <span className="font-medium">Round {item.roundNumber}</span> · {item.participantName}
                  {item.selected ? <Badge tone="danger">Selected</Badge> : <Badge tone="neutral">Not selected</Badge>}
                  <p className="mt-1 text-xs text-zinc-500">{item.warnings.find((warning) => /duplicate|ambiguous/i.test(warning))}</p>
                  {href ? (
                    <Link className="text-xs text-zinc-600 hover:underline" href={href} prefetch={false}>
                      Open review
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        description="Incomplete slips, swapped clubs, and lines that did not match a fixture."
        id="extraction"
        title="Parser extraction"
      >
        {report.parserExtractions.length === 0 ? (
          <EmptyState title="No extraction problems in flagged slips" />
        ) : (
          <ul className="space-y-2 text-sm">
            {report.rounds.map((round) => {
              const items = report.parserExtractions.filter((item) => item.roundNumber === round.number);
              if (items.length === 0) {
                return null;
              }
              const href = roundHref.get(round.number);
              const names = [...new Set(items.map((item) => item.participantName))];
              return (
                <li key={round.number}>
                  <span className="font-medium">Round {round.number}</span> · {items.length} flagged
                  {href ? (
                    <Link className="ml-2 text-zinc-600 hover:underline" href={href} prefetch={false}>
                      Review
                    </Link>
                  ) : null}
                  <p className="text-zinc-600">{names.join(", ")}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        description="Known aliases are already linked. An uncertain shorter name stays here until you link it. Ignored forum users are left out."
        id="aliases"
        title="Duplicate and alias issues"
      >
        {report.aliasIssues.length === 0 ? (
          <EmptyState title="No unmatched authors" />
        ) : (
          <div className="space-y-4">
            {report.aliasIssues.map((issue) => (
              <form action={markAliasAction} className="rounded-lg border border-zinc-200 p-3" key={issue.name}>
                <input name="seasonId" type="hidden" value={seasonId} />
                <input name="afterRoundNumber" type="hidden" value={report.afterRoundNumber} />
                <input name="alias" type="hidden" value={issue.name} />
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {issue.name} <span className="font-normal text-zinc-500">· {issue.commentCount} comments</span>
                    </p>
                    <p className="mt-1 max-w-xl text-xs text-zinc-500">{issue.detail}</p>
                    <Badge tone={operatorTone(unknownAuthorLabel(issue.suspects.length))}>
                      {OPERATOR_LABEL[unknownAuthorLabel(issue.suspects.length)]}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Roster name">
                      <select className={`${fieldClass} w-56`} defaultValue={issue.suspects.length === 1 ? issue.suspects[0]?.participantId : ""} name="participantId">
                        <option value="">Choose</option>
                        {participants.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <SubmitButton pendingLabel="Saving…">Mark participant alias</SubmitButton>
                  </div>
                </div>
              </form>
            ))}
          </div>
        )}
        {report.linkedAliases.length > 0 ? (
          <p className="mt-4 text-sm text-zinc-600">
            Already linked: {report.linkedAliases.map((alias) => `${alias.alias} → ${alias.participantName}`).join("; ")}.
          </p>
        ) : null}
      </Section>

      <Section description="Raised from the fetched opening posts. Different URLs are not a conflict." id="source" title="Source content">
        {report.sourceIssues.length === 0 ? (
          <EmptyState detail="Rounds 6 and 7 stay clear unless their fetched opening posts are the same text." title="No duplicated or inconsistent opening posts" />
        ) : (
          <ul className="space-y-2 text-sm">
            {report.sourceIssues.map((issue) => (
              <li key={`${issue.roundNumbers.join("-")}-${issue.detail}`}>
                <Badge tone="warning">{CAUSE_LABEL[issue.cause]}</Badge>{" "}
                <span className="text-zinc-700">
                  Rounds {issue.roundNumbers.join(", ")}: {issue.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export default async function ReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ seasonId: string }>;
  searchParams: Promise<{ error?: string; saved?: string; rebuilt?: string; view?: string; q?: string }>;
}) {
  await connection();
  const { seasonId } = await params;
  const query = await searchParams;
  const view = reconciliationViewOf(query.view);
  const data = await loadReconciliation(seasonId);
  if (!data) {
    notFound();
  }
  const roundHref = new Map(data.roundLinks.map((round) => [round.number, `/admin/rounds/${round.id}/review`]));

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/seasons/${data.seasonId}`}>{data.seasonName}</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/seasons/${data.seasonId}/checkpoint`}>Checkpoint</CrumbLink>
          </>
        }
        description="Reference check of the archived rounds against the trusted baseline. Choices stay beside the checkpoint. They do not change production standings."
        nav={
          data.report ? (
            <form action={rebuildComputedAction}>
              <input name="seasonId" type="hidden" value={data.seasonId} />
              <input name="afterRoundNumber" type="hidden" value={data.report.afterRoundNumber} />
              <SubmitButton pendingLabel="Rebuilding…" variant="primary">
                Check archived rounds
              </SubmitButton>
            </form>
          ) : null
        }
        title="Round reconciliation"
      />
      <PageBody>
        <SeasonLayers current="review" seasonId={data.seasonId} />
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.saved ? <Notice tone="success">Saved a review decision for {query.saved}. The trusted baseline was left unchanged. Production standings were not changed.</Notice> : null}
        {query.rebuilt ? <Notice tone="success">Stored a reference calculation for {query.rebuilt} archived round scores. The trusted baseline was left unchanged. Production standings were not changed.</Notice> : null}
        {!data.report || data.afterRoundNumber == null ? (
          <Section title="No checkpoint">
            <EmptyState detail="Save the manual round 11 table before reconciling." title="Nothing to compare" />
          </Section>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
              <span>
                {data.checkpointLabel}. After round {data.afterRoundNumber}.
              </span>
              <Link className={buttonClass("ghost")} href={`/admin/seasons/${data.seasonId}/checkpoint`}>
                Open the trusted baseline
              </Link>
            </div>
            {reportBody(data.report, data.seasonId, roundHref, data.participants, view, query.q ?? "")}
          </>
        )}
      </PageBody>
    </>
  );
}
