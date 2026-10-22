"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { forumUrlSchema } from "@/lib/domain/forum/fetch-post";
import { planRoundPoll, pollIntervals } from "@/lib/domain/results/poll";
import { ingestAndTrack, pollDueRounds } from "@/lib/domain/results/poll-run";
import { recalculateRound } from "@/lib/domain/standings/recalculate-round";

function hubPath(roundId: string): string {
  return `/admin/rounds/${roundId}`;
}

function fixturesPath(roundId: string): string {
  return `/admin/rounds/${roundId}/fixtures`;
}

function fail(path: string, error: unknown): never {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function goals(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Scores must be empty or a non-negative integer");
  }
  return parsed;
}

function refresh(roundId: string): void {
  revalidatePath(hubPath(roundId));
  revalidatePath(fixturesPath(roundId));
  revalidatePath(`/admin/rounds/${roundId}/results`);
  revalidatePath(`/admin/rounds/${roundId}/export`);
}

export async function saveFixturesAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const round = await prisma.round.findUniqueOrThrow({
      where: { id: roundId },
      include: { matches: true },
    });
    const matchOfTheRound = String(formData.get("matchOfTheRound") ?? "");
    for (const match of round.matches) {
      const homeTeam = String(formData.get(`home_${match.id}`) ?? "").trim();
      const awayTeam = String(formData.get(`away_${match.id}`) ?? "").trim();
      if (!homeTeam || !awayTeam) {
        throw new Error("Each fixture needs a home team and an away team");
      }
      const sortOrder = Number(formData.get(`order_${match.id}`));
      if (!Number.isInteger(sortOrder)) {
        throw new Error("Sort order must be an integer");
      }
      const actualHomeGoals = goals(formData.get(`homeGoals_${match.id}`));
      const actualAwayGoals = goals(formData.get(`awayGoals_${match.id}`));
      if ((actualHomeGoals == null) !== (actualAwayGoals == null)) {
        throw new Error(`Enter both scores for ${homeTeam} — ${awayTeam}, or leave both empty`);
      }
      const scoreChanged = actualHomeGoals !== match.actualHomeGoals || actualAwayGoals !== match.actualAwayGoals;
      await prisma.match.update({
        where: { id: match.id },
        data: {
          homeTeam,
          awayTeam,
          sortOrder,
          actualHomeGoals,
          actualAwayGoals,
          isMatchOfTheRound: match.id === matchOfTheRound,
          ...(scoreChanged
            ? {
                resultState: actualHomeGoals == null ? "open" : "manual",
                resultConflict: false,
                resultResolution: actualHomeGoals == null ? "" : "manual",
                resultNote: actualHomeGoals == null ? null : "Entered on the fixtures page.",
                conflictAcknowledgedAt: null,
              }
            : {}),
        },
      });
    }
    refresh(roundId);
    redirect(`${fixturesPath(roundId)}?saved=1`);
  } catch (error) {
    fail(fixturesPath(roundId), error);
  }
}

export async function addFixtureAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const homeTeam = String(formData.get("homeTeam") ?? "").trim();
    const awayTeam = String(formData.get("awayTeam") ?? "").trim();
    if (!homeTeam || !awayTeam) {
      throw new Error("A fixture needs a home team and an away team");
    }
    const last = await prisma.match.findFirst({
      where: { roundId },
      orderBy: { sortOrder: "desc" },
    });
    await prisma.match.create({
      data: {
        roundId,
        homeTeam,
        awayTeam,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    refresh(roundId);
    redirect(fixturesPath(roundId));
  } catch (error) {
    fail(fixturesPath(roundId), error);
  }
}

export async function deleteFixtureAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await prisma.match.delete({ where: { id: String(formData.get("matchId") ?? "") } });
    refresh(roundId);
    redirect(fixturesPath(roundId));
  } catch (error) {
    fail(fixturesPath(roundId), error);
  }
}

export async function saveForumUrlAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const raw = String(formData.get("forumUrl") ?? "").trim();
    let forumUrl: string | null = null;
    if (raw) {
      const parsed = forumUrlSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Enter a full http:// or https:// forum URL");
      }
      forumUrl = parsed.data;
    }
    const round = await prisma.round.update({
      where: { id: roundId },
      data: { forumUrl },
    });
    revalidatePath(hubPath(roundId));
    revalidatePath(`/admin/seasons/${round.seasonId}`);
    redirect(hubPath(roundId));
  } catch (error) {
    fail(hubPath(roundId), error);
  }
}

export async function fetchResultsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const round = await prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { seasonId: true } });
    const report = await ingestAndTrack(round.seasonId);
    refresh(roundId);
    const failed = report.sources.filter((source) => source.status === "failed").length;
    redirect(`${fixturesPath(roundId)}?fetched=1&confirmed=${report.confirmed}&verified=${report.verified}&conflicts=${report.conflicts}&insufficient=${report.insufficient}&failed=${failed}`);
  } catch (error) {
    fail(fixturesPath(roundId), error);
  }
}

export async function pollDueAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const report = await pollDueRounds();
    refresh(roundId);
    if (!report.checked) {
      const round = await prisma.round.findUniqueOrThrow({
        where: { id: roundId },
        include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
      });
      const plan = planRoundPoll(
        round.matches.map((item) => ({
          kickoffAt: item.kickoffAt,
          actualHomeGoals: item.actualHomeGoals,
          actualAwayGoals: item.actualAwayGoals,
          resultState: item.resultState,
          resultResolution: item.resultResolution,
          resultConflict: item.resultConflict,
          conflictAcknowledgedAt: item.conflictAcknowledgedAt,
          liveReported: item.resultObservations.some((observation) => observation.matchStatus === "live"),
        })),
        new Date(),
        pollIntervals(),
      );
      redirect(`${fixturesPath(roundId)}?polled=${plan.active ? "waiting" : "stopped"}`);
    }
    const result = report.seasons[0]?.report;
    const failed = result?.sources.filter((source) => source.status === "failed").length ?? 0;
    redirect(
      `${fixturesPath(roundId)}?polled=1&confirmed=${result?.confirmed ?? 0}&verified=${result?.verified ?? 0}&conflicts=${result?.conflicts ?? 0}&insufficient=${result?.insufficient ?? 0}&failed=${failed}`,
    );
  } catch (error) {
    fail(fixturesPath(roundId), error);
  }
}

export async function pollRoundAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const report = await pollDueRounds({ forceRoundId: roundId });
    refresh(roundId);
    if (!report.checked) {
      redirect(`${fixturesPath(roundId)}?polled=stopped`);
    }
    const result = report.seasons[0]?.report;
    const failed = result?.sources.filter((source) => source.status === "failed").length ?? 0;
    redirect(
      `${fixturesPath(roundId)}?polled=1&confirmed=${result?.confirmed ?? 0}&verified=${result?.verified ?? 0}&conflicts=${result?.conflicts ?? 0}&insufficient=${result?.insufficient ?? 0}&failed=${failed}`,
    );
  } catch (error) {
    fail(fixturesPath(roundId), error);
  }
}

export async function acknowledgeConflictAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const matchId = String(formData.get("matchId") ?? "");
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match || !match.resultConflict) {
      throw new Error("This fixture has no source conflict to acknowledge");
    }
    await prisma.match.update({
      where: { id: matchId },
      data: {
        conflictAcknowledgedAt: new Date(),
        resultNote: match.resultNote ? `${match.resultNote} Conflict acknowledged by admin.` : "Conflict acknowledged by admin.",
      },
    });
    const round = await prisma.round.findUniqueOrThrow({
      where: { id: roundId },
      include: { matches: { include: { resultObservations: { select: { matchStatus: true } } } } },
    });
    const plan = planRoundPoll(
      round.matches.map((item) => ({
        kickoffAt: item.kickoffAt,
        actualHomeGoals: item.actualHomeGoals,
        actualAwayGoals: item.actualAwayGoals,
        resultState: item.resultState,
        resultResolution: item.resultResolution,
        resultConflict: item.resultConflict,
        conflictAcknowledgedAt: item.conflictAcknowledgedAt,
        liveReported: item.resultObservations.some((observation) => observation.matchStatus === "live"),
      })),
      new Date(),
      pollIntervals(),
    );
    await prisma.round.update({
      where: { id: roundId },
      data: { pollStatus: plan.pollStatus, nextPollAt: plan.nextPollAt },
    });
    refresh(roundId);
    redirect(`${fixturesPath(roundId)}?saved=1`);
  } catch (error) {
    fail(fixturesPath(roundId), error);
  }
}

export async function acceptSourceScoreAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const matchId = String(formData.get("matchId") ?? "");
    const homeGoals = goals(formData.get("homeGoals"));
    const awayGoals = goals(formData.get("awayGoals"));
    const source = String(formData.get("source") ?? "").trim();
    if (homeGoals == null || awayGoals == null || !source) {
      throw new Error("Choose a source score to keep");
    }
    await prisma.match.update({
      where: { id: matchId },
      data: {
        actualHomeGoals: homeGoals,
        actualAwayGoals: awayGoals,
        resultState: "manual",
        resultConflict: false,
        resultResolution: "manual",
        resultNote: `Accepted ${source} ${homeGoals}-${awayGoals}. Later fetches will not replace it.`,
        conflictAcknowledgedAt: null,
      },
    });
    refresh(roundId);
    redirect(`${fixturesPath(roundId)}?saved=1`);
  } catch (error) {
    fail(fixturesPath(roundId), error);
  }
}

export async function calculateRoundAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const count = await recalculateRound(roundId);
    const round = await prisma.round.findUniqueOrThrow({ where: { id: roundId } });
    refresh(roundId);
    revalidatePath(`/admin/seasons/${round.seasonId}`);
    revalidatePath(`/admin/seasons/${round.seasonId}/standings`);
    redirect(`/admin/rounds/${roundId}/results?calculated=${count}`);
  } catch (error) {
    fail(hubPath(roundId), error);
  }
}
