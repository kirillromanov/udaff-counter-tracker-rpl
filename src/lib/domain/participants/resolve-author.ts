import { participantKey } from "@/lib/domain/import/participant-key";
import { aliasSuggestions } from "@/lib/domain/review/operator-status";

export interface CatalogParticipant {
  id: string;
  name: string;
  normalized: string;
}

export interface CatalogAlias {
  participantId: string;
  alias: string;
  normalized: string;
}

export interface CatalogIgnored {
  name: string;
  normalized: string;
}

export interface IdentityCatalog {
  participants: readonly CatalogParticipant[];
  aliases: readonly CatalogAlias[];
  ignored: readonly CatalogIgnored[];
}

export type AuthorKind = "participant" | "alias" | "ignored" | "uncertain" | "unknown";

export interface AuthorResolution {
  kind: AuthorKind;
  participantId: string | null;
  canonicalName: string | null;
  suggestions: string[];
}

export const AUTHOR_NOTE = {
  ignored: "Ignored non-participant",
  uncertain: "Uncertain identity match",
  unknown: "Author is not in the registry",
} as const;

export function authorNeedsReview(note: string | null | undefined): boolean {
  return note === AUTHOR_NOTE.uncertain || note === AUTHOR_NOTE.unknown;
}

/**
 * Map a forum nick onto one identity outcome.
 * A known name or alias wins over the ignore list, so linking an author is the override.
 * A shorter unconfirmed name stays uncertain and does not pick a participant.
 */
export function resolveAuthor(name: string, catalog: IdentityCatalog): AuthorResolution {
  const key = participantKey(name);
  if (!key) {
    return { kind: "unknown", participantId: null, canonicalName: null, suggestions: [] };
  }

  const person = catalog.participants.find((item) => item.normalized === key);
  if (person) {
    return { kind: "participant", participantId: person.id, canonicalName: person.name, suggestions: [] };
  }

  const alias = catalog.aliases.find((item) => item.normalized === key);
  if (alias) {
    const owner = catalog.participants.find((item) => item.id === alias.participantId);
    return {
      kind: "alias",
      participantId: alias.participantId,
      canonicalName: owner?.name ?? null,
      suggestions: [],
    };
  }

  if (catalog.ignored.some((item) => item.normalized === key)) {
    return { kind: "ignored", participantId: null, canonicalName: null, suggestions: [] };
  }

  const suggestions = aliasSuggestions(
    name,
    catalog.participants.map((item) => item.name),
  );
  if (suggestions.length > 0) {
    return { kind: "uncertain", participantId: null, canonicalName: null, suggestions };
  }

  return { kind: "unknown", participantId: null, canonicalName: null, suggestions: [] };
}

/** `importAnyway` skips the ignore list for that comment and leaves every other rule in place. */
export function effectiveAuthorResolution(
  name: string,
  catalog: IdentityCatalog,
  importAnyway: boolean,
): AuthorResolution {
  const resolution = resolveAuthor(name, catalog);
  if (resolution.kind === "ignored" && importAnyway) {
    return resolveAuthor(name, { ...catalog, ignored: [] });
  }
  return resolution;
}

/** Refuse a new participant row when the nick is already a person, an alias, or an ignored user. */
export function creationBlocker(name: string, catalog: IdentityCatalog): string | null {
  const resolution = resolveAuthor(name, catalog);
  if (resolution.kind === "participant" || resolution.kind === "alias") {
    const owner = resolution.canonicalName ?? "an existing participant";
    return `${name.trim()} already belongs to ${owner}. No new participant was created.`;
  }
  if (resolution.kind === "ignored") {
    return `${name.trim()} is an ignored non-participant. Stop ignoring them before creating a participant.`;
  }
  if (!participantKey(name)) {
    return "Participant name is required";
  }
  return null;
}
