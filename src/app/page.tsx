import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Football prediction contest</h1>
      <p className="mt-3 text-neutral-600">
        Local admin for a forum-based football prediction contest.
      </p>
      <Link className="mt-6 inline-block underline" href="/admin">
        Admin
      </Link>
    </main>
  );
}
