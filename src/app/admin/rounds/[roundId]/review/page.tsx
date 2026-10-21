import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  readLines,
  readWarnings,
  setTone,
  summarizeSets,
  toSetToneInput,
  predictionTone,
} from "@/lib/domain/import/review-status";
import {
  OPERATOR_LABEL,
  aliasSuggestions,
  operatorTone,
  reviewQueueOf,
  setInQueue,
  setLabels,
  setNeedsReview,
  unknownAuthorLabel,
  type ReviewSetFacts,
} from "@/lib/domain/review/operator-status";
import { prisma } from "@/lib/db/prisma";
import { SeasonLayers } from "../../../layers";
import { RoundNav } from "../../../round-nav";
import { SubmitButton } from "../../../submit-button";
import {
  Badge,
  CrumbLink,
  EmptyState,
  FilterLink,
  KpiGrid,
  Notice,
  PageBody,
  PageHeader,
  Section,
  cx,
  fieldClass,
} from "../../../ui";
import {
  addManualSetAction,
  fetchCommentsAction,
  mergeParticipantsAction,
  parseCommentsAction,
  renameParticipantAction,
  selectSetAction,
  updatePredictionAction,
} from "../actions";

export const instant = false;

function formatWhen(value: Date | null): string {
  if (!value) {
    return "no timestamp";
  }
  return value.toISOString().slice(0, 16).replace("T", " ");
}

const rowTone = {
  ok: "border-zinc-200 bg-white",
  conflict: "border-rose-300 bg-rose-50",
  correction: "border-amber-200 bg-amber-50",
};

export default async function RoundImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ error?: string; imported?: string; parsed?: string; view?: string; q?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const queue = reviewQueueOf(query.view);
  const search = query.q ?? "";
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      season: true,
      matches: { orderBy: { sortOrder: "asc" } },
      forumComments: { orderBy: [{ postedAt: "asc" }, { externalId: "asc" }] },
      predictionSets: {
        include: {
          participant: true,
          forumComment: true,
          predictions: { include: { match: true }, orderBy: { match: { sortOrder: "asc" } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!round) {
    notFound();
  }

  const participants = [...new Map(round.predictionSets.map((set) => [set.participant.id, set.participant])).values()].sort(
    (left, right) => left.name.localeCompare(right.name, "ru"),
  );
  const parsedCommentIds = new Set(
    round.predictionSets.map((set) => set.forumCommentId).filter((id): id is string => Boolean(id)),
  );
  const summary = summarizeSets(round.predictionSets.map(toSetToneInput));
  const waiting = round.forumComments.filter((comment) => !parsedCommentIds.has(comment.id) && comment.reviewState !== "flagged");
  const unmatchedAuthors = round.forumComments.filter(
    (comment) => comment.reviewState === "flagged" && !parsedCommentIds.has(comment.id),
  );
  const registryNames = (
    await prisma.participant.findMany({ where: { archivedAt: null }, select: { name: true } })
  ).map((person) => person.name);
  const unmatchedGroups = [...unmatchedAuthors.reduce((groups, comment) => {
    const current = groups.get(comment.authorName);
    if (current) {
      current.count += 1;
    } else {
      const suggestions = aliasSuggestions(comment.authorName, registryNames);
      groups.set(comment.authorName, { count: 1, sample: comment.rawText || "(empty)", suggestions });
    }
    return groups;
  }, new Map<string, { count: number; sample: string; suggestions: string[] }>())].sort(
    (left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0], "ru"),
  );
  const factsById = new Map<string, ReviewSetFacts & { tone: ReviewSetFacts["tone"] }>();
  for (const set of round.predictionSets) {
    const reviewed = setTone(toSetToneInput(set));
    const tone = set.status === "flagged" && reviewed === "ok" ? "correction" : reviewed;
    factsById.set(set.id, {
      participantName: set.participant.name,
      authorName: set.forumComment?.authorName ?? set.participant.name,
      status: set.status,
      selected: set.selected,
      manuallyEdited: set.manuallyEdited,
      selection: set.selection,
      warnings: readWarnings(set.warningsJson),
      tone,
    });
  }
  const visibleSets = round.predictionSets.filter((set) => setInQueue(factsById.get(set.id)!, queue, search));
  const visibleByParticipant = new Map<string, typeof visibleSets>();
  for (const set of visibleSets) {
    const group = visibleByParticipant.get(set.participantId) ?? [];
    group.push(set);
    visibleByParticipant.set(set.participantId, group);
  }
  const visibleParticipants = participants
    .filter((participant) => visibleByParticipant.has(participant.id))
    .sort((left, right) => {
      const rank = (id: string) => {
        const sets = visibleByParticipant.get(id) ?? [];
        if (sets.some((set) => factsById.get(set.id)?.tone === "conflict")) {
          return 0;
        }
        if (sets.some((set) => setNeedsReview(factsById.get(set.id)!))) {
          return 1;
        }
        return 2;
      };
      const delta = rank(left.id) - rank(right.id);
      return delta === 0 ? left.name.localeCompare(right.name, "ru") : delta;
    });
  const reviewCount = [...factsById.values()].filter((set) => setNeedsReview(set)).length;
  const acceptedCount = [...factsById.values()].filter((set) => set.selected && set.status === "accepted").length;
  const queueHref = (next: typeof queue) => {
    const params = new URLSearchParams();
    if (next !== "review") {
      params.set("view", next);
    }
    if (search.trim()) {
      params.set("q", search.trim());
    }
    const suffix = params.toString();
    return `/admin/rounds/${round.id}/review${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/seasons/${round.seasonId}`}>{round.season.name}</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/rounds/${round.id}`}>{round.name ?? `Round ${round.number}`}</CrumbLink>
          </>
        }
        description="Imported parser results for this round. Accepted slips can be scored later. Flagged and unmatched rows stay unresolved."
        nav={<RoundNav roundId={round.id} seasonId={round.seasonId} />}
        title="Parser review"
      />
      <PageBody>
        <SeasonLayers current="import" reviewHref={`/admin/rounds/${round.id}/review`} seasonId={round.seasonId} />
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.imported ? <Notice tone="success">Saved {query.imported} comments.</Notice> : null}
        {query.parsed ? <Notice tone="success">Parsed {query.parsed} comments.</Notice> : null}
        {round.fetchedAt ? (
          <Notice label="Imported parser results" tone="info">
            Fetched {formatWhen(round.fetchedAt)}
            {round.forumUrl ? ` from ${round.forumUrl}` : ""}. The default list is unresolved review. Accepted slips stay out of
            that list until you open them. This page does not write the baseline or computed standings.
          </Notice>
        ) : null}
        {round.importNotes ? <Notice tone="warning">{round.importNotes}</Notice> : null}
        {summary.conflicts > 0 ? (
          <Notice tone="warning">
            {summary.conflicts} {summary.conflicts === 1 ? "set has" : "sets have"} a parse conflict. Duplicate lines and
            ambiguous fixtures are marked in rose.
          </Notice>
        ) : null}
        {summary.corrections > 0 ? (
          <Notice tone="warning">
            {summary.corrections} {summary.corrections === 1 ? "set needs" : "sets need"} a manual correction. Missing
            scores, swapped clubs, and unmatched lines are marked in amber.
          </Notice>
        ) : null}

        <KpiGrid
          items={[
            { label: "Comments", value: round.forumComments.length },
            { label: "Sets", value: round.predictionSets.length },
            { label: "Selected", value: summary.selected },
            { label: "Conflicts", value: summary.conflicts, tone: summary.conflicts > 0 ? "danger" : "default" },
            { label: "Need correction", value: summary.corrections, tone: summary.corrections > 0 ? "warning" : "default" },
          ]}
        />

        <Section
          description="The download stores raw text. Parsing keeps a set you have already edited."
          id="import"
          title="Import"
        >
          {round.matches.length === 0 ? (
            <EmptyState
              detail="The parser can only attach lines to fixtures that exist on this round."
              title="Add fixtures first"
            />
          ) : (
            <ul className="mb-4 flex flex-wrap gap-2">
              {round.matches.map((match) => (
                <li className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700" key={match.id}>
                  {match.homeTeam} — {match.awayTeam}
                  {match.isMatchOfTheRound ? " · official MT" : ""}
                </li>
              ))}
            </ul>
          )}
          <form action={fetchCommentsAction} className="flex flex-wrap items-end gap-2">
            <input name="roundId" type="hidden" value={round.id} />
            <label className="min-w-72 flex-1 text-xs font-medium text-zinc-500">
              Forum URL
              <input
                className={`${fieldClass} mt-1 w-full`}
                defaultValue={round.forumUrl ?? ""}
                name="url"
                placeholder="https://canadaru.net/udaff_afterlife/..."
                type="url"
              />
            </label>
            <SubmitButton pendingLabel="Fetching…" variant="primary">
              Fetch comments
            </SubmitButton>
          </form>
          <form action={parseCommentsAction} className="mt-3 flex flex-wrap items-center gap-3">
            <input name="roundId" type="hidden" value={round.id} />
            <SubmitButton pendingLabel="Parsing…">Parse predictions</SubmitButton>
            <span className="text-sm text-zinc-500">{round.forumComments.length} comments stored</span>
          </form>
          {queue !== "accepted" && unmatchedGroups.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Authors not in the registry</h3>
              <ul className="mt-2 space-y-2">
                {unmatchedGroups.map(([name, group]) => {
                  const label = unknownAuthorLabel(group.suggestions.length);
                  return (
                    <li className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" key={name}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{name}</span>
                        <span className="text-zinc-500">{group.count} comments</span>
                        <Badge tone={operatorTone(label)}>{OPERATOR_LABEL[label]}</Badge>
                      </div>
                      {group.suggestions.length > 0 ? (
                        <p className="mt-1 text-xs text-zinc-600">
                          Looks like {group.suggestions.join(", ")}. Mark the alias on the reconciliation report. It is not linked
                          from here.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-zinc-600">No roster name starts with this nick. No participant was created.</p>
                      )}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-zinc-500">Sample comment</summary>
                        <pre className="mt-2 max-h-36 overflow-auto font-sans text-sm whitespace-pre-wrap text-zinc-800">
                          {group.sample}
                        </pre>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {waiting.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Fetched, not parsed yet</h3>
              <ul className="mt-2 space-y-2">
                {waiting.map((comment) => (
                  <li className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm" key={comment.id}>
                    <span className="font-medium">{comment.authorName}</span>
                    <span className="ml-2 text-zinc-500">{formatWhen(comment.postedAt)}</span>
                    <pre className="mt-2 max-h-36 overflow-auto font-sans text-sm whitespace-pre-wrap text-zinc-700">
                      {comment.rawText}
                    </pre>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        <Section
          description="Needs review is the default. Rose rows are parse conflicts. Amber rows still need a score, a fixture, or a swapped-club check."
          id="review"
          title="Parser review"
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <FilterLink current={queue === "review"} href={queueHref("review")}>
              Needs review ({reviewCount})
            </FilterLink>
            <FilterLink current={queue === "accepted"} href={queueHref("accepted")}>
              Accepted ({acceptedCount})
            </FilterLink>
            <FilterLink current={queue === "all"} href={queueHref("all")}>
              All ({round.predictionSets.length})
            </FilterLink>
            <form className="flex items-center gap-2" method="get">
              {queue !== "review" ? <input name="view" type="hidden" value={queue} /> : null}
              <input
                aria-label="Search slips"
                className={`${fieldClass} w-44`}
                defaultValue={search}
                name="q"
                placeholder="Name"
              />
              <button className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm" type="submit">
                Search
              </button>
            </form>
          </div>
          {participants.length === 0 ? (
            <EmptyState detail="Parse the stored comments, or add a prediction set by hand below." title="No prediction sets yet" />
          ) : visibleParticipants.length === 0 ? (
            <EmptyState
              detail={queue === "review" ? "Open Accepted to see slips that can be scored later." : "Try another name or queue."}
              title="Nothing in this queue"
            />
          ) : (
            <div className="space-y-8">
              {visibleParticipants.map((participant) => (
                <div key={participant.id}>
                  <h3 className="text-sm font-semibold text-zinc-950">{participant.name}</h3>
                  <div className="mt-3 space-y-4">
                    {(visibleByParticipant.get(participant.id) ?? []).map((set) => {
                      const facts = factsById.get(set.id)!;
                      const warnings = facts.warnings;
                      const unmatched = readLines(set.parsedJson).filter((line) => !line.fixtureId);
                      const tone = facts.tone;
                      const labels = setLabels(facts);
                      return (
                        <article className={cx("rounded-lg border p-4", rowTone[tone])} key={set.id}>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-medium">{set.forumComment?.authorName ?? participant.name}</h4>
                            <span className="text-xs text-zinc-500">{formatWhen(set.forumComment?.postedAt ?? null)}</span>
                            {labels.map((label) => (
                              <Badge key={label} tone={operatorTone(label)}>
                                {OPERATOR_LABEL[label]}
                              </Badge>
                            ))}
                            {tone === "conflict" ? <Badge tone="danger">Parse conflict</Badge> : null}
                            {tone === "correction" && !labels.includes("malformed_prediction") ? (
                              <Badge tone="warning">Needs correction</Badge>
                            ) : null}
                            <form action={selectSetAction}>
                              <input name="roundId" type="hidden" value={round.id} />
                              <input name="setId" type="hidden" value={set.id} />
                              <SubmitButton pendingLabel="Selecting…" variant={set.selected ? "secondary" : "primary"}>
                                Use this set
                              </SubmitButton>
                            </form>
                          </div>
                          <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-white/80 p-3 font-sans text-sm whitespace-pre-wrap text-zinc-800">
                            {set.rawComment || "(empty)"}
                          </pre>
                          {warnings.length > 0 ? (
                            <ul className="mt-3 space-y-1 text-sm">
                              {warnings.map((warning, index) => (
                                <li
                                  className={cx(
                                    "rounded-md px-2 py-1",
                                    warning.toLowerCase().includes("duplicate") || warning.toLowerCase().includes("ambiguous")
                                      ? "bg-rose-100 text-rose-950"
                                      : "bg-amber-100/80 text-amber-950",
                                  )}
                                  key={`${warning}-${index}`}
                                >
                                  {warning}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <div className="mt-3 space-y-2">
                            {set.predictions.map((prediction) => {
                              const lineTone = predictionTone(prediction);
                              return (
                                <div className={cx("rounded-lg border px-3 py-2", rowTone[lineTone])} key={prediction.id}>
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    {lineTone === "conflict" ? <Badge tone="danger">Parse conflict</Badge> : null}
                                    {lineTone === "correction" ? <Badge tone="warning">Needs correction</Badge> : null}
                                    {prediction.markedAsMt ? <Badge tone="info">User MT</Badge> : null}
                                    {prediction.ignored ? <Badge>Ignored</Badge> : null}
                                  </div>
                                  <form action={updatePredictionAction} className="flex flex-wrap items-center gap-2">
                                    <input name="roundId" type="hidden" value={round.id} />
                                    <input name="predictionId" type="hidden" value={prediction.id} />
                                    <select className={`${fieldClass} max-w-full`} defaultValue={prediction.matchId} name="matchId">
                                      {round.matches.map((match) => (
                                        <option key={match.id} value={match.id}>
                                          {match.homeTeam} — {match.awayTeam}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      aria-label="Home goals"
                                      className={`${fieldClass} w-16`}
                                      defaultValue={prediction.homeGoals ?? ""}
                                      name="homeGoals"
                                    />
                                    <input
                                      aria-label="Away goals"
                                      className={`${fieldClass} w-16`}
                                      defaultValue={prediction.awayGoals ?? ""}
                                      name="awayGoals"
                                    />
                                    <label className="flex items-center gap-1 text-sm text-zinc-700">
                                      <input defaultChecked={prediction.ignored} name="ignored" type="checkbox" />
                                      ignored
                                    </label>
                                    <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                                  </form>
                                  {prediction.warning ? (
                                    <p className={cx("mt-2 text-xs", lineTone === "conflict" ? "text-rose-900" : "text-amber-950")}>
                                      {prediction.warning}
                                    </p>
                                  ) : null}
                                  {prediction.rawLine ? <p className="mt-1 text-xs text-zinc-500">{prediction.rawLine}</p> : null}
                                </div>
                              );
                            })}
                          </div>
                          {unmatched.length > 0 ? (
                            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                              <p className="font-medium text-amber-950">Unmatched lines — manual correction</p>
                              <ul className="mt-2 space-y-1">
                                {unmatched.map((line, index) => (
                                  <li key={`${line.rawLine}-${index}`}>
                                    {line.rawLine}
                                    <span className="text-amber-800"> ({line.warnings.join(", ") || "unmatched"})</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          description="Rename a nick, merge two people who are the same, or add a blank set when a comment failed to import."
          id="participants"
          title="Manual override"
        >
          <details>
            <summary className="cursor-pointer text-sm font-medium text-zinc-700">Rename, merge, or add a set</summary>
            <div className="mt-4">
          {participants.length === 0 ? (
            <EmptyState detail="Participants appear here after a comment is parsed." title="No participants on this round" />
          ) : (
            <div className="space-y-4">
              {participants.map((participant) => {
                const others = participants.filter((candidate) => candidate.id !== participant.id);
                return (
                  <div className="flex flex-wrap items-end gap-4 border-b border-zinc-100 pb-4 last:border-0 last:pb-0" key={participant.id}>
                    <form action={renameParticipantAction} className="flex items-end gap-2">
                      <input name="roundId" type="hidden" value={round.id} />
                      <input name="participantId" type="hidden" value={participant.id} />
                      <label className="text-xs font-medium text-zinc-500">
                        Name
                        <input className={`${fieldClass} mt-1 w-48`} defaultValue={participant.name} name="name" />
                      </label>
                      <SubmitButton pendingLabel="Saving…">Rename</SubmitButton>
                    </form>
                    {others.length > 0 ? (
                      <form action={mergeParticipantsAction} className="flex items-end gap-2">
                        <input name="roundId" type="hidden" value={round.id} />
                        <input name="sourceId" type="hidden" value={participant.id} />
                        <label className="text-xs font-medium text-zinc-500">
                          Merge into
                          <select className={`${fieldClass} mt-1 max-w-full`} name="targetId">
                            {others.map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <SubmitButton pendingLabel="Merging…">Merge</SubmitButton>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <form action={addManualSetAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4">
            <input name="roundId" type="hidden" value={round.id} />
            <label className="text-xs font-medium text-zinc-500">
              Add a prediction set
              <input className={`${fieldClass} mt-1 w-52`} name="participantName" placeholder="Participant name" />
            </label>
            <SubmitButton pendingLabel="Adding…" variant="primary">
              Add
            </SubmitButton>
          </form>
            </div>
          </details>
          <p className="mt-3 text-sm text-zinc-500">
            <Link className="hover:underline" href={`/admin/rounds/${round.id}`}>
              Back to the round overview
            </Link>
          </p>
        </Section>
      </PageBody>
    </>
  );
}
