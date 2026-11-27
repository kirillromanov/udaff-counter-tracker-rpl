import Link from "next/link";
import type { ClubRow } from "@/lib/domain/teams/club-catalog";

export function ClubTable({ clubs }: { clubs: readonly ClubRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead>
          <tr className="text-xs text-zinc-500">
            <th className="py-1 pr-3 font-medium">Club</th>
            <th className="py-1 pr-3 font-medium">Key</th>
            <th className="py-1 pr-3 font-medium">Fixtures</th>
            <th className="py-1 pr-3 font-medium">Rounds</th>
            <th className="py-1 font-medium">
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((club) => (
            <tr className="border-t border-zinc-100 align-top" key={`${club.key}\u0000${club.name}`}>
              <td className="py-2 pr-3">
                <div className="font-medium text-zinc-950">{club.name}</div>
                {club.warnings.map((warning) => (
                  <p className="mt-1 max-w-sm text-xs text-amber-800" key={warning}>
                    {warning}
                  </p>
                ))}
              </td>
              <td className="py-2 pr-3 font-mono text-xs text-zinc-600">{club.key}</td>
              <td className="py-2 pr-3 tabular-nums">{club.fixtureCount}</td>
              <td className="py-2 pr-3 text-zinc-600">{club.rounds.join(", ")}</td>
              <td className="py-2 text-right">
                <Link className="text-zinc-950 underline" href={`/admin/teams/spellings?key=${encodeURIComponent(club.key)}`}>
                  Spellings
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
