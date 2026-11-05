import { loadEnvFile } from "node:process";
import { prisma } from "@/lib/db/prisma";
import { normalizeParticipantName } from "@/lib/domain/participants/identity";
import { matchCheckpointRows, parseStandingsCheckpoint } from "@/lib/domain/standings/parse-checkpoint";
import { ROUND_13_BASELINE_LABEL, ROUND_13_CHECKPOINT } from "@/lib/domain/standings/round-13-checkpoint";
import { saveManualCheckpoint } from "@/lib/domain/standings/save-checkpoint";

try {
  loadEnvFile();
} catch {
  // The app loads .env itself. This script can also run with DATABASE_URL already set.
}

function fail(message: string): never {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

async function main() {
  const parsed = parseStandingsCheckpoint(ROUND_13_CHECKPOINT);
  if (parsed.length !== 25) {
    fail(`Expected 25 baseline rows and read ${parsed.length}. Nothing was written.`);
  }
  const vinnie = parsed.find((row) => row.displayName === "Vinnie Jones");
  if (!vinnie || vinnie.totalPoints !== 178 || vinnie.markerCount !== 1) {
    fail("Vinnie Jones must stay at 178 with one sun marker. Nothing was written.");
  }
  if (!ROUND_13_CHECKPOINT.includes("долг вернул с извинениями")) {
    fail("The Vinnie Jones note is missing from the baseline text. Nothing was written.");
  }

  const checkpoint11 = await prisma.standingsCheckpoint.findFirst({
    where: { source: "manual", afterRoundNumber: 11 },
    select: { seasonId: true },
  });
  const season = checkpoint11
    ? await prisma.season.findUnique({ where: { id: checkpoint11.seasonId } })
    : await prisma.season.findFirst();
  if (!season) {
    fail("No season was found. Nothing was written.");
  }

  const participants = await prisma.participant.findMany({ include: { aliases: true } });
  const identities = participants.flatMap((participant) => {
    const keys = [participant.normalizedName, ...participant.aliases.map((alias) => alias.normalized)].filter(
      (key): key is string => Boolean(key),
    );
    return keys.map((normalized) => ({ participantId: participant.id, normalized }));
  });
  const owners = new Map<string, Set<string>>();
  for (const identity of identities) {
    const ids = owners.get(identity.normalized) ?? new Set<string>();
    ids.add(identity.participantId);
    owners.set(identity.normalized, ids);
  }
  const problems = parsed.flatMap((row) => {
    const key = normalizeParticipantName(row.displayName);
    const ids = [...(owners.get(key) ?? [])];
    if (ids.length === 0) {
      return [`unmatched: ${row.displayName}`];
    }
    if (ids.length > 1) {
      return [`ambiguous: ${row.displayName}`];
    }
    return [];
  });
  if (problems.length > 0) {
    fail(`Baseline identity could not be resolved. Nothing was written.\n${problems.join("\n")}`);
  }

  const matched = matchCheckpointRows(parsed, identities);
  const ids = matched.map((row) => row.participantId);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    fail("Baseline rows do not map to 25 distinct participants. Nothing was written.");
  }

  const saved = await saveManualCheckpoint({
    seasonId: season.id,
    afterRoundNumber: 13,
    label: ROUND_13_BASELINE_LABEL,
    rawText: ROUND_13_CHECKPOINT,
  });
  if (saved.unmatched.length > 0) {
    fail(`Baseline write left unmatched names: ${saved.unmatched.join(", ")}`);
  }

  const [latest, previous, rows, round12, manualCount] = await Promise.all([
    prisma.standingsCheckpoint.findFirst({
      where: { seasonId: season.id, source: "manual" },
      orderBy: { afterRoundNumber: "desc" },
      include: { rows: { orderBy: { rank: "asc" } } },
    }),
    prisma.standingsCheckpoint.findFirst({
      where: { seasonId: season.id, source: "manual", afterRoundNumber: 11 },
      select: { id: true },
    }),
    prisma.standingsCheckpoint.findFirst({
      where: { seasonId: season.id, source: "manual", afterRoundNumber: 13 },
      include: { rows: { orderBy: { rank: "asc" } } },
    }),
    prisma.round.findFirst({ where: { seasonId: season.id, number: 12 }, select: { standingRole: true } }),
    prisma.standingsCheckpoint.count({ where: { seasonId: season.id, source: "manual" } }),
  ]);

  if (!latest || latest.afterRoundNumber !== 13 || !latest.rawText.includes("долг вернул с извинениями")) {
    fail("The active manual baseline is not the round 13 checkpoint.");
  }
  if (!previous) {
    fail("The round 11 checkpoint was not retained.");
  }
  if (!rows || rows.rows.length !== 25) {
    fail("The round 13 checkpoint does not have 25 rows.");
  }
  const storedVinnie = rows.rows.find((row) => row.displayName === "Vinnie Jones");
  if (!storedVinnie || storedVinnie.totalPoints !== 178) {
    fail("Stored Vinnie Jones total is not 178.");
  }
  const ties = rows.rows.filter((row) => row.totalPoints === 224 || row.totalPoints === 203 || row.totalPoints === 144);
  const tieOrder = ties.map((row) => `${row.rank}:${row.displayName}:${row.totalPoints}`).join(", ");
  const expectedTies = "7:Doctor Livesey:224, 8:Мычман:224, 11:Chiger:203, 12:Schmelzer:203, 13:Йош!:203, 21:Ли Харви Освальд:144, 22:Лысая_ Башка:144";
  if (tieOrder !== expectedTies) {
    fail(`Equal-point order was not preserved: ${tieOrder}`);
  }
  if (round12 && round12.standingRole !== "archived") {
    fail("Round 12 is still operational after the round 13 baseline.");
  }
  if (manualCount < 2) {
    fail("The previous baseline was not retained.");
  }

  console.log(`Installed baseline after round 13 for ${season.name}.`);
  console.log(`Active checkpoint: round ${latest.afterRoundNumber}, ${rows.rows.length} rows, Hordi ${rows.rows[0]?.totalPoints}, Vinnie ${storedVinnie.totalPoints}.`);
  console.log(`Round 11 checkpoint retained. Manual checkpoints: ${manualCount}.`);
  console.log(round12 ? "Round 12 is archived and is not added on top of this baseline." : "No round 12 row exists. A later round 13 row will be archived by the cutoff.");
}

main()
  .catch((error: unknown) => {
    if (!process.exitCode) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
