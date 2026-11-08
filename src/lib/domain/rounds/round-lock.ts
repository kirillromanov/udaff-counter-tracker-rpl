import { ARCHIVED_ROUND, OPERATIONAL_ROUND } from "@/lib/domain/standings/round-role";

export const CLOSED_ROUND_MESSAGE =
  "Тур закрыт. Для изменения данных сначала нажмите Re-open production.";

export class RoundClosedError extends Error {
  constructor() {
    super(CLOSED_ROUND_MESSAGE);
    this.name = "RoundClosedError";
  }
}

export type ClosureAction = "closed" | "reopened";

export interface ClosureEvent {
  action: ClosureAction;
  at: string;
}

export function isRoundClosed(closedAt: Date | null | undefined): boolean {
  return closedAt != null;
}

export function productionLockLabel(
  standingRole: string,
  closedAt: Date | null | undefined,
): "Production" | "Closed" | "Archived reference" {
  if (standingRole === ARCHIVED_ROUND) {
    return "Archived reference";
  }
  return isRoundClosed(closedAt) ? "Closed" : "Production";
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
      if ((action === "closed" || action === "reopened") && typeof at === "string") {
        return [{ action, at }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function appendClosureLog(value: string, action: ClosureAction, at: Date): string {
  return JSON.stringify([...parseClosureLog(value), { action, at: at.toISOString() }]);
}

export interface ClosureState {
  standingRole: string;
  closedAt: Date | null;
  closureLog: string;
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
  if (state.closedAt) {
    return { changed: false, closedAt: state.closedAt, closureLog: state.closureLog };
  }
  return { changed: true, closedAt: at, closureLog: appendClosureLog(state.closureLog, "closed", at) };
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
