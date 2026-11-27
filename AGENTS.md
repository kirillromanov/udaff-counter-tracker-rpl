# Agent instructions

Read these before changing the application:

1. This file.
2. [docs/handoff/CURRENT.md](docs/handoff/CURRENT.md)
3. [docs/INDEX.md](docs/INDEX.md)
4. [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)
5. The subsystem document for the work, then the modules and tests it names.

Inspect the checkout, branch, and database before acting. Do not treat an earlier chat summary as the current database or as proof that a feature exists.

## Safety invariants

- Do not recalculate stored scores, re-import production comments, replace saved fixtures, or change predictions, results, the manual baseline, or awards unless the operator asked for that exact write.
- Do not close, reopen, start, or deactivate a real round as part of testing or documentation.
- Do not run `npm run db:seed`, `prisma db push --force-reset`, or `--accept-data-loss` against the live database.
- Do not upgrade dependencies unless the operator asked for that upgrade.
- Closed rounds reject mutations in server code before parsing or fixture creation. Preparation rounds stay out of automatic due jobs and out of official season totals.
- A missing saved prediction is not an unsaved edit.
- Goal-difference and total-goals bonuses each require both the prediction and the actual result to cross the configured threshold. The two numbers do not have to be equal.
- The Match of the Round multiplier is applied once to the whole fixture score.
- Do not commit `.env`, `prisma/dev.db`, backups, logs, or `.next/`.
- Do not force-push, rewrite history, or switch branches unless the operator asked.
- Do not touch the live database or the LaunchAgents unless the operator authorized that exact operation. A read-only snapshot is the default. Do not roll the database back automatically.
- Schema changes on the live file go through the existing additive script for that change, rehearsed on a copy. Do not `db push` the live file.
- Leave a pull request unmerged until the operator approves it. A documentation merge does not deploy.
- Do not print secrets, tokens, or `.env` values. Do not commit them.
- Leave `WORKER_RESULTS_ENABLED` and each round's `resultsProcessing` as [docs/handoff/CURRENT.md](docs/handoff/CURRENT.md) and [docs/RUNBOOK.md](docs/RUNBOOK.md) describe them, unless the operator asked for that change.

When behavior changes, update the relevant `docs/` page and [docs/handoff/CURRENT.md](docs/handoff/CURRENT.md) in the same change.

Authoritative code lives under `src/lib/domain/` and `prisma/schema.prisma`. Authoritative tests live under `src/tests/`. Operator entry points are `src/app/admin/` and `scripts/`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
