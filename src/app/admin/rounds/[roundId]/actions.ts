"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { refreshDuePredictions, refreshRoundPredictions } from "@/lib/domain/import/refresh-predictions";
import {
  addManualPredictionSet,
  mergeParticipants,
  parseStoredComments,
  renameParticipant,
  reparseAuthor,
  selectPredictionSet,
  updatePredictionFromForm,
} from "@/lib/domain/import/persist-import";
import {
  createParticipantForAuthor,
  ignoreForumAuthor,
  importAuthorAnyway,
  linkForumAuthor,
  stopIgnoringForumAuthor,
} from "@/lib/domain/participants/registry";

function reviewPath(roundId: string): string {
  return `/admin/rounds/${roundId}/review`;
}

function refreshRound(roundId: string, seasonId?: string): void {
  revalidatePath(reviewPath(roundId));
  revalidatePath(`/admin/rounds/${roundId}`);
  revalidatePath(`/admin/rounds/${roundId}/results`);
  if (seasonId) {
    revalidatePath(`/admin/seasons/${seasonId}`);
    revalidatePath(`/admin/seasons/${seasonId}/standings`);
  }
}

function fail(roundId: string, error: unknown): never {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`${reviewPath(roundId)}?error=${encodeURIComponent(message)}`);
}

export async function fetchCommentsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const url = String(formData.get("url") ?? "").trim();
    const report = await refreshRoundPredictions(roundId, url ? { url } : undefined);
    refreshRound(roundId, report.seasonId);
    redirect(`${reviewPath(roundId)}?fetched=${encodeURIComponent(report.summary)}`);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function refreshDuePredictionsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const report = await refreshDuePredictions();
    const seasonIds = [...new Set(report.rounds.map((round) => round.seasonId).filter(Boolean))];
    refreshRound(roundId, seasonIds[0]);
    for (const seasonId of seasonIds.slice(1)) {
      refreshRound(roundId, seasonId);
    }
    for (const round of report.rounds) {
      refreshRound(round.roundId, round.seasonId);
    }
    const message = report.checked
      ? report.rounds.map((round) => `Round ${round.number}: ${round.summary}`).join(" · ")
      : "No active round is due.";
    redirect(`${reviewPath(roundId)}?fetched=${encodeURIComponent(message)}`);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function parseCommentsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const parsed = await parseStoredComments(roundId);
    const round = await prisma.round.findUnique({ where: { id: roundId }, select: { seasonId: true } });
    refreshRound(roundId, round?.seasonId);
    redirect(`${reviewPath(roundId)}?parsed=${parsed}`);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function updatePredictionAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await updatePredictionFromForm(formData);
    refreshRound(roundId);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function selectSetAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await selectPredictionSet(String(formData.get("setId") ?? ""));
    refreshRound(roundId);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function renameParticipantAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await renameParticipant(String(formData.get("participantId") ?? ""), String(formData.get("name") ?? ""));
    refreshRound(roundId);
    revalidatePath("/admin");
  } catch (error) {
    fail(roundId, error);
  }
}

export async function mergeParticipantsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await mergeParticipants(String(formData.get("sourceId") ?? ""), String(formData.get("targetId") ?? ""));
    refreshRound(roundId);
    revalidatePath("/admin");
  } catch (error) {
    fail(roundId, error);
  }
}

async function applyIdentity(
  roundId: string,
  seasonId: string,
  authorName: string,
  change: () => Promise<void>,
): Promise<void> {
  try {
    await change();
    await reparseAuthor(authorName);
    refreshRound(roundId);
    revalidatePath("/admin/participants");
    if (seasonId) {
      revalidatePath(`/admin/seasons/${seasonId}`);
      revalidatePath(`/admin/seasons/${seasonId}/reconciliation`);
    }
    redirect(`${reviewPath(roundId)}?identity=1`);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function ignoreAuthorAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  const authorName = String(formData.get("authorName") ?? "");
  await applyIdentity(roundId, seasonId, authorName, () => ignoreForumAuthor(authorName));
}

export async function stopIgnoringAuthorAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  const authorName = String(formData.get("authorName") ?? "");
  await applyIdentity(roundId, seasonId, authorName, () => stopIgnoringForumAuthor(authorName));
}

export async function importIgnoredAuthorAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  const authorName = String(formData.get("authorName") ?? "");
  await applyIdentity(roundId, seasonId, authorName, () => importAuthorAnyway(roundId, authorName));
}

export async function linkAuthorAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  const authorName = String(formData.get("authorName") ?? "");
  const participantId = String(formData.get("participantId") ?? "");
  await applyIdentity(roundId, seasonId, authorName, async () => {
    if (!participantId) {
      throw new Error("Choose the participant this author belongs to");
    }
    await linkForumAuthor(authorName, participantId);
  });
}

export async function createAuthorParticipantAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  const authorName = String(formData.get("authorName") ?? "");
  await applyIdentity(roundId, seasonId, authorName, async () => {
    await createParticipantForAuthor(authorName, seasonId);
  });
}

export async function addManualSetAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await addManualPredictionSet(roundId, String(formData.get("participantName") ?? ""));
    refreshRound(roundId);
  } catch (error) {
    fail(roundId, error);
  }
}
