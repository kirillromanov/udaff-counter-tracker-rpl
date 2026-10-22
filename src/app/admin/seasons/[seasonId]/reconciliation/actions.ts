"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { findParticipantByName } from "@/lib/domain/participants/registry";
import { participantKey } from "@/lib/domain/import/participant-key";
import { loadReconciliation } from "@/lib/domain/standings/load-reconciliation";
import { rebuildComputedStandings } from "@/lib/domain/standings/rebuild-computed";
import type { ReconciliationDecisionAction } from "@/lib/domain/standings/reconcile";

function fail(seasonId: string, error: unknown): never {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`/admin/seasons/${seasonId}/reconciliation?error=${encodeURIComponent(message)}`);
}

function pageOf(seasonId: string): string {
  return `/admin/seasons/${seasonId}/reconciliation`;
}

const ACTIONS = new Set<ReconciliationDecisionAction>(["accept_computed", "keep_manual", "alias", "manual_correction"]);

export async function reconciliationDecisionAction(formData: FormData): Promise<void> {
  const seasonId = String(formData.get("seasonId") ?? "");
  const path = pageOf(seasonId);
  try {
    const afterRoundNumber = Number(formData.get("afterRoundNumber"));
    const subjectName = String(formData.get("subjectName") ?? "").trim();
    const action = String(formData.get("action") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    const participantId = String(formData.get("participantId") ?? "").trim();
    if (!seasonId || !Number.isInteger(afterRoundNumber) || !subjectName) {
      throw new Error("Reconciliation decision is missing a row");
    }
    if (!ACTIONS.has(action as ReconciliationDecisionAction)) {
      throw new Error("Unknown reconciliation action");
    }
    const decision = action as ReconciliationDecisionAction;
    const checkpoint = await prisma.standingsCheckpoint.findFirst({
      where: { seasonId, afterRoundNumber, source: "manual" },
      select: { id: true },
    });
    if (!checkpoint) {
      throw new Error("Manual checkpoint was not found. Nothing was written to a baseline.");
    }
    if (decision === "accept_computed") {
      const page = await loadReconciliation(seasonId);
      const row = page?.report?.rows.find((item) => item.displayName === subjectName);
      if (!row?.computed) {
        throw new Error("There is no reference result to accept. The trusted baseline was left unchanged. Production standings were not changed.");
      }
    }
    await prisma.reconciliationDecision.upsert({
      where: { seasonId_afterRoundNumber_subjectName: { seasonId, afterRoundNumber, subjectName } },
      create: {
        seasonId,
        afterRoundNumber,
        subjectName,
        action: decision,
        note: note || null,
        participantId: participantId || null,
      },
      update: {
        action: decision,
        note: note || null,
        participantId: participantId || null,
      },
    });
    revalidatePath(path);
    revalidatePath(`/admin/seasons/${seasonId}/checkpoint`);
    redirect(`${path}?saved=${encodeURIComponent(subjectName)}`);
  } catch (error) {
    fail(seasonId, error);
  }
}

export async function markAliasAction(formData: FormData): Promise<void> {
  const seasonId = String(formData.get("seasonId") ?? "");
  try {
    const afterRoundNumber = Number(formData.get("afterRoundNumber"));
    const alias = String(formData.get("alias") ?? "").trim();
    const participantId = String(formData.get("participantId") ?? "").trim();
    if (!alias || !participantId || !Number.isInteger(afterRoundNumber)) {
      throw new Error("Choose the roster name this alias belongs to");
    }
    const checkpoint = await prisma.standingsCheckpoint.findFirst({
      where: { seasonId, afterRoundNumber, source: "manual" },
      select: { id: true },
    });
    if (!checkpoint) {
      throw new Error("Manual checkpoint was not found. No alias was added.");
    }
    const owner = await prisma.participant.findUnique({ where: { id: participantId } });
    if (!owner) {
      throw new Error("That participant is not in the registry");
    }
    const key = participantKey(alias);
    if (!key || key === owner.normalizedName) {
      throw new Error("That name is already this participant");
    }
    const taken = await findParticipantByName(alias);
    if (taken && taken.id !== owner.id) {
      throw new Error(`That name already belongs to ${taken.name}. No alias was added.`);
    }
    if (!taken) {
      await prisma.participantAlias.create({
        data: { participantId: owner.id, alias, normalized: key, isPrimary: false },
      });
    }
    await prisma.reconciliationDecision.upsert({
      where: { seasonId_afterRoundNumber_subjectName: { seasonId, afterRoundNumber, subjectName: alias } },
      create: {
        seasonId,
        afterRoundNumber,
        subjectName: alias,
        action: "alias",
        note: `Alias of ${owner.name}. Comments stay in review until the next import.`,
        participantId: owner.id,
      },
      update: {
        action: "alias",
        note: `Alias of ${owner.name}. Comments stay in review until the next import.`,
        participantId: owner.id,
      },
    });
    revalidatePath(pageOf(seasonId));
    revalidatePath("/admin/participants");
    redirect(`${pageOf(seasonId)}?saved=${encodeURIComponent(alias)}`);
  } catch (error) {
    fail(seasonId, error);
  }
}

export async function rebuildComputedAction(formData: FormData): Promise<void> {
  const seasonId = String(formData.get("seasonId") ?? "");
  try {
    const afterRoundNumber = Number(formData.get("afterRoundNumber"));
    const before = await prisma.standingsCheckpoint.findFirst({
      where: { seasonId, afterRoundNumber, source: "manual" },
      select: { rawText: true },
    });
    const scored = await rebuildComputedStandings(seasonId, afterRoundNumber);
    const after = await prisma.standingsCheckpoint.findFirst({
      where: { seasonId, afterRoundNumber, source: "manual" },
      select: { rawText: true },
    });
    if (before?.rawText !== after?.rawText) {
      throw new Error("The trusted baseline changed during the reference check. Review the checkpoint before trusting the report. Production standings were not changed.");
    }
    revalidatePath(`/admin/seasons/${seasonId}`);
    revalidatePath(`/admin/seasons/${seasonId}/standings`);
    revalidatePath(pageOf(seasonId));
    redirect(`${pageOf(seasonId)}?rebuilt=${scored}`);
  } catch (error) {
    fail(seasonId, error);
  }
}
