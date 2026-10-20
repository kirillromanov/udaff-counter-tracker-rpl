import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const instant = false;

export default async function AdminPage() {
  await connection();
  const seasons = await prisma.season.findMany({
    orderBy: { name: "asc" },
    include: { rounds: { orderBy: { number: "asc" } } },
  });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-3 text-neutral-600">
        Import a forum post, parse prediction comments, and correct them before scoring.
      </p>
      {seasons.length === 0 ? (
        <p className="mt-6">No seasons yet. Seed the database to create the demo rounds.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {seasons.map((season) => (
            <section key={season.id}>
              <h2 className="text-lg font-semibold">{season.name}</h2>
              <ul className="mt-2 space-y-2">
                {season.rounds.map((round) => (
                  <li key={round.id}>
                    <Link className="underline" href={`/admin/rounds/${round.id}`}>
                      {round.number}. {round.name ?? "Round"}
                    </Link>
                    <span className="ml-2 text-sm text-neutral-500">{round.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Link className="mt-8 inline-block underline" href="/">
        Home
      </Link>
    </main>
  );
}
