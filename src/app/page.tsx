import Link from "next/link";
import { buttonClass } from "./admin/ui";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-20">
      <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase">Local tool</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">Football prediction contest</h1>
      <p className="mt-3 text-zinc-600">Local admin for a forum-based football prediction contest.</p>
      <Link className={`${buttonClass("primary")} mt-6`} href="/admin">
        Open admin
      </Link>
    </main>
  );
}
