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

function roundPath(roundId: string): string {
  return `/admin/rounds/${roundId}`;
}

function fail(roundId: string, error: unknown): never {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`${roundPath(roundId)}?error=${encodeURIComponent(message)}`);
}

export async function fetchCommentsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const post = await fetchForumPost(String(formData.get("url") ?? ""));
    const saved = await saveForumPost(roundId, post);
    revalidatePath(roundPath(roundId));
    redirect(`${roundPath(roundId)}?imported=${saved}`);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function parseCommentsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    const parsed = await parseStoredComments(roundId);
    revalidatePath(roundPath(roundId));
    redirect(`${roundPath(roundId)}?parsed=${parsed}`);
  } catch (error) {
    fail(roundId, error);
  }
}

export async function updatePredictionAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await updatePredictionFromForm(formData);
    revalidatePath(roundPath(roundId));
  } catch (error) {
    fail(roundId, error);
  }
}

export async function selectSetAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await selectPredictionSet(String(formData.get("setId") ?? ""));
    revalidatePath(roundPath(roundId));
  } catch (error) {
    fail(roundId, error);
  }
}

export async function renameParticipantAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await renameParticipant(String(formData.get("participantId") ?? ""), String(formData.get("name") ?? ""));
    revalidatePath(roundPath(roundId));
    revalidatePath("/admin");
  } catch (error) {
    fail(roundId, error);
  }
}

export async function mergeParticipantsAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await mergeParticipants(String(formData.get("sourceId") ?? ""), String(formData.get("targetId") ?? ""));
    revalidatePath(roundPath(roundId));
    revalidatePath("/admin");
  } catch (error) {
    fail(roundId, error);
  }
}

export async function addManualSetAction(formData: FormData): Promise<void> {
  const roundId = String(formData.get("roundId") ?? "");
  try {
    await addManualPredictionSet(roundId, String(formData.get("participantName") ?? ""));
    revalidatePath(roundPath(roundId));
  } catch (error) {
    fail(roundId, error);
  }
}
