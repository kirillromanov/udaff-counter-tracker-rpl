import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSeasonAction } from "./actions";

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

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Seasons</h1>
      <p className="mt-3 text-neutral-600">
        Open a season to manage rounds, standings, and forum exports.
      </p>
      {query.error ? <p className="mt-4 border border-red-300 bg-red-50 p-3">{query.error}</p> : null}
      {seasons.length === 0 ? (
        <p className="mt-6">No seasons yet. Create one below, or seed the demo contest.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {seasons.map((season) => (
            <li className="border p-4" key={season.id}>
              <Link className="text-lg underline" href={`/admin/seasons/${season.id}`}>
                {season.name}
              </Link>
              <p className="mt-1 text-sm text-neutral-600">
                {season._count.rounds} rounds, {season._count.participants} participants
              </p>
            </li>
          ))}
        </ul>
      )}
      <section className="mt-8 border p-4">
        <h2 className="font-semibold">Create a season</h2>
        <form action={createSeasonAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input className="border px-2 py-1" name="name" placeholder="Season name" />
          <input className="border px-2 py-1" name="slug" placeholder="slug (optional)" />
          <button className="border px-3 py-1" type="submit">
            Create
          </button>
        </form>
      </section>
      <Link className="mt-8 inline-block underline" href="/">
        Home
      </Link>
    </main>
  );
}
