"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { fetchForumPost } from "@/lib/domain/forum/fetch-post";
import {
  addManualPredictionSet,
  mergeParticipants,
  parseStoredComments,
  renameParticipant,
  saveForumPost,
  selectPredictionSet,
  updatePredictionFromForm,
} from "@/lib/domain/import/persist-import";

function reviewPath(roundId: string): string {
  return `/admin/rounds/${roundId}/review`;
}

function refreshRound(roundId: string): void {
  revalidatePath(reviewPath(roundId));
  revalidatePath(`/admin/rounds/${roundId}`);
}

function fail(roundId: string, error: unknown): never {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`${reviewPath(roundId)}?error=${encodeURIComponent(message)}`);
}

export async function fetchCommentsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const post = await fetchForumPost(String(formData.get("url") ?? ""));
    const saved = await saveForumPost(roundId, post);
    refreshRound(roundId);
    redirect(`${reviewPath(roundId)}?imported=${saved}`);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function parseCommentsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const parsed = await parseStoredComments(roundId);
    refreshRound(roundId);
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

export async function addManualSetAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await addManualPredictionSet(roundId, String(formData.get("participantName") ?? ""));
    refreshRound(roundId);
  } catch (error) {
    fail(roundId, error);
  }
}
