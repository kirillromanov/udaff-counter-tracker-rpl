import { prisma } from "@/lib/db/prisma";
import { closureWarning, isRoundClosed, productionLockLabel } from "@/lib/domain/rounds/round-lock";
import { ARCHIVED_ROUND } from "@/lib/domain/standings/round-role";
import { formatMoscow } from "@/lib/domain/time/moscow";
import { Badge, Notice } from "../../ui";
import { RoundLockControls } from "./round-lock-controls";

function eventLabel(action: string | undefined): string {
  if (action === "reopened") {
    return "Reopened";
  }
  if (action === "started") {
    return "Started";
  }
  return "Closed";
}

export function RoundLockBanner({
  roundId,
  standingRole,
  closedAt,
  productionStartedAt,
  closureLog,
  unverifiedFixtures,
  unresolvedReviews,
}: {
  roundId: string;
  standingRole: string;
  closedAt: Date | null;
  productionStartedAt: Date | null;
  closureLog: string;
  unverifiedFixtures: number;
  unresolvedReviews: number;
}) {
  if (standingRole === ARCHIVED_ROUND) {
    return null;
  }
  const closed = isRoundClosed(closedAt);
  const preparing = productionStartedAt == null && !closed;
  const warning = closureWarning({ unverifiedFixtures, unresolvedReviews });
  let latest = "";
  try {
    const events = JSON.parse(closureLog) as { action?: string; at?: string }[];
    const last = Array.isArray(events) ? events.at(-1) : null;
    if (last?.at) {
      latest = `${eventLabel(last.action)} ${formatMoscow(new Date(last.at))}.`;
    }
  } catch {
    latest = "";
  }
  const label = productionLockLabel(standingRole, closedAt, productionStartedAt);
  const mode = closed ? "reopen" : preparing ? "start" : "close";

  return (
    <Notice label={label} tone={closed ? "warning" : "info"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {closed ? (
            <p>
              This production round is closed. Saved fixtures, predictions, results, and standings stay visible and can be
              exported. Imports, editing, and recalculation are blocked until it is reopened. {latest}
            </p>
          ) : preparing ? (
            <p>
              Preparing. Production has not started. Load the source, fixtures, and predictions here. Automatic comment
              and result checks stay off until you start production. {latest}
            </p>
          ) : (
            <p>This production round is active. Close it when the saved data should stop changing. {latest}</p>
          )}
          {!closed && !preparing && warning ? <p className="mt-2">{warning}</p> : null}
        </div>
        <RoundLockControls mode={mode} roundId={roundId} warning={warning} />
      </div>
    </Notice>
  );
}

export function RoundLockBadge({
  standingRole,
  closedAt,
  productionStartedAt,
}: {
  standingRole: string;
  closedAt: Date | null;
  productionStartedAt?: Date | null;
}) {
  const label = productionLockLabel(standingRole, closedAt, productionStartedAt);
  const tone = label === "Closed" ? "warning" : label === "Production" ? "info" : "neutral";
  return <Badge tone={tone}>{label}</Badge>;
}

export async function RoundLockPanel({ roundId }: { roundId: string }) {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    select: {
      standingRole: true,
      closedAt: true,
      productionStartedAt: true,
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
      productionStartedAt={round.productionStartedAt}
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
