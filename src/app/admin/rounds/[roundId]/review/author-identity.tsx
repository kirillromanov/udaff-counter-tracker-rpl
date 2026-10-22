import type { AuthorKind, AuthorResolution } from "@/lib/domain/participants/resolve-author";
import { OPERATOR_LABEL, operatorTone, type OperatorStatus } from "@/lib/domain/review/operator-status";
import { SubmitButton } from "../../../submit-button";
import { Badge, fieldClass } from "../../../ui";
import {
  createAuthorParticipantAction,
  ignoreAuthorAction,
  importIgnoredAuthorAction,
  linkAuthorAction,
  stopIgnoringAuthorAction,
} from "../actions";

export interface AuthorIdentityGroup {
  name: string;
  count: number;
  sample: string;
  overridden: boolean;
  raw: AuthorResolution;
  resolution: AuthorResolution;
}

const KIND_LABEL: Record<AuthorKind, string> = {
  participant: "Known participant",
  alias: "Alias",
  ignored: OPERATOR_LABEL.ignored_author,
  uncertain: OPERATOR_LABEL.alias_suggestion,
  unknown: OPERATOR_LABEL.unmatched_participant,
};

const KIND_STATUS: Record<AuthorKind, OperatorStatus> = {
  participant: "accepted",
  alias: "alias_suggestion",
  ignored: "ignored_author",
  uncertain: "alias_suggestion",
  unknown: "unmatched_participant",
};

function rank(kind: AuthorKind): number {
  if (kind === "uncertain" || kind === "unknown") {
    return 0;
  }
  if (kind === "ignored") {
    return 1;
  }
  return 2;
}

export function AuthorIdentityReview({
  roundId,
  seasonId,
  groups,
  participants,
}: {
  roundId: string;
  seasonId: string;
  groups: AuthorIdentityGroup[];
  participants: { id: string; name: string }[];
}) {
  const visible = [...groups].sort(
    (left, right) => rank(left.resolution.kind) - rank(right.resolution.kind) || right.count - left.count || left.name.localeCompare(right.name, "ru"),
  );
  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="mt-5">
      <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Author identity</h3>
      <ul className="mt-2 space-y-2">
        {visible.map((group) => {
          const kind = group.resolution.kind;
          const status = KIND_STATUS[kind];
          const known = kind === "participant" || kind === "alias";
          const ignoredAuthor = group.raw.kind === "ignored";
          return (
            <li className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm" key={group.name}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{group.name}</span>
                <span className="text-zinc-500">
                  {group.count} {group.count === 1 ? "comment" : "comments"}
                </span>
                <Badge tone={operatorTone(status)}>{KIND_LABEL[kind]}</Badge>
                {group.overridden ? <Badge tone="info">Imported anyway</Badge> : null}
              </div>
              {kind === "alias" && group.resolution.canonicalName ? (
                <p className="mt-1 text-xs text-zinc-600">
                  Known alias of {group.resolution.canonicalName}. Parse predictions to attach these slips. No second participant is created.
                </p>
              ) : null}
              {kind === "participant" ? (
                <p className="mt-1 text-xs text-zinc-600">Known participant. Parse predictions to attach these slips.</p>
              ) : null}
              {kind === "uncertain" ? (
                <p className="mt-1 text-xs text-zinc-600">
                  Possible match: {group.resolution.suggestions.join(", ")}. This is not linked until you choose that person.
                </p>
              ) : null}
              {kind === "unknown" ? (
                <p className="mt-1 text-xs text-zinc-600">No roster name matches this nick. No participant was created.</p>
              ) : null}
              {kind === "ignored" ? (
                <p className="mt-1 text-xs text-zinc-600">
                  Ignored user. These comments stay stored and are left out of prediction import.
                </p>
              ) : null}
              {known ? null : (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  {ignoredAuthor ? (
                    <form action={stopIgnoringAuthorAction}>
                      <input name="roundId" type="hidden" value={roundId} />
                      <input name="seasonId" type="hidden" value={seasonId} />
                      <input name="authorName" type="hidden" value={group.name} />
                      <SubmitButton pendingLabel="Updating…">Stop ignoring</SubmitButton>
                    </form>
                  ) : null}
                  {ignoredAuthor && !group.overridden ? (
                    <form action={importIgnoredAuthorAction}>
                      <input name="roundId" type="hidden" value={roundId} />
                      <input name="seasonId" type="hidden" value={seasonId} />
                      <input name="authorName" type="hidden" value={group.name} />
                      <SubmitButton pendingLabel="Updating…">Import anyway</SubmitButton>
                    </form>
                  ) : null}
                  {ignoredAuthor ? null : (
                    <form action={ignoreAuthorAction}>
                      <input name="roundId" type="hidden" value={roundId} />
                      <input name="seasonId" type="hidden" value={seasonId} />
                      <input name="authorName" type="hidden" value={group.name} />
                      <SubmitButton pendingLabel="Updating…">Mark ignored user</SubmitButton>
                    </form>
                  )}
                  <form action={linkAuthorAction} className="flex flex-wrap items-end gap-2">
                    <input name="roundId" type="hidden" value={roundId} />
                    <input name="seasonId" type="hidden" value={seasonId} />
                    <input name="authorName" type="hidden" value={group.name} />
                    <label className="text-xs font-medium text-zinc-500">
                      Existing participant
                      <select className={`${fieldClass} mt-1 block w-52`} name="participantId" required>
                        <option value="">Choose</option>
                        {participants.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton pendingLabel="Linking…">Link</SubmitButton>
                  </form>
                  {ignoredAuthor ? null : (
                    <form action={createAuthorParticipantAction}>
                      <input name="roundId" type="hidden" value={roundId} />
                      <input name="seasonId" type="hidden" value={seasonId} />
                      <input name="authorName" type="hidden" value={group.name} />
                      <SubmitButton pendingLabel="Creating…">Create participant</SubmitButton>
                    </form>
                  )}
                </div>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-zinc-500">Sample comment</summary>
                <pre className="mt-2 max-h-36 overflow-auto font-sans text-sm whitespace-pre-wrap text-zinc-800">{group.sample}</pre>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
