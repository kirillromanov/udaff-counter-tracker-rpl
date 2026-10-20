import Link from "next/link";
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 h-14 border-b border-zinc-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
          <Link className="text-sm font-semibold tracking-tight text-zinc-950" href="/admin">
            Contest admin
          </Link>
          <span className="text-xs text-zinc-400">Local</span>
        </div>
      </header>
      {children}
    </div>
  );
}
