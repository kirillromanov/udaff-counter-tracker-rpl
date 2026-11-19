# Current handoff

## Revision

- Date: 2026-11-19
- Branch: `cursor/participant-identity-8862`
- Remote: `https://github.com/kirillromanov/udaff-counter-tracker-rpl`
- Parent already on that remote: `0aed0b5d1e59b957ce7f2cbf5d59b70b35804ebb`
- This handoff is the documentation commit on top of that parent. The published SHA is the commit that adds `docs/handoff/CURRENT.md`. Confirm it with `git rev-parse HEAD` after fetch. It is not on `origin/main`.

## What the project does

Local admin for a football prediction contest: forum import, fixture bootstrap, prediction review, result checks, scoring, season totals, export, and a close/reopen lock. There is no login and no in-process poller.

## Read first

1. `AGENTS.md`
2. This file
3. `docs/INDEX.md`
4. `docs/KNOWN-ISSUES.md`
5. The subsystem page named by the task, then the modules and tests it cites

## Implemented in the parent commit

Verified by reading the modules and their tests, and by the check run recorded below:

- Article-first fixture extraction with first-comment fallback, no silent merge, and no replacement of existing fixtures. `src/lib/domain/forum/schedule-source.ts`, `src/lib/domain/import/ensure-fixtures.ts`, `src/tests/forum/schedule-source.test.ts`.
- Explicit `productionStartedAt`. New operational rounds start null. Start, close, and reopen do not fetch or calculate. `src/lib/domain/rounds/round-lock.ts`, `src/tests/rounds/production-activation.test.ts`, `src/tests/rounds/round-lock.test.ts`.
- Closed lock and Re-open production. Closed rounds stay in season totals. `src/lib/domain/rounds/round-lock-db.ts`.
- Scoring thresholds and the Match of the Round multiplier. `src/tests/scoring/score-match.test.ts`.
- Manual checkpoint separate from calculated snapshots. `src/lib/domain/scoring/production-standings.ts`.

The round-15 fixture recovery is a past data repair, not a feature flag. This handoff does not re-run it. A read-only query at documentation time showed round 15 as operational, not closed, started, status `open`, 8 matches, 9 prediction sets, 58 predictions, and 0 stored score rows. This documentation task did not write those rows. Do not replace them from an older note that cited different set counts.

Rounds 1–13 were archived, scored, not started, and not closed, with 8 matches and 25 score rows each. Round 14 was operational, scored, started, and closed, with 8 matches, 27 sets, and 25 score rows. Two manual checkpoints exist, after rounds 11 and 13, 25 rows each. Loaders use the later one.

## Checks for this documentation commit

Run on 2026-11-19. The serving checkout was not seeded, imported, polled, refreshed, recalculated, or rebuilt. `npm run build` was not run in that checkout because the running server uses `.next`.

- `npm test`: 47 files, 316 tests passed.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- Relative links in `README.md`, `docs/`, and `.cursor/` resolved.
- Rule and skill frontmatter matched the expected `name`, `description`, and `alwaysApply` fields.

A separate temporary copy used `npm ci` from `package-lock.json`, `prisma generate`, and `prisma db push` against a disposable SQLite file. It had no `.env` and no live `prisma/dev.db`. `npm test` there also passed 316 tests. The first `npm run build` exited 1 with Next.js `SecurityFatalError`. The retry exited 0 and printed that compilation continued after the upgrade reminder. The Next.js version did not change. `npm ci` also reported 11 audit findings (8 moderate, 3 high). None were patched.

The live round counts above were read again after the checkout tests and were unchanged. No migration and no service restart were part of writing docs.

## Open

- Next.js 16.4.2 security advisory. A build retry is not a fix.
- No authentication, no TLS, `next start` on all interfaces.
- No timer for due polls.
- `origin/main` has diverged. Do not merge or force-push it from this work.
- Server deployment is not designed beyond [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Do not do next

- Do not seed, re-import, poll, refresh, or recalculate the live season to "confirm" these docs.
- Do not close, reopen, or start a real round.
- Do not upgrade Next.js unless that upgrade was requested.
- Do not commit `.env`, `prisma/dev.db`, or backups.

## Invariants and their tests

See [../TESTING.md](../TESTING.md). The ones that must not move casually are the four scoring examples, the -1 / -2 missing penalties, baseline exclusion, the closed-round guard, and article-versus-comment fixture choice.

## Publication

The parent feature commit was already on `origin/cursor/participant-identity-8862`. This documentation commit is published only after a normal push of that same branch and a fetch that shows the same SHA. `main` is not updated by that push.
