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

## Checks for the serving update

Run on 2026-11-20. The serving checkout fast-forwarded from `220ea1f1f6503610a40b32679a3f357ede513ba8` to `bff0de26756c6ba7ef56ed11c8fd04261c8cfc99`. The web LaunchAgent was stopped, the production build ran, and the same agent was started again. No schema push, seed, import, parse, poll, refresh, or recalculation ran. `package-lock.json` was unchanged, so dependencies were not reinstalled.

- The running process is `next-server` 16.4.5, build `UI3hxUAeqeBw---qenFjH`, one listener on `127.0.0.1:3000`. `http://127.0.0.1:3000/admin` and `http://localhost:3000/admin` returned 200.
- `WORKER_ENABLED`, `WORKER_RESULTS_ENABLED`, and `PREDICTION_REFRESH_INTERVAL_MINUTES` are unset. The accepted initial interval is 60 minutes and is not configured.
- `WORKER_LOCK_DIR` is the absolute path of `~/Library/Application Support/udaff-counter-tracker/worker-locks`. The directory had no claim files. `com.udaff.counter-tracker.worker` is not installed.
- `PRAGMA data_version` stayed 2. Round, match, prediction, score, comment, checkpoint, and snapshot counts were unchanged. Round 15 `nextPredictionFetchAt` stayed `2026-11-20T18:30:00.000Z`.
- `npm run worker:plan` used a read-only database connection. Round 15 prediction and result lines were separate. Both were `not-due` at `2026-11-20T18:30:00.000Z`. The prediction time is the stored field. The result time is earliest kickoff plus 120 minutes. Setting the 60-minute interval would not rewrite the stored value.
- Isolated `src/tests/worker/worker.test.ts`: 15 tests passed, including claim contention. It did not open the live database.

The first prediction-only refresh is not approved. It would call `refreshRoundPredictions` for round 15, with `PREDICTION_REFRESH_INTERVAL_MINUTES=60` only in that process, through the shared claim. It would not call result ingestion or scoring. Post-kickoff acceptance is still undecided, so that call stays unrun.

## Checks for independent schedules

Run on 2026-11-20 in a worktree based on `ca6d5ee1be78add265709ca28716a1aa6ede7128`. The serving checkout was not switched, installed, or rebuilt. No seed, import, poll, refresh, recalculation, round transition, or schema push was run against `prisma/dev.db`.

- `npm test`: 49 files, 333 tests passed, including `src/tests/worker/worker.test.ts`.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed in that worktree and printed Next.js 16.4.5. It used a disposable `DATABASE_URL`, not the serving checkout's `.next`.
- `npm run worker:plan` was run with the live database opened read-only and a temporary claim directory. `PRAGMA data_version` stayed 2. No claim file was created. Rounds 1–13 were archived. Round 14 was closed. Round 15 prediction `nextAt` was the stored `2026-11-20T18:30:00.000Z`. Round 15 result `nextAt` was the same instant, recomputed as the earliest kickoff `2026-11-20T16:30:00.000Z` plus 120 minutes. `nextPollAt` is null and every round-15 `autoCheckAttempts` is 0. The two lines are separate rules that currently name the same instant.
- `com.udaff.counter-tracker.worker` is not loaded. The web listener is still `127.0.0.1:3000`.

`PREDICTION_REFRESH_INTERVAL_MINUTES` stays unset. The proposed value is 60 and was not written to the live environment. `WORKER_RESULTS_ENABLED` stays off. The serving process does not share claim files until it is updated and restarted. The worker is not ready to enable.

## Checks for the worker

Run on 2026-11-20 in a worktree of `4daa59d5abe0d738b2975b48ae2f9a32eede6ee5`. The serving checkout was not switched, installed, or rebuilt. No seed, import, poll, refresh, recalculation, or round transition was run against `prisma/dev.db`.

- `npm test`: 49 files, 332 tests passed, including `src/tests/worker/worker.test.ts`.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed in that worktree and printed Next.js 16.4.5. It did not use the serving checkout's `.next`.
- `npm run worker:plan` was then run with the live database opened read-only. `PRAGMA data_version` stayed 2. No claim file was created. Rounds 1–13 were archived, round 14 was closed, and round 15 was not due. The worker LaunchAgent was not installed.

## Checks for the per-fixture deadline

Run on 2026-11-20 in a worktree of `8867c64cc67e35bfb901aaf29f99356f0039d7f5`. The serving checkout was not switched, rebuilt, or restarted. No seed, import, poll, refresh, recalculation, round transition, or schema push was run against `prisma/dev.db`. The worker was not installed or enabled. `PREDICTION_REFRESH_INTERVAL_MINUTES` was not set.

- `npm test`: 50 files, 342 tests passed, including `src/tests/import/fixture-deadline.test.ts`, `src/tests/import/merge-predictions.test.ts`, and `src/tests/worker/worker.test.ts`.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed in that worktree and printed Next.js 16.4.5. It used a disposable `DATABASE_URL`, not the serving checkout's `.next`.

The rule compares stored publication time with stored kickoff. A comment at the kickoff instant is late for that fixture. Fetch time is not used. A later eligible comment replaces only the fixtures it names. An edit without one reliable metadata timestamp leaves stored predictions and is flagged. Live selections were not rewritten.

## Checks for the pre-merge review

Run on 2026-11-20 against a read-only snapshot of the live database. `PRAGMA data_version` on the live file stayed 2. The serving checkout was not switched or restarted. No import, refresh, recalculation, or score write was run. Pull request #21 was not merged. The worker stayed disabled.

The comparison used `origin/main` selection (`postedAt` falling back to `createdAt`, earliest identical score, disagreements in review) against this branch's `slipsByParticipant`. Stored breakdowns were compared with both results.

- Archived auto slips change on rounds 1, 2, 4, 5, 6, 10, and 12: 38 selected cells become missing. There were no replacements and no new review cells. Each of those 38 cells matches its stored breakdown before the change and would disagree after it.
- Live totals change on rounds 1, 2, 4, 5, and 6. The review total changes from the stored number to a newly calculated number for 8 participants on rounds 1, 2, and 5. Rounds 10 and 12 change the displayed score.
- Closed round 14 does not change. Its selected sets are manual, so the deadline does not filter them. Round 15 does not change: 58 selected cells, and the closest publication is about 70 hours before kickoff.
- Scored season totals and audit exports stay on stored points. Archived rounds stay out of the production total. Results breakdowns stay on `breakdownJson`.
- All 939 stored permalinks match `postedAt` to the minute. None of the permalinks carries a timezone. Four comments have a body `<del datetime="+00:00">` three hours before the permalink minute, and none of those four has a prediction set. No comment has an edit mark in its metadata. One comment has the word in the body. No reliable edit time is derived.
- Comments whose stored instant is less than three hours after kickoff are the clock-sensitive set. Four of the 38 changed cells are in that set. A Moscow reading of the permalink digits would leave those four eligible. The other 34 changed cells are later than three hours and stay late under that reading.

- `npm test`: 51 files, 350 tests passed, including `src/tests/import/deadline-evidence.test.ts`.
- `npx tsc --noEmit`: passed.

That comparison is the record of the branch before saved and live views were separated. The following section is the later check. Do not rewrite stored scores or `postedAt` from this older note.

## Checks for saved calculations and the publication clock

Run on 2026-11-20 in the same read-only snapshot. The live database `data_version` stayed 2. No comment was posted, no import was saved, and no score or `postedAt` was rewritten. The serving checkout was not updated. The worker stayed disabled. Pull request #21 was not merged.

WordPress REST schema text calls `date` the site timezone and `date_gmt` GMT. Read-only comment responses from July, August, October, and November differ by exactly three hours. The HTML permalink matches `date` to the minute. Round 15's article line `20.11, 19:30 — Ростов — Крылья Советов` matches the stored kickoff `2026-11-20T16:30:00.000Z`. Kickoff is not converted a second time. A body `<del datetime>` is not used as the publication time.

- Saved review cells on rounds 1–14 agree with the stored breakdown. The comparison found 0 disagreements. Closed round 14 and archived round 13 are manual, so their candidate slips remain those manual selections.
- Auto rounds 1–12 have legacy publication times. Their current candidates are uncertain or absent. They are not classified as late.
- Round 15 is an open live selection with no stored scores. 58 prediction cells are time uncertain. 14 fixture cells have no selected prediction. 0 cells are accepted by the deadline.
- `npm test`: 53 files, 356 tests passed, including `src/tests/import/publication-clock.test.ts` and `src/tests/standings/calculation-view.test.ts`.
- `npx tsc --noEmit`: passed.
- ESLint on the changed source and tests: passed.

The legacy correction is a separate approved write: set `postedAt` to the normalized UTC instant where `rawHtml` still shows the old encoding. It was not run.

## Background worker

Prediction due time and result due time are separate. `nextPredictionFetchAt` advances by `PREDICTION_REFRESH_INTERVAL_MINUTES` after a prediction attempt. The accepted initial interval is 60 minutes. It is not in the live environment, so the stored round-15 time is unchanged. Result attempts stay on the fixture. `WORKER_RESULTS_ENABLED` must also be `1` before the worker fetches results or stores scores. The serving process now uses the shared claim directory. The worker agent is not installed. The per-fixture deadline is in pull request #21 and is not merged. See [../decisions/008-per-fixture-deadline.md](../decisions/008-per-fixture-deadline.md). Do not enable the worker, do not merge that pull request, and do not refresh round 15, until the operator asks. Details are in [../OPERATIONS.md](../OPERATIONS.md).

## Open

- Two audit groups remain after Next.js 16.4.5. They were not upgraded with the worker. See [../SECURITY.md](../SECURITY.md).
- The running process is the 16.4.5 build `UI3hxUAeqeBw---qenFjH` from `bff0de26756c6ba7ef56ed11c8fd04261c8cfc99`. A later docs commit does not replace that build.
- No authentication and no TLS. The web command remains `npm run start -- --hostname 127.0.0.1 --port 3000`.
- The worker is not enabled. `PREDICTION_REFRESH_INTERVAL_MINUTES` stays unset even though 60 minutes is the accepted future interval. `WORKER_RESULTS_ENABLED` is off. Pull request #21 is not merged. Saved calculations stay on the stored breakdown. Legacy publication times on the open round stay uncertain. Do not deploy it, do not correct `postedAt`, and do not run the round-15 prediction refresh.
- The running checkout can lag `main` until an explicit update. Merging source does not restart it.
- Server deployment is not designed beyond [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Do not do next

- Do not seed, re-import, poll, refresh, or recalculate the live season to "confirm" these docs.
- Do not close, reopen, or start a real round.
- Do not upgrade Next.js or Prisma unless that upgrade was requested.
- Do not install, load, or start `com.udaff.counter-tracker.worker`.
- Do not set `WORKER_ENABLED=1`, `WORKER_RESULTS_ENABLED=1`, or `PREDICTION_REFRESH_INTERVAL_MINUTES` in the live environment until the operator asks for that specific flag.
- Do not merge pull request #21 or deploy it. Do not recalculate archived or closed rounds. Do not bulk-shift `postedAt`. A legacy publication time stays uncertain until the operator asks for that correction.
- Do not call `refreshRoundPredictions` or `refreshDuePredictions({ forceRoundId })` for round 15. A later prediction-only check, if the operator asks for it, is one round, the shared claim, the 60-minute interval in that process only, no result fetch, and no score write. `refreshDuePredictions` does not bypass the stored time unless `forceRoundId` is passed.
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
