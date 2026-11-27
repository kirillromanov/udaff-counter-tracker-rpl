"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { teamKey } from "@/lib/domain/parser/normalize";
import { saveTeamAliases } from "@/lib/domain/teams/save-aliases";

function spellingsPath(key: string, extra: string): string {
  return `/admin/teams/spellings?key=${encodeURIComponent(key)}${extra}`;
}

function fail(key: string, error: unknown): never {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : "Could not save spellings";
  redirect(spellingsPath(key, `&error=${encodeURIComponent(message)}`));
}

export async function saveClubSpellingsAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const key = teamKey(name);
  try {
    await saveTeamAliases([
      {
        name,
        aliases: [1, 2, 3].map((slot) => String(formData.get(`alias_${slot}`) ?? "")),
      },
    ]);
    revalidatePath("/admin/teams");
    revalidatePath("/admin/teams/spellings");
    redirect(spellingsPath(key, "&saved=1"));
  } catch (error) {
    fail(key, error);
  }
}
