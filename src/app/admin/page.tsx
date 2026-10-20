import Link from "next/link";

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-3 text-neutral-600">
        The scoring domain is ready. The admin UI comes in a later phase.
      </p>
      <Link className="mt-6 inline-block underline" href="/">
        Home
      </Link>
    </main>
  );
}
