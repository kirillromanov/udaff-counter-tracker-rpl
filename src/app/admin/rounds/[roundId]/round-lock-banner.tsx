import { prisma } from "@/lib/db/prisma";
import { closureWarning, isRoundClosed, productionLockLabel } from "@/lib/domain/rounds/round-lock";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";
import { formatMoscow } from "@/lib/domain/time/moscow";
import { Badge, Notice } from "../../ui";
import { RoundLockControls } from "./round-lock-controls";

export function RoundLockBanner({
  roundId,
  standingRole,
  closedAt,
  closureLog,
  unverifiedFixtures,
  unresolvedReviews,
}: {
  roundId: string;
  standingRole: string;
  closedAt: Date | null;
  closureLog: string;
  unverifiedFixtures: number;
  unresolvedReviews: number;
}) {
  if (standingRole === ARCHIVED_ROUND) {
    return null;
  }
  const closed = isRoundClosed(closedAt);
  const warning = closureWarning({ unverifiedFixtures, unresolvedReviews });
  let latest = "";
  try {
    const events = JSON.parse(closureLog) as { action?: string; at?: string }[];
    const last = Array.isArray(events) ? events.at(-1) : null;
    if (last?.at) {
      latest = `${last.action === "reopened" ? "Reopened" : "Closed"} ${formatMoscow(new Date(last.at))}.`;
    }
  } catch {
    latest = "";
  }

  return (
    <Notice label={productionLockLabel(standingRole, closedAt)} tone={closed ? "warning" : "info"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {closed ? (
            <p>
              This production round is closed. Saved fixtures, predictions, results, and standings stay visible and can be
              exported. Imports, editing, and recalculation are blocked until it is reopened. {latest}
            </p>
          ) : (
            <p>This is a production round. Close it when the saved data should stop changing. {latest}</p>
          )}
          {!closed && warning ? <p className="mt-2">{warning}</p> : null}
        </div>
        <RoundLockControls closed={closed} roundId={roundId} warning={warning} />
      </div>
    </Notice>
  );
}

export function RoundLockBadge({
  standingRole,
  closedAt,
}: {
  standingRole: string;
  closedAt: Date | null;
}) {
  if (standingRole === ARCHIVED_ROUND) {
    return <Badge tone="neutral">Archived reference</Badge>;
  }
  return <Badge tone={isRoundClosed(closedAt) ? "warning" : "info"}>{productionLockLabel(standingRole, closedAt)}</Badge>;
}

export async function RoundLockPanel({ roundId }: { roundId: string }) {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    select: {
      standingRole: true,
      closedAt: true,
      closureLog: true,
      matches: { select: { resultState: true } },
      predictionSets: { select: { attributionReview: true, status: true } },
    },
  });
  if (!round) {
    return null;
  }
  const unverifiedFixtures = round.matches.filter(
    (match) => match.resultState !== "verified" && match.resultState !== "manual",
  ).length;
  const unresolvedReviews = round.predictionSets.filter(
    (set) => set.attributionReview === "review" || set.status === "flagged",
  ).length;
  return (
    <RoundLockBanner
      closedAt={round.closedAt}
      closureLog={round.closureLog}
      roundId={roundId}
      standingRole={round.standingRole}
      unresolvedReviews={unresolvedReviews}
      unverifiedFixtures={unverifiedFixtures}
    />
  );
}

export function MutationRegion({ closed, children }: { closed: boolean; children: React.ReactNode }) {
  if (!closed) {
    return children;
  }
  return (
    <fieldset className="min-w-0 border-0 p-0" disabled>
      {children}
    </fieldset>
  );
}
