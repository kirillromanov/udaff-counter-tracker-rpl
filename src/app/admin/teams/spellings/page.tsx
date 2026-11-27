import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { buildClubCatalog } from "@/lib/domain/teams/club-catalog";
import { SubmitButton } from "../../submit-button";
import { CrumbLink, Notice, PageBody, PageHeader, Section, fieldClass } from "../../ui";
import { saveClubSpellingsAction } from "../actions";

export const instant = false;

export default async function TeamSpellingsPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; error?: string; saved?: string }>;
}) {
  await connection();
  const query = await searchParams;
  const key = query.key ?? "";
  if (!key) {
    notFound();
  }
  const matches = await prisma.match.findMany({
    select: { homeTeam: true, awayTeam: true, round: { select: { number: true } } },
  });
  const clubs = buildClubCatalog(
    matches.flatMap((match) => [
      { name: match.homeTeam, roundNumber: match.round.number },
      { name: match.awayTeam, roundNumber: match.round.number },
    ]),
  ).filter((club) => club.key === key);
  if (clubs.length === 0) {
    notFound();
  }
  const stored = await prisma.teamName.findUnique({
    where: { normalizedName: key },
    include: { aliases: { orderBy: { slot: "asc" } } },
  });
  const canonical = stored?.name ?? clubs[0].name;
  const aliases = stored?.aliases.map((alias) => alias.alias) ?? [];
  const warnings = [...new Set(clubs.flatMap((club) => club.warnings))];

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <CrumbLink href="/admin/teams">Teams</CrumbLink>
          </>
        }
        description="Three extra spellings. Dynamo Moscow’s name Динамо cannot be saved as a spelling of another club."
        title={canonical}
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        {query.saved ? (
          <Notice tone="success">
            Team spellings saved. Stored comments were not parsed again. Use Parse predictions on each round that uses this club.
          </Notice>
        ) : null}
        {warnings.length > 0 ? (
          <Notice tone="warning">
            {warnings.map((warning) => (
              <span className="block" key={warning}>
                {warning}
              </span>
            ))}
          </Notice>
        ) : null}
        <Section
          description="Saving writes the spelling tables only. It does not parse stored comments or change predictions."
          title="Spellings"
        >
          <p className="mb-3 text-sm text-zinc-600">
            Key <span className="font-mono text-xs">{key}</span>
            {clubs.length > 1 ? `. Fixture names: ${clubs.map((club) => club.name).join(", ")}` : null}
          </p>
          <form action={saveClubSpellingsAction} className="flex flex-wrap items-end gap-2">
            <input name="name" type="hidden" value={canonical} />
            {[1, 2, 3].map((slot) => (
              <label className="text-xs font-medium text-zinc-500" key={slot}>
                Spelling {slot}
                <input
                  className={`${fieldClass} mt-1 w-full max-w-xs sm:w-44`}
                  defaultValue={aliases[slot - 1] ?? ""}
                  name={`alias_${slot}`}
                />
              </label>
            ))}
            <SubmitButton pendingLabel="Saving…" variant="primary">
              Save spellings
            </SubmitButton>
          </form>
        </Section>
      </PageBody>
    </>
  );
}
