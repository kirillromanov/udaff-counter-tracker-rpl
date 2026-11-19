# Testing

`npm test` runs Vitest. The suite does not need the live database. `src/tests/rounds/production-activation.test.ts` creates a temporary database with `prisma db push --skip-generate` and never uses `prisma/dev.db`.

`npm run lint` is ESLint. `npx tsc --noEmit` is the typecheck; `package.json` has no `typecheck` script.

`npm run build` is a production Next.js build. It rewrites `.next/`. Do not run it in the checkout that `next start` is serving. A clean check belongs in a temporary copy with its own `DATABASE_URL`.

## Rules locked by tests

| Rule | Test |
| --- | --- |
| Categories, both-threshold bonuses, Match of the Round, the four confirmed examples | `src/tests/scoring/score-match.test.ts` |
| Round total-goals bonus and a missing match blocking it | `src/tests/scoring/score-round.test.ts` |
| Full-roster miss of -1 and Match of the Round miss of -2 | `src/tests/scoring/missing-roster.test.ts` |
| Baseline is not added twice for archived rounds | `src/tests/standings/round-role.test.ts`, `src/tests/scoring/production-standings.test.ts` |
| Article schedule, fallback, no partial write, closed guard, refresh order | `src/tests/forum/schedule-source.test.ts` |
| Empty review until fixtures exist | `src/tests/import/draft-review-fixtures.test.ts` |
| Close, reopen, unsaved-edit guard, preparing rounds skipped by due jobs | `src/tests/rounds/round-lock.test.ts` |
| Start on an isolated database, idempotent second start, reopen keeps activation | `src/tests/rounds/production-activation.test.ts` |
| Opening post stops at the first comment; eight-fixture parse | `src/tests/import/batch-import.test.ts` |
| Moscow kickoff conversion | `src/tests/time/moscow.test.ts` |
| Disabled worker, dry-run, due rules, claims, and no automatic scoring | `src/tests/worker/worker.test.ts` |

A passing test run does not prove the live SQLite file is unchanged. Compare a read-only `PRAGMA integrity_check` and row counts before and after any command that might write, and do not run import, poll, refresh, seed, or recalculate scripts as part of a documentation or test pass.
