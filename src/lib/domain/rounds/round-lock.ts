import { ARCHIVED_ROUND, OPERATIONAL_ROUND } from "@/lib/domain/standings/round-role";

/**
 * Four persisted ideas stay separate:
 * Layer is the calculation label from `status` and stored scores. Draft is not "not started".
 * standingRole is operational or archived reference.
 * closedAt and closureLog are the edit lock. Closed still counts in season totals.
 * productionStartedAt is activation. Null is preparation. An unscored round with this timestamp is Production.
 */

export const CLOSED_ROUND_MESSAGE =
  "Тур закрыт. Для изменения данных сначала нажмите Re-open production.";

export class RoundClosedError extends Error {
  constructor() {
    super(CLOSED_ROUND_MESSAGE);
    this.name = "RoundClosedError";
  }
}

export const PREPARING_LABEL = "Preparing / Not started";

export type ClosureAction = "closed" | "reopened" | "started" | "results-processing";

export const LOCAL_OPERATOR = "local-admin";

export interface ClosureEvent {
  action: ClosureAction;
  at: string;
  actor?: string;
  from?: boolean;
  to?: boolean;
}

export function isRoundClosed(closedAt: Date | null | undefined): boolean {
  return closedAt != null;
}

export function productionLockLabel(
  standingRole: string,
  closedAt: Date | null | undefined,
  productionStartedAt?: Date | null,
): "Production" | "Closed" | "Archived reference" | typeof PREPARING_LABEL {
  if (standingRole === ARCHIVED_ROUND) {
    return "Archived reference";
  }
  if (isRoundClosed(closedAt)) {
    return "Closed";
  }
  if (productionStartedAt === null) {
    return PREPARING_LABEL;
  }
  return "Production";
}

export function parseClosureLog(value: string): ClosureEvent[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const action = "action" in entry ? entry.action : null;
      const at = "at" in entry ? entry.at : null;
      if (action === "results-processing" && typeof at === "string") {
        const actor = "actor" in entry && typeof entry.actor === "string" ? entry.actor : LOCAL_OPERATOR;
        const from = "from" in entry && entry.from === true;
        const to = "to" in entry && entry.to === true;
        return [{ action, at, actor, from, to }];
      }
      if ((action === "closed" || action === "reopened" || action === "started") && typeof at === "string") {
        return [{ action, at }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function appendClosureLog(
  value: string,
  action: ClosureAction,
  at: Date,
  details?: { actor?: string; from?: boolean; to?: boolean },
): string {
  const event: ClosureEvent = { action, at: at.toISOString() };
  if (details?.actor) {
    event.actor = details.actor;
  }
  if (details && "from" in details) {
    event.from = details.from;
  }
  if (details && "to" in details) {
    event.to = details.to;
  }
  return JSON.stringify([...parseClosureLog(value), event]);
}

export interface ClosureState {
  standingRole: string;
  closedAt: Date | null;
  closureLog: string;
  /** Null refuses close. Omitted means the round is already activated. */
  productionStartedAt?: Date | null;
}

export interface ClosureUpdate {
  changed: boolean;
  closedAt: Date | null;
  closureLog: string;
}

/** Close is explicit and idempotent. A second close keeps the original timestamp and log. */
export function planClose(state: ClosureState, at: Date): ClosureUpdate {
  if (state.standingRole !== OPERATIONAL_ROUND) {
    throw new Error("Only a production round can be closed.");
  }
  if (state.productionStartedAt === null) {
    throw new Error("Start production before closing this round.");
  }
  if (state.closedAt) {
    return { changed: false, closedAt: state.closedAt, closureLog: state.closureLog };
  }
  return { changed: true, closedAt: at, closureLog: appendClosureLog(state.closureLog, "closed", at) };
}

export interface StartState {
  standingRole: string;
  closedAt: Date | null;
  closureLog: string;
  productionStartedAt: Date | null;
  forumUrl: string | null;
  fixtureCount: number;
  matchOfTheRoundCount: number;
}

export interface StartUpdate {
  changed: boolean;
  productionStartedAt: Date;
  closureLog: string;
  /** True only when this call is the start. An already-started round keeps the stored switch. */
  resultsProcessing?: boolean;
}

/**
 * Start makes the existing scheduler eligible. It does not fetch, parse, calculate, or reset retries.
 * A second start keeps the original timestamp.
 */
export function planStart(state: StartState, at: Date): StartUpdate {
  if (state.standingRole !== OPERATIONAL_ROUND) {
    throw new Error("Only a production round can start production.");
  }
  if (state.closedAt) {
    throw new RoundClosedError();
  }
  if (state.productionStartedAt) {
    return { changed: false, productionStartedAt: state.productionStartedAt, closureLog: state.closureLog };
  }
  if (!state.forumUrl?.trim()) {
    throw new Error("Save the forum URL before starting production.");
  }
  if (state.fixtureCount < 1) {
    throw new Error("Save a fixture schedule before starting production.");
  }
  if (state.matchOfTheRoundCount > 1) {
    throw new Error("Only one Match of the Round can be marked before starting production.");
  }
  const started = appendClosureLog(state.closureLog, "started", at);
  return {
    changed: true,
    productionStartedAt: at,
    resultsProcessing: true,
    closureLog: appendClosureLog(started, "results-processing", at, {
      actor: LOCAL_OPERATOR,
      from: false,
      to: true,
    }),
  };
}

/** Reopen restores editing. It does not fetch, recalculate, or reset retry counters. */
export function planReopen(state: ClosureState, at: Date): ClosureUpdate {
  if (!state.closedAt) {
    return { changed: false, closedAt: null, closureLog: state.closureLog };
  }
  return { changed: true, closedAt: null, closureLog: appendClosureLog(state.closureLog, "reopened", at) };
}

export function closureWarning(input: { unverifiedFixtures: number; unresolvedReviews: number }): string | null {
  const parts: string[] = [];
  if (input.unverifiedFixtures > 0) {
    parts.push(
      `${input.unverifiedFixtures} ${input.unverifiedFixtures === 1 ? "fixture is" : "fixtures are"} not verified`,
    );
  }
  if (input.unresolvedReviews > 0) {
    parts.push(
      `${input.unresolvedReviews} prediction ${input.unresolvedReviews === 1 ? "set still needs" : "sets still need"} review`,
    );
  }
  if (parts.length === 0) {
    return null;
  }
  return `${parts.join("; ")}. Closing does not complete or change that data.`;
}

export function assertOpen(closedAt: Date | null | undefined): void {
  if (isRoundClosed(closedAt)) {
    throw new RoundClosedError();
  }
}

/** A targeted write fails when that round is closed. Other rounds in a batch stay writable. */
export function writableRoundIds(roundIds: readonly string[], closedIds: ReadonlySet<string>): string[] {
  return roundIds.filter((id) => !closedIds.has(id));
}

export function assertTargetOpen(roundId: string, closedIds: ReadonlySet<string>): void {
  if (closedIds.has(roundId)) {
    throw new RoundClosedError();
  }
}
