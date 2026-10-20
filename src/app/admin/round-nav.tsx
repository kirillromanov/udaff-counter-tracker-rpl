"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function RoundNav({ roundId, seasonId }: { roundId: string; seasonId: string }) {
  const pathname = usePathname();
  const items = [
    { href: `/admin/rounds/${roundId}`, label: "Overview", exact: true },
    { href: `/admin/rounds/${roundId}/review`, label: "Import & review" },
    { href: `/admin/rounds/${roundId}/fixtures`, label: "Fixtures" },
    { href: `/admin/rounds/${roundId}/results`, label: "Round results" },
    { href: `/admin/rounds/${roundId}/export`, label: "Export" },
    { href: `/admin/seasons/${seasonId}/standings`, label: "Season standings" },
  ];

  return (
    <nav className="flex flex-wrap gap-1">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href;
        return (
          <Link
            className={cx(
              "rounded-md px-2.5 py-1 text-sm",
              active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-white hover:text-zinc-900",
            )}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
