"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { importRounds } from "@/lib/domain/import/batch-import";
import { standingRoleForRound } from "@/lib/domain/standings/round-role";

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "season";
}

function fail(path: string, error: unknown): never {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function unique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function createSeasonAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  try {
    if (!name) {
      throw new Error("Season name is required");
    }
    const requested = String(formData.get("slug") ?? "").trim();
    const season = await prisma.season.create({
      data: {
        name,
        slug: slugify(requested || name),
        scoringConfig: { create: {} },
      },
    });
    revalidatePath("/admin");
    redirect(`/admin/seasons/${season.id}`);
  } catch (error) {
    if (unique(error)) {
      fail("/admin", new Error("A season with that slug already exists"));
    }
    fail("/admin", error);
  }
}

export async function createRoundAction(formData: FormData): Promise<void> {
  const seasonId = String(formData.get("seasonId") ?? "");
  const path = `/admin/seasons/${seasonId}`;
  try {
    const number = Number(formData.get("number"));
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error("Round number must be a positive integer");
    }
    const name = String(formData.get("name") ?? "").trim();
    const checkpoint = await prisma.standingsCheckpoint.findFirst({
      where: { seasonId, source: "manual" },
      orderBy: { afterRoundNumber: "desc" },
      select: { afterRoundNumber: true },
    });
    const round = await prisma.round.create({
      data: {
        seasonId,
        number,
        name: name || null,
        status: "open",
        standingRole: standingRoleForRound(number, checkpoint?.afterRoundNumber ?? null),
      },
    });
    revalidatePath(path);
    revalidatePath("/admin");
    redirect(`/admin/rounds/${round.id}`);
  } catch (error) {
    if (unique(error)) {
      fail(path, new Error("That round number already exists in this season"));
    }
    fail(path, error);
  }
}

export async function importRoundsAction(formData: FormData): Promise<void> {
  const seasonId = String(formData.get("seasonId") ?? "");
  const path = `/admin/seasons/${seasonId}`;
  try {
    const reports = await importRounds({ seasonId });
    const rounds = await prisma.round.findMany({ where: { seasonId }, select: { id: true } });
    revalidatePath("/admin");
    revalidatePath(path);
    revalidatePath(`/admin/seasons/${seasonId}/checkpoint`);
    for (const round of rounds) {
      revalidatePath(`/admin/rounds/${round.id}`);
      revalidatePath(`/admin/rounds/${round.id}/review`);
    }
    const failed = reports.filter((report) => report.error);
    if (failed.length > 0) {
      throw new Error(failed.map((report) => `Round ${report.number}: ${report.error}`).join("; "));
    }
    const accepted = reports.reduce((total, report) => total + report.accepted, 0);
    const flagged = reports.reduce((total, report) => total + report.flaggedSets + report.unmatchedAuthors, 0);
    redirect(
      `${path}?imported=${encodeURIComponent(`Imported ${reports.length} rounds. ${accepted} slips accepted, ${flagged} rows left in review. Standings were not calculated.`)}`,
    );
  } catch (error) {
    fail(path, error);
  }
}
