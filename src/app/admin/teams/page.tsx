import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { buildClubCatalog } from "@/lib/domain/teams/club-catalog";
import { CrumbLink, EmptyState, PageBody, PageHeader, Section } from "../ui";
import { ClubTable } from "./club-table";

export const instant = false;

export default async function TeamsPage() {
  await connection();
  const matches = await prisma.match.findMany({
    select: {
      homeTeam: true,
      awayTeam: true,
      round: { select: { number: true } },
    },
    orderBy: [{ round: { number: "asc" } }, { sortOrder: "asc" }],
  });
  const clubs = buildClubCatalog(
    matches.flatMap((match) => [
      { name: match.homeTeam, roundNumber: match.round.number },
      { name: match.awayTeam, roundNumber: match.round.number },
    ]),
  );

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <CrumbLink href="/admin">Seasons</CrumbLink>
            <span>/</span>
            <span>Teams</span>
          </>
        }
        description="Club names come from saved fixtures. Spellings are used the next time a comment is parsed."
        title="Teams"
      />
      <PageBody>
        <Section
          description="A warning marks a shared key, a Latin letter inside a Cyrillic name, or one club stored under more than one spelling."
          title="Clubs in fixtures"
        >
          {clubs.length === 0 ? (
            <EmptyState detail="Clubs appear here after a round has fixtures." title="No clubs yet" />
          ) : (
            <ClubTable clubs={clubs} />
          )}
        </Section>
      </PageBody>
    </>
  );
}
