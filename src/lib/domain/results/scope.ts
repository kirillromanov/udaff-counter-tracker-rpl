import { prisma } from "@/lib/db/prisma";
import { ResultScopeError, resultVerificationApplies } from "./eligibility";

/** Refuse the new result workflow before a fetch or a stored-result write. */
export async function assertResultVerificationRound(roundId: string): Promise<void> {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    select: { number: true, season: { select: { slug: true } } },
  });
  if (!round || !resultVerificationApplies({ seasonSlug: round.season.slug, number: round.number })) {
    throw new ResultScopeError();
  }
}
