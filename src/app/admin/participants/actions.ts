"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import {
  addParticipantAlias,
  archiveParticipant,
  createParticipant,
  deleteParticipantPermanently,
  removeParticipantAlias,
  restoreParticipant,
  setRosterStatus,
  updateParticipantName,
} from "@/lib/domain/participants/registry";

function fail(path: string, error: unknown): never {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function refresh(participantId?: string, seasonId?: string): void {
  revalidatePath("/admin/participants");
  revalidatePath("/admin");
  if (participantId) {
    revalidatePath(`/admin/participants/${participantId}`);
  }
  if (seasonId) {
    revalidatePath(`/admin/seasons/${seasonId}`);
    revalidatePath(`/admin/seasons/${seasonId}/roster`);
  }
}

export async function createParticipantAction(formData: FormData): Promise<void> {
  const returnTo = String(formData.get("returnTo") ?? "/admin/participants");
  try {
    const participant = await createParticipant(String(formData.get("name") ?? ""));
    const seasonId = String(formData.get("seasonId") ?? "");
    if (seasonId) {
      await setRosterStatus(participant.id, seasonId, "include");
    }
    refresh(participant.id, seasonId || undefined);
    redirect(`/admin/participants/${participant.id}?saved=1`);
  } catch (error) {
    fail(returnTo, error);
  }
}

export async function updateParticipantAction(formData: FormData): Promise<void> {
  const participantId = String(formData.get("participantId") ?? "");
  const path = `/admin/participants/${participantId}`;
  try {
    await updateParticipantName(participantId, String(formData.get("name") ?? ""));
    refresh(participantId);
    redirect(`${path}?saved=1`);
  } catch (error) {
    fail(path, error);
  }
}

export async function addAliasAction(formData: FormData): Promise<void> {
  const participantId = String(formData.get("participantId") ?? "");
  const path = `/admin/participants/${participantId}`;
  try {
    await addParticipantAlias(participantId, String(formData.get("alias") ?? ""));
    refresh(participantId);
    redirect(`${path}?saved=1`);
  } catch (error) {
    fail(path, error);
  }
}

export async function removeAliasAction(formData: FormData): Promise<void> {
  const participantId = String(formData.get("participantId") ?? "");
  const path = `/admin/participants/${participantId}`;
  try {
    await removeParticipantAlias(String(formData.get("aliasId") ?? ""));
    refresh(participantId);
    redirect(`${path}?saved=1`);
  } catch (error) {
    fail(path, error);
  }
}

export async function rosterAction(formData: FormData): Promise<void> {
  const participantId = String(formData.get("participantId") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  const action = String(formData.get("roster") ?? "") === "exclude" ? "exclude" : "include";
  const returnTo = String(formData.get("returnTo") ?? `/admin/seasons/${seasonId}/roster`);
  try {
    await setRosterStatus(participantId, seasonId, action);
    refresh(participantId, seasonId);
    redirect(`${returnTo}?saved=1`);
  } catch (error) {
    fail(returnTo, error);
  }
}

export async function archiveParticipantAction(formData: FormData): Promise<void> {
  const participantId = String(formData.get("participantId") ?? "");
  const path = `/admin/participants/${participantId}`;
  try {
    await archiveParticipant(participantId);
    refresh(participantId);
    redirect(`${path}?saved=1`);
  } catch (error) {
    fail(path, error);
  }
}

export async function restoreParticipantAction(formData: FormData): Promise<void> {
  const participantId = String(formData.get("participantId") ?? "");
  const path = `/admin/participants/${participantId}`;
  try {
    await restoreParticipant(participantId);
    refresh(participantId);
    redirect(`${path}?saved=1`);
  } catch (error) {
    fail(path, error);
  }
}

export async function deleteParticipantAction(formData: FormData): Promise<void> {
  const participantId = String(formData.get("participantId") ?? "");
  const path = `/admin/participants/${participantId}`;
  try {
    await deleteParticipantPermanently(participantId);
    refresh();
    redirect("/admin/participants?saved=1");
  } catch (error) {
    fail(path, error);
  }
}
