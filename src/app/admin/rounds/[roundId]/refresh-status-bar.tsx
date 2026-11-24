"use client";

import { useState, type ReactNode } from "react";
import { cx } from "../../ui";

/** Opens stored refresh diagnostics. The click does not request sources. */
export function RefreshStatusBar({
  summary,
  tone,
  action,
  children,
}: {
  summary: string;
  tone: "neutral" | "error" | "warning" | "info";
  action: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className={cx("min-w-0 flex-1 text-sm", tone === "error" && "text-red-700", tone === "warning" && "text-amber-800", tone === "info" && "text-sky-800")}>{summary}</p>
        <button
          aria-controls="refresh-details"
          aria-expanded={open}
          className="text-xs text-zinc-700 underline"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          Details
        </button>
        {action}
      </div>
      {open ? <div className="mt-2 space-y-1 border-t border-zinc-200 pt-2 text-xs text-zinc-600" id="refresh-details">{children}</div> : null}
    </div>
  );
}
