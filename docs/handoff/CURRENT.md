# Current handoff

## Revision

- Date: 2026-11-19
- Remote: `https://github.com/kirillromanov/udaff-counter-tracker-rpl`
- Default branch: `main`
- Integration: pull request #12, merge commit `4bdf8a1512b77b8442a9198a9b34006e6d27e266`
- At that merge, `main` and `cursor/participant-identity-8862` (`48402f69d389057b6eb0ff701b2ea7233f5c213f`) had the same source tree
- The serving checkout stayed on `cursor/participant-identity-8862` at the integration note. This note does not name its own later commit
- Local service parent: `1df09addd8d3f1c9323f4c914d6655dfb43646d6`

## What the project does

Local admin for a football prediction contest: forum import, fixture bootstrap, prediction review, result checks, scoring, season totals, export, and a close/reopen lock. There is no login and no in-process poller.

## Read first

1. `AGENTS.md`
2. This file
3. `docs/INDEX.md`
4. `docs/KNOWN-ISSUES.md`
5. The subsystem page named by the task, then the modules and tests it cites

## Implemented at the integration commit

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

## Checks for this integration note

Run on 2026-11-19 in a separate worktree of `4bdf8a1512b77b8442a9198a9b34006e6d27e266`. The serving checkout was not switched. `npm run build` was not run. No seed, import, poll, refresh, recalculation, or round transition.

- Relative links in `README.md`, `docs/`, and `.cursor/` resolved.
- `npm test`: 47 files, 316 tests passed.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm ci` again reported 11 audit findings (8 moderate, 3 high). None were patched.

## Checks for the loopback command

Run on 2026-11-19 in a worktree of `1df09addd8d3f1c9323f4c914d6655dfb43646d6`, with a disposable `DATABASE_URL` and no live database. `npm run build` was not run. The serving checkout was not updated by these checks.

- `npm test`: 48 files, 318 tests passed, including `src/tests/ops/local-service-bind.test.ts`.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm ci` reported the same 11 audit findings. None were patched.

## Next.js 16.4.5

`next` and `eslint-config-next` are pinned at 16.4.5. React stays 19.3.0. Node 24.19.0 meets Next's `>=20.9.0` engine. The first `next build` in an isolated worktree of this change exited 0 and printed Next.js 16.4.5. It did not stop with `SecurityFatalError`. `npm test` passed 318 tests, and lint and `tsc --noEmit` passed. The isolated server on `127.0.0.1:3010` answered `/`, `/admin`, and `/admin/participants` with 200. It used a disposable SQLite file, not `prisma/dev.db`.

`npm audit` went from 11 findings (8 moderate, 3 high) to 10 (7 moderate, 3 high). The `next` finding is gone. The ten remaining entries are two vulnerabilities, assessed in [../SECURITY.md](../SECURITY.md). They were not upgraded.

The serving checkout was then fast-forwarded to the merge of this change, rebuilt while the agent was stopped, and started again through the same LaunchAgent. The running process is `next-server` 16.4.5, build `IBgEizLdzmK0LBx66x82Q`, listening on `127.0.0.1:3000`.

## Local bind

`scripts/dev-up.sh --service` starts `npm run start -- --hostname 127.0.0.1 --port 3000`. `package.json` `start` stays `next start`, so a future host is not given this hostname. The check is `src/tests/ops/local-service-bind.test.ts`. Restart the existing LaunchAgent only after this command is the one in the serving checkout, and only when port 3000 is free. If that start fails, leave the agent stopped instead of returning to `npm run start -- --port 3000`.

## Checks for the worker

Run on 2026-11-20 in a worktree of `4daa59d5abe0d738b2975b48ae2f9a32eede6ee5`. The serving checkout was not switched, installed, or rebuilt. No seed, import, poll, refresh, recalculation, or round transition was run against `prisma/dev.db`.

- `npm test`: 49 files, 332 tests passed, including `src/tests/worker/worker.test.ts`.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed in that worktree and printed Next.js 16.4.5. It did not use the serving checkout's `.next`.
- `npm run worker:plan` was then run with the live database opened read-only. `PRAGMA data_version` stayed 2. No claim file was created. Rounds 1–13 were archived, round 14 was closed, and round 15 was not due. The worker LaunchAgent was not installed.

## Background worker

A separate process, `scripts/worker.ts`, plans both existing due jobs and runs prediction refresh only. `WORKER_ENABLED` defaults off. The supervised loop also requires `WORKER_SCAN_MINUTES`; the proposed value is 60 and is not compiled in as a default. Result checks stay unrun because `pollDueRounds` calls `recalculateRound`. The web LaunchAgent does not install or start the worker. Commands, claims, and the enable step are in [../OPERATIONS.md](../OPERATIONS.md). This handoff does not enable the worker or change the running server.

## Open

- Two audit groups remain after Next.js 16.4.5. They were not upgraded with the worker. See [../SECURITY.md](../SECURITY.md).
- The running process was rebuilt on 16.4.5 before this worker. Confirm a later checkout before assuming that build includes the worker.
- No authentication and no TLS. The web command remains `npm run start -- --hostname 127.0.0.1 --port 3000`.
- The worker is not enabled. Background result checks still need a decision because they would store scores. Do not start the worker agent until that is accepted or the result half stays skipped.
- The running checkout can lag `main` until an explicit update. Merging source does not restart it.
- Server deployment is not designed beyond [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Do not do next

- Do not seed, re-import, poll, refresh, or recalculate the live season to "confirm" these docs.
- Do not close, reopen, or start a real round.
- Do not upgrade Next.js or Prisma unless that upgrade was requested.
- Do not install, load, or start `com.udaff.counter-tracker.worker`.
- Do not set `WORKER_ENABLED=1` on the live database until the operator asks.
- Do not commit `.env`, `prisma/dev.db`, or backups.

## Invariants and their tests

See [../TESTING.md](../TESTING.md). The ones that must not move casually are the four scoring examples, the -1 / -2 missing penalties, baseline exclusion, the closed-round guard, and article-versus-comment fixture choice.

## Publication

Pull request #12 merged the verified application and documentation into `main` at `4bdf8a1512b77b8442a9198a9b34006e6d27e266`. That is the integration commit. The feature branch remains at `48402f69d389057b6eb0ff701b2ea7233f5c213f` and is not the starting point for the next task.

## Workflow

1. Start a new branch from current `origin/main`.
2. Test, update `docs/` and this handoff, review the diff, commit, and push that branch.
3. Integrate through a pull request into `main`.
4. Treat updating the running application as a separate explicit operation. A merge does not restart the server, rebuild `.next`, or replace `prisma/dev.db`.

Details are in [../OPERATIONS.md](../OPERATIONS.md).
