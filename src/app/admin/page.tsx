import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSeasonAction } from "./actions";
import { SubmitButton } from "./submit-button";
import { EmptyState, Field, KpiGrid, Notice, PageBody, PageHeader, Section, buttonClass, fieldClass } from "./ui";

export const instant = false;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const query = await searchParams;
  const seasons = await prisma.season.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { rounds: true, participants: true } } },
  });
  const rounds = seasons.reduce((total, season) => total + season._count.rounds, 0);
  const participants = seasons.reduce((total, season) => total + season._count.participants, 0);

  return (
    <>
      <PageHeader
        description="Open a season for rounds and its roster, or open Participants for the registry."
        nav={
          <Link className={buttonClass("secondary")} href="/admin/participants">
            Participant registry
          </Link>
        }
        title="Seasons"
      />
      <PageBody>
        {query.error ? <Notice tone="error">{query.error}</Notice> : null}
        <KpiGrid
          items={[
            { label: "Seasons", value: seasons.length },
            { label: "Rounds", value: rounds },
            { label: "Participants", value: participants, hint: "Across every season" },
          ]}
        />
        <Section
          action={
            <form action={createSeasonAction} className="flex flex-wrap items-end gap-2">
              <Field label="Name">
                <input className={`${fieldClass} w-44`} name="name" placeholder="RPL 2026" />
              </Field>
              <Field label="Slug">
                <input className={`${fieldClass} w-36`} name="slug" placeholder="optional" />
              </Field>
              <SubmitButton pendingLabel="Creating…" variant="primary">
                Create season
              </SubmitButton>
            </form>
          }
          description="A season holds rounds, participants, and one scoring config."
          id="overview"
          title="All seasons"
        >
          {seasons.length === 0 ? (
            <EmptyState detail="Create a season here, or seed the demo contest." title="No seasons yet" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {seasons.map((season) => (
                <li className="flex flex-wrap items-baseline justify-between gap-3 py-3 first:pt-0 last:pb-0" key={season.id}>
                  <div>
                    <Link className="font-medium text-zinc-950 hover:underline" href={`/admin/seasons/${season.id}`}>
                      {season.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-zinc-500">
                      {season._count.rounds} rounds · {season._count.participants} participants
                    </p>
                  </div>
                  <Link className="text-sm text-zinc-600 hover:text-zinc-950" href={`/admin/seasons/${season.id}`}>
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageBody>
    </>
  );
}
