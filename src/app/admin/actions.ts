"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

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
    const round = await prisma.round.create({
      data: {
        seasonId,
        number,
        name: name || null,
        status: "open",
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
