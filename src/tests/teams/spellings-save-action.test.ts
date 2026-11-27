import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("saveClubSpellingsAction", () => {
  let directory = "";
  let databaseUrl = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "udaff-spelling-action-"));
    databaseUrl = `file:${path.join(directory, "test.db")}`;
    process.env.DATABASE_URL = databaseUrl;
    execFileSync(path.resolve("node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--accept-data-loss"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  }, 60_000);

  afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("writes one club and leaves the other club's spellings in place", async () => {
    const [{ PrismaClient }, { saveClubSpellingsAction }] = await Promise.all([
      import("@prisma/client"),
      import("@/app/admin/teams/actions"),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const latin = `Динамо М${String.fromCodePoint(0x78)}`;
    try {
      const season = await db.season.create({ data: { name: "Spellings", slug: `spellings-action-${Date.now()}` } });
      await db.round.create({
        data: {
          seasonId: season.id,
          number: 1,
          matches: {
            create: [
              { homeTeam: "Локомотив", awayTeam: latin, sortOrder: 1 },
              { homeTeam: "Крылья Советов", awayTeam: "Динамо", sortOrder: 2 },
            ],
          },
        },
      });
      const makhachkala = new FormData();
      makhachkala.set("name", latin);
      makhachkala.set("alias_1", "Махачкала");
      makhachkala.set("alias_2", "Динамо Махачкала");
      makhachkala.set("alias_3", "Динамо Мх");
      await saveClubSpellingsAction(makhachkala).catch((error: unknown) => {
        if (!(error instanceof Error) || !("digest" in error)) throw error;
      });

      const krylia = new FormData();
      krylia.set("name", "Крылья Советов");
      krylia.set("alias_1", "Кр Советов");
      krylia.set("alias_2", "");
      krylia.set("alias_3", "");
      await saveClubSpellingsAction(krylia).catch((error: unknown) => {
        if (!(error instanceof Error) || !("digest" in error)) throw error;
      });

      const stored = await db.teamName.findMany({ include: { aliases: { orderBy: { slot: "asc" } } }, orderBy: { name: "asc" } });
      const byName = new Map(stored.map((team) => [team.name, team.aliases.map((alias) => alias.alias)]));
      expect(byName.get(latin)).toEqual(["Махачкала", "Динамо Махачкала", "Динамо Мх"]);
      expect(byName.get("Крылья Советов")).toEqual(["Кр Советов"]);
      expect(await db.forumComment.count()).toBe(0);
      expect(await db.prediction.count()).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });
});
