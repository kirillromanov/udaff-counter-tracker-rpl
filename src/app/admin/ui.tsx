import Link from "next/link";
import type { ReactNode } from "react";
import { formatMovement, medalSymbols } from "@/lib/domain/standings/format-movement";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function buttonClass(variant: "primary" | "secondary" | "ghost" = "secondary"): string {
  const base =
    "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-wait disabled:opacity-60";
  if (variant === "primary") {
    return cx(base, "bg-zinc-900 text-white hover:bg-zinc-800");
  }
  if (variant === "ghost") {
    return cx(base, "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900");
  }
  return cx(base, "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50");
}

export const fieldClass =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500";

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">{children}</div>;
}

export function PageHeader({
  crumbs,
  title,
  description,
  badges,
  nav,
}: {
  crumbs?: ReactNode;
  title: string;
  description?: string;
  badges?: ReactNode;
  nav?: ReactNode;
}) {
  return (
    <div className="sticky top-14 z-30 border-b border-zinc-200/80 bg-zinc-100/90 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6 py-4">
        {crumbs ? <div className="mb-1 flex flex-wrap items-center gap-1 text-sm text-zinc-500">{crumbs}</div> : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">{title}</h1>
          {badges}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm text-zinc-500">{description}</p> : null}
        {nav ? <div className="mt-3">{nav}</div> : null}
      </div>
    </div>
  );
}

export function CrumbLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="hover:text-zinc-900" href={href}>
      {children}
    </Link>
  );
}

export function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm shadow-zinc-200/50" id={id}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-950">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-sm text-zinc-500">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function KpiGrid({
  items,
}: {
  items: { label: string; value: string | number; hint?: string; tone?: "default" | "warning" | "danger" }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm shadow-zinc-200/40" key={item.label}>
          <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{item.label}</dt>
          <dd
            className={cx(
              "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
              item.tone === "danger" && "text-rose-700",
              item.tone === "warning" && "text-amber-800",
            )}
          >
            {item.value}
          </dd>
          {item.hint ? <p className="mt-1 text-xs text-zinc-500">{item.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}

const badgeTones = {
  neutral: "bg-zinc-100 text-zinc-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-950",
  danger: "bg-rose-100 text-rose-800",
  info: "bg-sky-100 text-sky-800",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
}) {
  return (
    <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium", badgeTones[tone])}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "scored" ? "success" : status === "open" ? "info" : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}

const noticeTones = {
  error: "border-rose-200 bg-rose-50 text-rose-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  info: "border-zinc-200 bg-white text-zinc-700",
};

const noticeLabels = {
  error: "Error",
  success: "Success",
  warning: "Needs attention",
  info: "Note",
};

export function Notice({
  tone,
  label,
  children,
}: {
  tone: keyof typeof noticeTones;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("rounded-lg border px-4 py-3 text-sm", noticeTones[tone])} role={tone === "error" ? "alert" : "status"}>
      <p className="text-xs font-semibold tracking-wide uppercase">{label ?? noticeLabels[tone]}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function LayerStrip({
  items,
}: {
  items: { href: string; label: string; detail: string; current?: boolean }[];
}) {
  return (
    <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Link
          className={cx(
            "rounded-lg border px-3 py-2",
            item.current ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400",
          )}
          href={item.href}
          key={item.href}
          prefetch={false}
        >
          <span className="block text-sm font-medium">{item.label}</span>
          <span className={cx("mt-0.5 block text-xs", item.current ? "text-zinc-300" : "text-zinc-500")}>{item.detail}</span>
        </Link>
      ))}
    </nav>
  );
}

export function FilterLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      className={cx(
        "rounded-md px-2.5 py-1 text-xs font-medium",
        current ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50",
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center">
      <p className="text-sm font-medium text-zinc-800">{title}</p>
      {detail ? <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{detail}</p> : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-zinc-500">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th className={cx("px-3 py-2 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase", className)}>
      {children}
    </th>
  );
}

export function movementRowClass(movement: string, rank: number, previousRank: number | null): string {
  const shown = formatMovement(movement, rank, previousRank);
  if (shown === "new") {
    return "bg-sky-50/80";
  }
  if (shown.startsWith("▲")) {
    return "bg-emerald-50/80";
  }
  if (shown.startsWith("▼")) {
    return "bg-rose-50/70";
  }
  return "";
}

export function MovementCell({
  movement,
  rank,
  previousRank,
}: {
  movement: string;
  rank: number;
  previousRank: number | null;
}) {
  const shown = formatMovement(movement, rank, previousRank);
  const tone = shown === "new" ? "info" : shown.startsWith("▲") ? "success" : shown.startsWith("▼") ? "danger" : "neutral";
  return <Badge tone={tone}>{shown}</Badge>;
}

export interface StandingRow {
  id: string;
  rank: number;
  previousRank: number | null;
  movement: string;
  totalPoints: number;
  roundWins: number;
  participant: { name: string };
}

export function StandingsTable({ rows }: { rows: StandingRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="No standings yet" detail="Calculate a round to build the cumulative table." />;
  }
  return (
    <DataTable>
      <thead>
        <tr className="border-b border-zinc-200">
          <Th>Rank</Th>
          <Th>Move</Th>
          <Th>Participant</Th>
          <Th>Medals</Th>
          <Th className="text-right">Points</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            className={cx("border-b border-zinc-100 last:border-0", movementRowClass(row.movement, row.rank, row.previousRank))}
            key={row.id}
          >
            <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.rank}</td>
            <td className="px-3 py-2.5">
              <MovementCell movement={row.movement} previousRank={row.previousRank} rank={row.rank} />
            </td>
            <td className="px-3 py-2.5 font-medium text-zinc-900">{row.participant.name}</td>
            <td className="px-3 py-2.5 text-zinc-600">
              {row.roundWins} {medalSymbols(row.roundWins)}
            </td>
            <td className="px-3 py-2.5 text-right font-medium tabular-nums">{row.totalPoints}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

export interface RoundScoreRow {
  id: string;
  totalPoints: number;
  matchPoints: number;
  roundBonusPoints: number;
  isRoundWinner: boolean;
  participant: { name: string };
}

export function RoundScoreTable({ rows }: { rows: RoundScoreRow[] }) {
  return (
    <DataTable>
      <thead>
        <tr className="border-b border-zinc-200">
          <Th>Rank</Th>
          <Th>Participant</Th>
          <Th className="text-right">Points</Th>
          <Th className="text-right">Match + bonus</Th>
          <Th>Medal</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((score, index) => (
          <tr className={cx("border-b border-zinc-100 last:border-0", score.isRoundWinner && "bg-amber-50/80")} key={score.id}>
            <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{index + 1}</td>
            <td className="px-3 py-2.5 font-medium">{score.participant.name}</td>
            <td className="px-3 py-2.5 text-right font-medium tabular-nums">{score.totalPoints}</td>
            <td className="px-3 py-2.5 text-right text-zinc-600 tabular-nums">
              {score.matchPoints}+ {score.roundBonusPoints}
            </td>
            <td className="px-3 py-2.5">{score.isRoundWinner ? <Badge tone="warning">☼ winner</Badge> : null}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
