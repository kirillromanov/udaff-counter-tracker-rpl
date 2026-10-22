import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { parseBreakdown } from "@/lib/domain/export/export-audit";
import { confidenceLabel, fixtureConfidence, type LiveConfidence } from "@/lib/domain/scoring/live-score";
import { loadLiveRound } from "@/lib/domain/standings/load-live";
import { RoundNav } from "../../../round-nav";
import {
  Badge,
  CrumbLink,
  DataTable,
  EmptyState,
  Notice,
  PageBody,
  PageHeader,
  RoundScoreTable,
  Section,
  Th,
  cx,
} from "../../../ui";

export const instant = false;

function confidenceTone(confidence: LiveConfidence): "success" | "warning" | "danger" | "neutral" {
  if (confidence === "verified") {
    return "success";
  }
  if (confidence === "provisional") {
    return "warning";
  }
  if (confidence === "conflict") {
    return "danger";
  }
  return "neutral";
}

function categoryTone(category: string): string {
  if (category === "exact") {
    return "text-emerald-700";
  }
  if (category === "miss") {
    return "text-rose-700";
  }
  return "text-zinc-700";
}

export default async function RoundResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ calculated?: string }>;
}) {
  await connection();
  const { roundId } = await params;
  const query = await searchParams;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      season: true,
      roundScores: { include: { participant: true } },
    },
  });
  if (!round) {
    notFound();
  }

  const live = await loadLiveRound(round.id);
  const scores = [...round.roundScores].sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    return left.participant.name.localeCompare(right.participant.name, "ru");
  });

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/seasons/${round.seasonId}`}>{round.season.name}</CrumbLink>
            <span>/</span>
            <CrumbLink href={`/admin/rounds/${round.id}`}>
              {round.number}. {round.name ?? "Round"}
            </CrumbLink>
          </>
        }
        description="Live points follow the fixtures that have a result. A stored confirmed total is separate and is written only after every fixture is verified."
        nav={<RoundNav roundId={round.id} seasonId={round.seasonId} />}
        title="Round results"
      />
      <PageBody>
        {query.calculated ? <Notice tone="success">Calculated {query.calculated} participants.</Notice> : null}
        {live ? (
          <Section
            description={
              live.complete
                ? "Every fixture is verified. The live total matches a confirmed calculation, including the round bonus. Store it with Calculate round."
                : "Verified match points and provisional match points are labeled. Pending and open conflicts add nothing. The round bonus waits until every fixture is verified."
            }
            id="live"
            title="Live round"
          >
            <ul className="mb-4 flex flex-wrap gap-2 text-sm">
              {live.fixtures.map((fixture) => (
                <li key={fixture.matchId}>
                  <Badge tone={confidenceTone(fixtureConfidence(fixture))}>
                    {confidenceLabel(fixtureConfidence(fixture), fixture.resultConflict && fixture.conflictAcknowledged)} {fixture.label}
                  </Badge>
                </li>
              ))}
            </ul>
            {live.rows.length === 0 ? (
              <EmptyState detail="Select a prediction set before live points can be shown." title="No selected slips" />
            ) : (
              <DataTable>
                <thead>
                  <tr className="border-b border-zinc-200">
                    <Th>Rank</Th>
                    <Th>Participant</Th>
                    <Th className="text-right">Verified</Th>
                    <Th className="text-right">Provisional</Th>
                    <Th className="text-right">Live total</Th>
                    <Th className="text-right">Pending</Th>
                    <Th className="text-right">Conflicts</Th>
                  </tr>
                </thead>
                <tbody>
                  {live.rows.map((row) => (
                    <tr className="border-b border-zinc-100 last:border-0" key={row.participantId}>
                      <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.rank}</td>
                      <td className="px-3 py-2.5 font-medium">{row.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.confirmedPoints}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.provisionalPoints}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{row.livePoints}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.pendingCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.conflictCount}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Section>
        ) : null}
        {scores.length === 0 ? (
          <Section id="results" title="Stored confirmed results">
            <EmptyState detail="Calculate the round after every fixture is verified. Until then, the live table above is the current view." title="No confirmed total stored" />
          </Section>
        ) : (
          <>
            <Section id="results" title="Stored confirmed ranking">
              <RoundScoreTable rows={scores} />
            </Section>
            <div className="space-y-4">
              {scores.map((score) => {
                const breakdown = parseBreakdown(score.breakdownJson);
                return (
                  <Section
                    description={`Exact ${score.exactCount} · neighbor ${score.neighborCount} · diff ${score.diffCount} · outcome ${score.outcomeCount} · miss ${score.missCount}`}
                    key={`${score.id}-detail`}
                    title={`${score.participant.name} — ${score.totalPoints}`}
                    action={score.isRoundWinner ? <Badge tone="warning">☼ round winner</Badge> : undefined}
                  >
                    {!breakdown ? (
                      <p className="text-sm text-zinc-500">No breakdown stored.</p>
                    ) : (
                      <ul className="divide-y divide-zinc-100 text-sm">
                        {breakdown.matches.map((match) => (
                          <li className="py-2.5" key={match.label}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="font-medium">{match.label}</span>
                              <span className="tabular-nums">
                                <span className={categoryTone(match.baseCategory)}>{match.baseCategory}</span> {match.basePoints}
                                {match.bonusPoints ? ` +${match.bonusPoints}` : ""}
                                {match.mtApplied ? ` ×${match.mtMultiplier}` : ""} = {match.finalMatchPoints}
                              </span>
                            </div>
                            <p className="mt-1 text-zinc-500">
                              pred {match.predicted} · actual {match.actual}
                              {match.mtApplied ? (
                                <span className="ml-2">
                                  <Badge tone="info">Official MT ×{match.mtMultiplier}</Badge>
                                </span>
                              ) : null}
                            </p>
                            <p className={cx("mt-1 text-xs", match.mtApplied ? "text-sky-800" : "text-zinc-500")}>
                              {match.explanations.join(" · ")}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 text-sm text-zinc-600">Round total-goals bonus: {score.roundBonusPoints}.</p>
                  </Section>
                );
              })}
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
