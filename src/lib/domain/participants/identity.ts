import { participantKey } from "@/lib/domain/import/participant-key";

export interface KnownIdentity {
  participantId: string;
  normalized: string;
}

export function normalizeParticipantName(value: string): string {
  return participantKey(value);
}

/** First registered key wins, so a nickname variation does not create a second person. */
export function identityOwner(key: string, identities: KnownIdentity[]): string | null {
  if (!key) {
    return null;
  }
  return identities.find((identity) => identity.normalized === key)?.participantId ?? null;
}
