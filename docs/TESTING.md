# Testing

`npm test` runs Vitest. The suite does not need the live database. `src/tests/rounds/production-activation.test.ts` creates a temporary database with `prisma db push --skip-generate` and never uses `prisma/dev.db`. `src/tests/import/refresh-idempotency-snapshot.test.ts` stays skipped unless `PREDICTION_IDEMPOTENCY_SNAPSHOT` names a private database copy. That test copies the file again and does not open the live database. `src/tests/db/result-verification-migration.test.ts` always refuses a relative, missing, empty, or unexpected database. Its copy of a private backup runs only when `RESULT_SCHEMA_BACKUP` is an absolute path; the test copies that file and does not open the live database. `src/tests/db/results-processing-migration.test.ts` refuses the same kinds of path. The apply rehearsal uses a private snapshot copy and is not part of `npm test`.

`npm run lint` is ESLint. `npx tsc --noEmit` is the typecheck; `package.json` has no `typecheck` script. This repository has no `.github` workflow directory, so those checks are local.

`npm run build` is a production Next.js build. It rewrites `.next/`. Do not run it in the checkout that `next start` is serving. A clean check belongs in a temporary copy with its own `DATABASE_URL`.

Parser review counter clicks are same-page links. Their scroll behavior is checked in a browser on an isolated server. A unit test of the link property does not show whether the page moved.

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
| Disabled worker, 60-second recheck, one overdue fetch, claims, logs, LaunchAgent, and no automatic scoring | `src/tests/worker/worker.test.ts` |
| Repeated prediction refresh keeps equivalent prediction ids | `src/tests/import/refresh-idempotency.test.ts` |
| Additive result schema, absolute path, and no Match rebuild | `src/tests/db/result-verification-migration.test.ts` |
| Team spellings, the Latin `x` club, and the Teams table | `src/tests/parser/header-and-team-aliases.test.ts`, `src/tests/teams/club-catalog.test.tsx` |
| Spelling fields reset when the club key changes, and a save writes only that club | `src/tests/teams/spellings-form-client.test.tsx`, `src/tests/teams/spellings-save-action.test.ts` |
| Result switch, worker skip reasons, and the start-production audit | `src/tests/worker/worker.test.ts`, `src/tests/rounds/production-activation.test.ts` |
| Team-key and saved-spelling result matching, with no guessed ambiguity | `src/tests/results/name-match.test.ts` |
| Observe-only result command writes nothing | `src/tests/results/observe-round.test.ts` |
| Additive result-processing column, absolute path, default false | `src/tests/db/results-processing-migration.test.ts` |

A passing test run does not prove the live SQLite file is unchanged. Compare a read-only `PRAGMA integrity_check` and row counts before and after any command that might write, and do not run import, poll, refresh, seed, or recalculate scripts as part of a documentation or test pass.
