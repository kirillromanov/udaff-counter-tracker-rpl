import { prisma } from "@/lib/db/prisma";
import { validateTeamAliasDrafts, type TeamAliasDraft } from "./validate-aliases";

/**
 * Store team spellings for later parses.
 * This writes only the team-name tables. It does not read or write comments,
 * predictions, fixtures, or scores, and it does not start a parse.
 */
export async function saveTeamAliases(drafts: readonly TeamAliasDraft[]): Promise<void> {
  const [stored, matches] = await Promise.all([
    prisma.teamName.findMany({ include: { aliases: true } }),
    prisma.match.findMany({ select: { homeTeam: true, awayTeam: true } }),
  ]);
  const draftKeys = new Set(drafts.map((draft) => draft.name));
  const known = [
    ...stored
      .filter((team) => !draftKeys.has(team.name))
      .map((team) => ({ name: team.name, aliases: team.aliases.map((alias) => alias.alias) })),
    ...matches.flatMap((match) => [match.homeTeam, match.awayTeam]).map((name) => ({ name, aliases: [] as string[] })),
  ];
  const result = validateTeamAliasDrafts(drafts, known);
  if (!result.ok) {
    throw new Error(result.message);
  }

  await prisma.$transaction(async (tx) => {
    for (const team of result.teams) {
      const existing = await tx.teamName.findUnique({ where: { normalizedName: team.normalizedName } });
      if (team.aliases.length === 0) {
        if (existing) {
          await tx.teamNameAlias.deleteMany({ where: { teamNameId: existing.id } });
          await tx.teamName.delete({ where: { id: existing.id } });
        }
        continue;
      }
      const row = existing
        ? await tx.teamName.update({ where: { id: existing.id }, data: { name: team.name } })
        : await tx.teamName.create({ data: { name: team.name, normalizedName: team.normalizedName } });
      await tx.teamNameAlias.deleteMany({ where: { teamNameId: row.id } });
      if (team.aliases.length > 0) {
        await tx.teamNameAlias.createMany({
          data: team.aliases.map((alias) => ({
            teamNameId: row.id,
            slot: alias.slot,
            alias: alias.alias,
            normalized: alias.normalized,
          })),
        });
      }
    }
  });
}

export async function teamAliasesByKey(): Promise<Map<string, string[]>> {
  const teams = await prisma.teamName.findMany({ include: { aliases: { orderBy: { slot: "asc" } } } });
  return new Map(teams.map((team) => [team.normalizedName, team.aliases.map((alias) => alias.alias)]));
}
