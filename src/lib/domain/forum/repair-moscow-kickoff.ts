import { normalizeTeamName } from "@/lib/domain/parser/normalize";
import { correctedMoscowKickoff } from "@/lib/domain/time/moscow";
import { parseFixtureSchedule } from "./parse-schedule";

export interface StoredKickoff {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date | null;
}

export interface KickoffRepairPlan {
  updates: { id: string; from: Date | null; to: Date }[];
  alreadyCorrect: number;
  preserved: { id: string; reason: string }[];
}

function pairKey(home: string, away: string): string {
  return `${normalizeTeamName(home)}|${normalizeTeamName(away)}`;
}

/**
 * Plan kickoff corrections from the stored opening post.
 * A row changes only when its stored instant is exactly the Moscow clock
 * previously saved as UTC. Repeating the plan after those writes finds nothing.
 */
export function planMoscowKickoffRepair(stored: readonly StoredKickoff[], sourceText: string): KickoffRepairPlan {
  const schedule = parseFixtureSchedule(sourceText);
  const used = new Set<number>();
  const updates: KickoffRepairPlan["updates"] = [];
  const preserved: KickoffRepairPlan["preserved"] = [];
  let alreadyCorrect = 0;

  for (const match of stored) {
    const key = pairKey(match.homeTeam, match.awayTeam);
    const index = schedule.fixtures.findIndex((fixture, position) => !used.has(position) && pairKey(fixture.homeTeam, fixture.awayTeam) === key);
    const source = index >= 0 ? schedule.fixtures[index] : undefined;
    if (!source?.kickoffAt) {
      preserved.push({ id: match.id, reason: "The opening post has no matching fixture clock." });
      continue;
    }
    used.add(index);
    const next = correctedMoscowKickoff(match.kickoffAt, source.kickoffAt);
    if (next == null) {
      if (match.kickoffAt?.getTime() === source.kickoffAt.getTime()) {
        alreadyCorrect += 1;
      } else {
        preserved.push({ id: match.id, reason: "The stored instant is neither Moscow time nor the old UTC misread." });
      }
      continue;
    }
    updates.push({ id: match.id, from: match.kickoffAt, to: next });
  }

  return { updates, alreadyCorrect, preserved };
}
