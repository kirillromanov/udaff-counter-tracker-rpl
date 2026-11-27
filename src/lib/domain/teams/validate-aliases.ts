import { teamKey } from "@/lib/domain/parser/normalize";

export interface TeamAliasDraft {
  name: string;
  aliases: readonly string[];
}

export interface KnownTeamSpellings {
  name: string;
  aliases: readonly string[];
}

export interface ValidatedTeamAliases {
  name: string;
  normalizedName: string;
  aliases: Array<{ slot: number; alias: string; normalized: string }>;
}

/**
 * Check three optional spellings for each team.
 * Blank fields are unused slots. A value that normalizes to nothing, a
 * repeated spelling on the same team, the team's own canonical name, or
 * another team's name or spelling is rejected with a sentence the form can show.
 * The key is the same `teamKey` the parser uses.
 */
export function validateTeamAliasDrafts(
  drafts: readonly TeamAliasDraft[],
  known: readonly KnownTeamSpellings[],
): { ok: true; teams: ValidatedTeamAliases[] } | { ok: false; message: string } {
  const state = new Map<string, { name: string; aliases: Map<string, string> }>();

  for (const team of known) {
    const key = teamKey(team.name);
    if (!key) {
      continue;
    }
    const aliases = new Map<string, string>();
    for (const alias of team.aliases) {
      const aliasKey = teamKey(alias);
      if (aliasKey) {
        aliases.set(aliasKey, alias);
      }
    }
    const current = state.get(key);
    if (!current) {
      state.set(key, { name: team.name, aliases });
      continue;
    }
    for (const [aliasKey, alias] of aliases) {
      current.aliases.set(aliasKey, alias);
    }
  }

  const validated: ValidatedTeamAliases[] = [];
  for (const draft of drafts) {
    const key = teamKey(draft.name);
    if (!key) {
      return { ok: false, message: "A team name is empty after normalization." };
    }
    const ownAliases = new Map<string, string>();
    const saved: ValidatedTeamAliases["aliases"] = [];
    draft.aliases.forEach((alias, index) => {
      const trimmed = alias.trim();
      if (!trimmed) {
        return;
      }
      const aliasKey = teamKey(trimmed);
      if (!aliasKey) {
        saved.push({ slot: -1, alias: trimmed, normalized: "" });
        return;
      }
      if (ownAliases.has(aliasKey)) {
        return;
      }
      ownAliases.set(aliasKey, trimmed);
      saved.push({ slot: index + 1, alias: trimmed, normalized: aliasKey });
    });
    const empty = saved.find((alias) => alias.normalized === "");
    if (empty) {
      return { ok: false, message: `"${empty.alias}" is empty after normalization.` };
    }
    const duplicateSlot = draft.aliases
      .map((alias) => teamKey(alias))
      .filter((aliasKey) => aliasKey.length > 0);
    if (new Set(duplicateSlot).size !== duplicateSlot.length) {
      return { ok: false, message: `The same spelling is entered twice for ${draft.name}.` };
    }
    state.set(key, { name: draft.name, aliases: ownAliases });
    validated.push({
      name: draft.name,
      normalizedName: key,
      aliases: saved.map((alias, index) => ({ ...alias, slot: index + 1 })),
    });
  }

  for (const team of validated) {
    for (const alias of team.aliases) {
      if (alias.normalized === team.normalizedName) {
        return { ok: false, message: `"${alias.alias}" is already the name of ${team.name}.` };
      }
      for (const [otherKey, other] of state) {
        if (otherKey === team.normalizedName) {
          continue;
        }
        if (otherKey === alias.normalized || other.aliases.has(alias.normalized)) {
          return {
            ok: false,
            message: `"${alias.alias}" is already a name or spelling of ${other.name}.`,
          };
        }
      }
    }
  }

  return { ok: true, teams: validated };
}
