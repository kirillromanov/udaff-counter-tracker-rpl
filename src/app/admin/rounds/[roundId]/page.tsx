import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { ParsedPredictionLine } from "@/lib/domain/parser/types";
import {
  addManualSetAction,
  fetchCommentsAction,
  mergeParticipantsAction,
  parseCommentsAction,
  renameParticipantAction,
  selectSetAction,
  updatePredictionAction,
} from "./actions";

export const instant = false;

function formatWhen(value: Date | null): string {
  if (!value) {
    return "no timestamp";
  }
  return value.toISOString().slice(0, 16).replace("T", " ");
}

function readLines(value: string): ParsedPredictionLine[] {
  try {
    const parsed = JSON.parse(value) as ParsedPredictionLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readWarnings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default async function RoundImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ error?: string; imported?: string; parsed?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
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

  const participants = [...new Map(round.predictionSets.map((set) => [set.participant.id, set.participant])).values()]
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  const setsByParticipant = new Map<string, typeof round.predictionSets>();
  for (const set of round.predictionSets) {
    const group = setsByParticipant.get(set.participantId) ?? [];
    group.push(set);
    setsByParticipant.set(set.participantId, group);
  }
  const parsedCommentIds = new Set(
    round.predictionSets.map((set) => set.forumCommentId).filter((id): id is string => Boolean(id)),
  );

  return (
    <main className="mx-auto max-w-5xl p-6">
      <p className="text-sm">
        <Link className="underline" href="/admin">
          Admin
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">
        {round.season.name}: {round.name ?? `Round ${round.number}`}
      </h1>
      <p className="mt-2 text-neutral-600">
        Fetch the forum thread, parse prediction lines, then correct names, scores, and which comment counts.
      </p>
      {query.error ? <p className="mt-4 border border-red-300 bg-red-50 p-3">{query.error}</p> : null}
      {query.imported ? <p className="mt-4 border border-green-300 bg-green-50 p-3">Saved {query.imported} comments.</p> : null}
      {query.parsed ? <p className="mt-4 border border-green-300 bg-green-50 p-3">Parsed {query.parsed} comments.</p> : null}

      <section className="mt-6 border p-4">
        <h2 className="font-semibold">Fixtures</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {round.matches.map((match) => (
            <li key={match.id}>
              {match.sortOrder}. {match.homeTeam} — {match.awayTeam}
              {match.isMatchOfTheRound ? " (official MT)" : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 border p-4">
        <h2 className="font-semibold">Import</h2>
        <form action={fetchCommentsAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input name="roundId" type="hidden" value={round.id} />
          <input
            className="min-w-80 flex-1 border px-2 py-1"
            defaultValue={round.forumUrl ?? ""}
            name="url"
            placeholder="https://canadaru.net/udaff_afterlife/..."
            type="url"
          />
          <button className="border px-3 py-1" type="submit">
            Fetch comments
          </button>
        </form>
        <form action={parseCommentsAction} className="mt-3">
          <input name="roundId" type="hidden" value={round.id} />
          <button className="border px-3 py-1" type="submit">
            Parse predictions
          </button>
          <span className="ml-3 text-sm text-neutral-600">{round.forumComments.length} comments stored</span>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Review</h2>
        {participants.length === 0 ? (
          <p className="mt-2 text-neutral-600">No parsed prediction sets yet.</p>
        ) : (
          participants.map((participant) => {
            const others = participants.filter((candidate) => candidate.id !== participant.id);
            return (
              <section className="mt-4 border p-4" key={participant.id}>
                <div className="flex flex-wrap items-end gap-4">
                  <form action={renameParticipantAction} className="flex items-center gap-2">
                    <input name="roundId" type="hidden" value={round.id} />
                    <input name="participantId" type="hidden" value={participant.id} />
                    <input className="border px-2 py-1" defaultValue={participant.name} name="name" />
                    <button className="border px-2 py-1" type="submit">
                      Rename
                    </button>
                  </form>
                  {others.length > 0 ? (
                    <form action={mergeParticipantsAction} className="flex items-center gap-2">
                      <input name="roundId" type="hidden" value={round.id} />
                      <input name="sourceId" type="hidden" value={participant.id} />
                      <select className="border px-2 py-1" name="targetId">
                        {others.map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                      </select>
                      <button className="border px-2 py-1" type="submit">
                        Merge into
                      </button>
                    </form>
                  ) : null}
                </div>

                {(setsByParticipant.get(participant.id) ?? []).map((set) => {
                  const warnings = readWarnings(set.warningsJson);
                  const unmatched = readLines(set.parsedJson).filter((line) => !line.fixtureId);
                  return (
                    <article className="mt-4 border-t pt-4" key={set.id}>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-semibold">{set.forumComment?.authorName ?? participant.name}</h3>
                        <span>{formatWhen(set.forumComment?.postedAt ?? null)}</span>
                        <span>confidence {set.confidence ?? 0}</span>
                        <span>{set.selected ? "selected" : "not selected"}</span>
                        <span>{set.selection}</span>
                        {set.manuallyEdited ? <span>edited</span> : null}
                        <form action={selectSetAction}>
                          <input name="roundId" type="hidden" value={round.id} />
                          <input name="setId" type="hidden" value={set.id} />
                          <button className="border px-2 py-1" type="submit">
                            Use this set
                          </button>
                        </form>
                      </div>
                      <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap bg-neutral-50 p-3 text-sm">
                        {set.rawComment || "(empty)"}
                      </pre>
                      {warnings.length > 0 ? (
                        <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">
                          {warnings.map((warning, index) => (
                            <li key={`${warning}-${index}`}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-3 space-y-2">
                        {set.predictions.map((prediction) => (
                          <form action={updatePredictionAction} className="flex flex-wrap items-center gap-2" key={prediction.id}>
                            <input name="roundId" type="hidden" value={round.id} />
                            <input name="predictionId" type="hidden" value={prediction.id} />
                            <select className="border px-2 py-1" defaultValue={prediction.matchId} name="matchId">
                              {round.matches.map((match) => (
                                <option key={match.id} value={match.id}>
                                  {match.homeTeam} — {match.awayTeam}
                                </option>
                              ))}
                            </select>
                            <input
                              className="w-16 border px-2 py-1"
                              defaultValue={prediction.homeGoals ?? ""}
                              name="homeGoals"
                            />
                            <input
                              className="w-16 border px-2 py-1"
                              defaultValue={prediction.awayGoals ?? ""}
                              name="awayGoals"
                            />
                            <label className="text-sm">
                              <input className="mr-1" defaultChecked={prediction.ignored} name="ignored" type="checkbox" />
                              ignored
                            </label>
                            {prediction.markedAsMt ? <span className="text-sm">user MT</span> : null}
                            <button className="border px-2 py-1" type="submit">
                              Save
                            </button>
                          </form>
                        ))}
                      </div>
                      {unmatched.length > 0 ? (
                        <div className="mt-3 text-sm">
                          <p className="font-medium">Unmatched lines</p>
                          <ul className="mt-1 list-disc pl-5">
                            {unmatched.map((line, index) => (
                              <li key={`${line.rawLine}-${index}`}>
                                {line.rawLine} ({line.warnings.join(", ") || "unmatched"})
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </section>
            );
          })
        )}
      </section>

      <section className="mt-6 border p-4">
        <h2 className="font-semibold">Add a prediction set manually</h2>
        <form action={addManualSetAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input name="roundId" type="hidden" value={round.id} />
          <input className="border px-2 py-1" name="participantName" placeholder="Participant name" />
          <button className="border px-3 py-1" type="submit">
            Add
          </button>
        </form>
      </section>

      {round.forumComments.some((comment) => !parsedCommentIds.has(comment.id)) ? (
        <section className="mt-6">
          <h2 className="font-semibold">Fetched, not parsed yet</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {round.forumComments
              .filter((comment) => !parsedCommentIds.has(comment.id))
              .map((comment) => (
                <li className="border p-2" key={comment.id}>
                  <span className="font-medium">{comment.authorName}</span> {formatWhen(comment.postedAt)}
                  <pre className="mt-1 whitespace-pre-wrap">{comment.rawText}</pre>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
