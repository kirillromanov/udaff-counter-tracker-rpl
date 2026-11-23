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

## Round 15 publication-time correction

The operator confirmed that offset-less forum timestamps are Moscow time. The correction used the current deadline branch and a consistent snapshot of the live database. It did not fetch the forum again.

Round 15 (`cmwntxbcj0001fyq6efpbp3hn`) had 14 source comments, 9 selected sets, 58 predictions, and 0 stored scores. All 14 comments had their own offset-less permalink, and each `postedAt` matched the permalink minute read as UTC. None was already normalized. No other field stores a publication instant, so the write set only `ForumComment.postedAt` to that minute read as UTC+3. `rawHtml`, comment bodies, prediction rows, manual selections, kickoffs, `nextPredictionFetchAt`, result attempts, scores, and every other round stayed unchanged.

On the isolated corrected snapshot the live cells were 58 accepted, 0 uncertain, 0 late, 0 ambiguous, and 14 missing. The 14 missing cells have no prediction on the selected sets. The 58 accepted scorelines are the same 58 selected cells counted before the deadline treated the legacy encoding as uncertain. No comment is in a kickoff minute. The latest corrected instant is `2026-11-19T18:55:00.000Z`; the first kickoff remains `2026-11-20T16:30:00.000Z`.

The live write used one compare-and-set transaction. A following read-only plan proposes 0 further corrections and 14 already-normalized rows, with the same 58 accepted and 14 missing cells. Rounds 1–14 still have uncorrected legacy timestamps. Their saved calculations were not rewritten. `scripts/correct-legacy-publication.ts` is read-only unless `--round-id`, `--apply`, and `--manifest` are all given.

- `npm test`: 54 files, 358 tests passed, including `src/tests/import/legacy-publication.test.ts`.
- `npx tsc --noEmit`: passed.
- ESLint on the correction source, script, and test: passed.
- `npm run build`: passed on Next.js 16.4.5 with a disposable database URL. It did not open the live database.

## Round 15 prediction refresh

One prediction-only refresh ran on 2026-11-20 for round 15 (`cmwntxbcj0001fyq6efpbp3hn`). The process set `PREDICTION_REFRESH_INTERVAL_MINUTES=60` for that process only and called `refreshDuePredictions({ forceRoundId })`. No other round was due. `WORKER_ENABLED` and `WORKER_RESULTS_ENABLED` were not set. The worker was not installed. The web process was not rebuilt or restarted.

The fetch reported `5 new, 0 updated, 13 unchanged, 0 duplicate, 0 ignored, 1 flagged`. Comments went from 14 to 19, selected sets from 9 to 13, and prediction rows from 58 to 83. Live cells went from 58 accepted and 14 missing to 83 accepted, 0 uncertain, 0 late, 0 ambiguous, and 21 missing. The previous 58 selected scorelines are unchanged. The 25 new accepted cells are new eligible comments: Doctor Livesey (5708), Askvit (5710, one fixture), Йош! (5712), and Hordi Cruyff (5713). Comment 5709 stored no prediction set. All 19 publication times match the Moscow permalink normalization. None needed another correction.

`lastPredictionFetchAt` is `2026-11-20T01:25:34.762Z`. `nextPredictionFetchAt` is that instant plus 60 minutes, `2026-11-20T02:25:34.762Z`. Result attempts, result scheduling, kickoffs, scores, and checkpoints were unchanged. Comment 5707's stored text changed and its predictions were kept because the edit has no reliable edit time. Comment 5701's text did not change; its ingestion label moved from updated to flagged for the same reason. Both selected slips stayed accepted.

## Comment-change detection

A later read of the pre-refresh backup and the live rows separated the three comments. 5701's text, HTML, publication time, and parsed slip are identical; the only difference is the historical `updated` label, which the parser then treated as a new edit. That warning is a false positive. 5703's text and publication time are identical; the four-byte HTML difference is the chunk boundary (`</li><!-- #comment-## -->` versus the start of `ul class="children"`), not the comment body. 5707's parsed slip still includes the reply form and page footer that the previous extraction kept after the last comment. The current comment text does not. The score lines were not replaced. There is no edit timestamp, so that difference stays unresolved until an explicit review. The live labels were not changed.

`storedEditSignal` compares the current body with the slip text. A matching body with a historical `updated` label is stale and is not a new warning. A body difference stays `body-differs` on a later identical reading, and the selection pass does not clear that note. The reply form and comment-list marker are outside the extracted body. Markup inside a comment paragraph is still extracted. Deadline, scoring, attribution, and selection are unchanged.

## Edit-detection deploy and one prediction cycle

On 2026-11-20 the serving checkout fast-forwarded from `6b0e8bd22ec6d2952086242c828ee4a159ba0941` to `32740ec7b4a2e449f64fef7283653a898a986b92`. The lockfile was unchanged, so dependencies were not reinstalled. The web LaunchAgent was stopped, `npm run build` produced Next.js 16.4.5 build `XYhX_nNRKoRYfRqQWS8DI`, and the same agent was started again. The compiled server output contains `body-differs`. The listener is PID 91149 on `127.0.0.1:3000` only. No schema push, seed, or score calculation ran.

Comment 5701 (`cmwntypbw000hfyq6u3rcbrq8`) was the only round-15 row for that forum id. Its body matched the retained slip exactly, the review note was empty, and the status was `flagged`. One compare-and-set changed `ingestionStatus` to `unchanged` and left the review state, note, selection, and prediction rows. The comment list no longer shows 5701. Its set stays in Accepted. That status change does not by itself empty the parser-review queue: the queue was already empty because the set status was accepted.

One `worker:once` process then ran with `WORKER_ENABLED=1`, `PREDICTION_REFRESH_INTERVAL_MINUTES=60`, and `WORKER_RESULTS_ENABLED` unset. The read-only plan before it had one runnable job: round 15 prediction refresh. Every result job was skipped. The cycle processed that one job, released its claim, and wrote `lastPredictionFetchAt` `2026-11-20T06:34:15.738Z` and `nextPredictionFetchAt` exactly 60 minutes later, `2026-11-20T07:34:15.738Z` (10:34 UTC+3). The page reports `1 new, 0 updated, 18 unchanged, 0 duplicate, 0 ignored, 1 flagged`.

Round 15 went from 19 comments, 13 sets, and 83 predictions to 20, 14, and 91. The new comment is 5714, published `2026-11-20T06:26:00Z` (09:26 UTC+3), with one selected accepted set of 8 predictions. Existing set ids stayed. Existing scorelines and selected flags stayed. Comments 5707 and 5713 kept their prediction rows. Both now show Needs review with the unresolved-edit note, because their slips still differ from the current body and neither has an edit time. 5713's stored text shortened by the reply-form tail that the previous last-comment extraction had kept. The parser-review queue still says nothing is waiting, because those sets remain status accepted. The visible warning is the comment badge and note.

Comments whose stored status is still `new` had their prediction rows deleted and recreated with the same scores, even though this fetch classified the text as unchanged. A stored `new` label is still treated as a current content class. The worker LaunchAgent was not installed and the live `.env` was not given `WORKER_ENABLED` or `PREDICTION_REFRESH_INTERVAL_MINUTES`. Result attempts stayed 0, result logs stayed 155, observations stayed 320, scores stayed 350 with the same point sum, and both checkpoints stayed. Other rounds' comment counts, prediction counts, publication sums, and clocks were unchanged.

Web status and stop:

```bash
launchctl print "gui/$(id -u)/com.udaff.counter-tracker"
launchctl bootout "gui/$(id -u)/com.udaff.counter-tracker"
```

The worker label `com.udaff.counter-tracker.worker` is not loaded. Do not bootstrap it. The serving build still rewrites prediction rows for a stored `new` label. `zsh scripts/worker-agent.sh status` and `zsh scripts/worker-agent.sh stop` are the commands for that label after a future install.

## Prediction-refresh idempotency

The following paragraphs record the verification before merge. The deploy section below is the running state.

`saveForumPost` classifies the current fetch: a comment was created, its extracted text changed, or the text was unchanged. That class is what `refreshRoundPredictions` and batch import pass to `parseStoredComments`. A stored `new`, `updated`, `unchanged`, or `duplicate` value is only the last saved disposition. An explicit reparse omits the fetch class and compares the body with the stored slip. `planCommentParse` does not treat the historical label as the fetch.

An unchanged fetch leaves an already parsed, equivalent slip alone: set id, prediction ids and scores, selected and manual flags, source, and creation time. It does not write a prediction or set timestamp just because the row was visited. Fetch metadata, the import log, and the next prediction time may still move. The same unchanged fetch still parses a comment whose previous parse failed, whose fixtures were missing, or which has no prediction set. An explicit reparse that produces the same scores keeps the existing prediction ids. A real source change uses the existing deadline rules. When the change is allowed, the writer updates the prediction row for that fixture in place and changes `updatedAt` only when the score, the match-of-the-round mark, or the raw line differs. A timed edit does not delete other fixtures. An unchanged later fetch does not clear a genuine unresolved edit. A matching body can clear only the stale unknown-edit note.

A private copy of the database after the 2026-11-20 cycle was refreshed twice with the stored comments served locally. Round 15 kept all 91 prediction ids and all 14 set ids, including selections and timestamps. Comments 5707 and 5713 stayed flagged with the unresolved-edit note and the same prediction rows. Comment 5714 stayed one set of 8 predictions. Round 15 still had 0 score rows and 0 result attempts. A refresh of closed round 14 was rejected before parsing. The live database file was not that copy.

## Checks for prediction-refresh idempotency

Run on 2026-11-20 in a worktree of `4ce3bf1bbdcd310eb782e0f04a67c1f2be4df5d8`. The serving checkout was not switched, rebuilt, or restarted. No live refresh, reparse, poll, score, relabel, or database restore.

- `npm test`: 56 files, 362 tests passed. That run included `src/tests/import/refresh-idempotency.test.ts` and `src/tests/import/refresh-idempotency-snapshot.test.ts`. The snapshot test used a private copy, not the live database.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed on Next.js 16.4.5 with a disposable database URL. It did not open the live database.

## Checks for comment-change detection

Run on 2026-11-20 from `fix/comment-change-detection`. No live database, refresh, reparse, or process restart.

- `npm test`: 54 files, 361 tests passed, including `src/tests/import/incremental.test.ts` and `src/tests/forum/extract-comments.test.ts`.
- `npx tsc --noEmit`: passed.
- ESLint on the touched import, extraction, and test files: passed.
- `npm run build`: passed on Next.js 16.4.5 with a disposable database URL. It did not open the live database.

## Idempotency deploy and supervised worker

Pull request #26 merged to `main` at `c12c410ac859cfa74f19afb34a9ca8a23feccca4`. Its parents are `4ce3bf1bbdcd310eb782e0f04a67c1f2be4df5d8` and `089be24783d87d37583e4460de74de0de837a42f`. The serving checkout fast-forwarded to that merge. The lockfile was unchanged, so dependencies were not reinstalled. The web LaunchAgent was stopped, `npm run build` produced Next.js 16.4.5 build `-ViUojczofhfmwOlfN68r`, and the same agent was started again. The compiled output contains `protect-unresolved`. The listener is PID 93921 on `127.0.0.1:3000` only. No schema push, seed, refresh, parse, or score calculation ran during the deploy.

The read-only plan and one `worker:once` both ran at `2026-11-20T07:02Z` with `WORKER_ENABLED=1`, `PREDICTION_REFRESH_INTERVAL_MINUTES=60`, and `WORKER_RESULTS_ENABLED` unset. The only active round was 15. Its prediction job was `not-due` until `2026-11-20T07:34:15.738Z` (10:34 UTC+3). Result jobs were skipped, including round 15 until `2026-11-20T18:30:00.000Z`. The once cycle processed 0 jobs, skipped 30, and made no database change. Round 15 stayed at 20 comments, 14 sets, and 91 predictions, with the same ids, scores, selections, and timestamps. Comments 5707 and 5713 stayed flagged with the unresolved-edit note. 5714 stayed one set. Scores stayed 350 with the same point sum. Result attempts stayed 0. Both checkpoints stayed. That skipped cycle did not fetch the forum and does not test the import.

After that skip, the live `.env` gained `WORKER_ENABLED=1` and `PREDICTION_REFRESH_INTERVAL_MINUTES=60`. `WORKER_RESULTS_ENABLED` and `WORKER_SCAN_MINUTES` stayed unset. `WORKER_LOCK_DIR` stayed the shared absolute directory. `zsh scripts/worker-agent.sh install` wrote the worker plist and did not load it. That plist had `RunAtLoad` false and no environment of its own. `zsh scripts/worker-agent.sh start` loaded it, and `launchctl kickstart` started it because `RunAtLoad` was false. Launchd reported one job, pid 94177. The web listener stayed PID 93921. The start line was `mode=supervise enabled=true results=false predictionIntervalMinutes=60`. The claim directory was empty after the cycle. The first fetch had not run yet; the verified fetch is in the next section.

Prediction and result clocks stay separate. Result checks stay off. Round 15's publication times are normalized; other rounds are not. See [../OPERATIONS.md](../OPERATIONS.md).

## Checks for this activation note

Run on 2026-11-20 in a worktree of `c12c410ac859cfa74f19afb34a9ca8a23feccca4`. The serving processes were left running. No seed, refresh, parse, poll, or score write ran for the note.

- `npm test`: 55 files passed, 1 skipped, 361 tests passed. The snapshot test stayed skipped because no private snapshot path was set.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build` was not run again. The serving build remains `-ViUojczofhfmwOlfN68r`.

## Verified unattended fetch

The supervised worker fetched round 15 at `2026-11-20T07:34:15.744Z` (10:34:15 UTC+3), 6 milliseconds after the stored due time. The forum download time is `2026-11-20T07:34:16.469Z`. The summary was `0 new, 0 updated, 20 unchanged, 0 duplicate, 0 ignored, 0 flagged`. Compared with the baseline taken before activation, all 91 prediction ids, scorelines, and timestamps stayed, and all 14 set ids and selections stayed. Comments 5707 and 5713 kept the unresolved-edit note. Result attempts stayed 0. Scores and checkpoints stayed. No other round's prediction clock moved. The process log did not show the cycle, because that build printed reports only when the loop exited.

A later attempt was stored at `2026-11-20T09:07:13.765Z` (12:07:13 UTC+3), again `0 new, 0 updated, 20 unchanged`. The same 91 prediction ids and 14 set ids were still present. The Mac had been asleep across the 11:34 UTC+3 due time and fully awake again at 11:52. That delay is an observation of this machine. The code had armed one wait until the stored due time; this change does not claim that macOS timer behavior from that one delay.

## Worker recheck

The supervised loop waits at most 60 seconds, then reads the wall clock and the persisted due times. The 60 seconds are a local recheck, not the prediction interval and not a forum poll. An overdue eligible round is fetched once. Missed intervals are not replayed. `nextPredictionFetchAt` still moves by `PREDICTION_REFRESH_INTERVAL_MINUTES` after the attempt. Result clocks and attempts are unchanged. Idle rechecks are not logged. A cycle that fetches, fails, or is at least one recheck late writes its start, counts, fetch summary, and next due time immediately.

`RunAtLoad` is true, so user login and `zsh scripts/worker-agent.sh start` start the process. A reboot does not start it until that user logs in. `zsh scripts/worker-agent.sh stop` unloads the job and leaves it stopped. A non-zero exit, including missing `.env` or `node_modules`, is restarted after the 60-second `ThrottleInterval`. A disabled worker exits 0 and is not restarted. One instance claim rejects a second process. Logs are `~/Library/Logs/udaff-counter-tracker/worker.log`. The web command does not install or start the worker. `WORKER_RESULTS_ENABLED` stays unset. See [../OPERATIONS.md](../OPERATIONS.md).

## Result verification, not deployed

New result decisions count configured source ids. One finished score is provisional. Two ids with the same finished score are verified. A later automatic disagreement keeps the verified score and shows a conflict. Operator verification and rollback live on the fixtures page. Parser review and the round overview share `roundCounters`. Sleep, logout/login, and reboot behavior of the worker are still untested on this Mac. `WORKER_RESULTS_ENABLED` stays unset. This change does not write the live database.

Fix score lives on Parser review, under the result refresh. Off is automatic. On keeps the score, and later sources do not replace it. The two-source replacement of a same-score confirmation is removed. Labels: `verified, fixed manually`, `fixed manually. Only one source agrees.`, and red `manual corrected, not source verified`. An older empty-provenance manual row stays stored and shows `older manual score`. Fixtures save no longer changes a score. The deployment order in [../DEPLOYMENT.md](../DEPLOYMENT.md) is not performed. An isolated review uses `scripts/isolated-review-seed.mjs` and port 3016, never the live database.

Round 16, not performed:

- Do not enable result processing until that round is chosen.
- Deploy only after review. Stop the prediction worker first if its source will change, then start one worker again. Leave results disabled until the explicit enable step.
- Watch the first finished fixture become provisional from one source, then verified when a second configured source agrees.
- Correct one score, confirm the standings checkbox, then roll it back and confirm the sources decide again.
- Open each counter and check that the row count matches.
- Stop with `zsh scripts/worker-agent.sh stop` if a result check starts writing unexpected scores. Do not clear comments 5707 or 5713.

## Checks for the review score toggle

Run on 2026-11-23 in the result-verification worktree after Fix score moved to Parser review. The serving checkout, the prediction worker, and the live database were not used.

- `npm test`: 59 files passed, 1 skipped, 375 tests passed, 1 skipped. The private snapshot test stayed skipped.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed on Next.js 16.4.5 against a disposable database that was removed after the build.
- The review page was opened on a disposable database. At 390 pixels the document was 390 wide with no horizontal overflow. The score block showed Provisional, Verified two sources, verified fixed manually, the red manual-corrected label, Source conflict, Scheduled, and older manual score. A screenshot of that block showed the stacked Fix score toggle. At 1920 pixels the same labels were present with no horizontal overflow. The fixtures page had Save fixtures and Official MT, and no score box, Verify this score, or Use this score.

## Checks for verified-manually replacement

Run on 2026-11-23 in the result-verification worktree after the replacement audit was added. The serving checkout, the prediction worker, and the live database were not used.

- `npm test`: 59 files passed, 1 skipped, 374 tests passed, 1 skipped. The private snapshot test stayed skipped.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed on Next.js 16.4.5 against a disposable database that was removed after the build.
- Screenshots at 390 pixels timed out. The fixtures page was checked in the browser at that width: the document was 390 pixels wide with no horizontal overflow, and the six statuses were Provisional, Verified two sources, Verified manually, Manually corrected, Source conflict, and Scheduled. Each source time was `2026-11-20 19:00 UTC+3` on its own nowrap line, inside the viewport. The review drill-downs showed 2 comments, 3 sets, 1 selected, 3 stored, 1 conflict, 1 correction, and 4 scored fixtures.

## Checks for result verification

Run on 2026-11-23 in a separate worktree. The serving checkout, the prediction worker, and the live database were not used. Schema changes were applied only to disposable SQLite files.

- `npm test`: 58 files passed, 1 skipped, 373 tests passed. The private snapshot test stayed skipped. The follow-up for the two operator states was included.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed on Next.js 16.4.5 with a disposable database URL.
- The fixtures and review screens were opened on that disposable database at desktop width and at a 390-pixel width. No live refresh or result poll was run.

## Checks for the worker recheck

Run on 2026-11-20 in a worktree of `8b1f4efdc6842051ddae9826729b86a20d97be9b`. The serving processes were left running for these checks. No seed, refresh, parse, poll, or score write ran for them.

- `npm test`: 55 files passed, 1 skipped, 363 tests passed, including `src/tests/worker/worker.test.ts`.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed on Next.js 16.4.5 with a disposable database URL. It did not open the live database.

## First cycle on the recheck build

Pull request #28 merged to `main` at `fbcde8d061ad78e825132dd67f73a8cdcc855276`. The serving checkout fast-forwarded to that commit. The lockfile was unchanged, so dependencies were not reinstalled and the web build was not replaced. The listener stayed PID 93921 on `127.0.0.1:3000`, build `-ViUojczofhfmwOlfN68r`. The previous worker was stopped before the fast-forward. `zsh scripts/worker-agent.sh install` rewrote the plist with `RunAtLoad` true, `KeepAlive` `SuccessfulExit` false, and `ThrottleInterval` 60. `zsh scripts/worker-agent.sh start` loaded it once. Launchd reports one job, pid 98451, one run, never exited. The start line is `2026-11-20T09:21:03.641Z worker start mode=supervise enabled=true results=false predictionIntervalMinutes=60`.

Nothing was due at startup. No idle recheck lines were written. The lines stamped `2026-11-20T09:19:51Z` are the previous process flushing buffered reports as it stopped. They are not extra fetches.

The due cycle logged `cycle-start` at `2026-11-20T10:07:14.359Z`, under a second after the stored time `2026-11-20T10:07:13.765Z`. It processed one prediction job, skipped 29, and recorded `4 new, 0 updated, 20 unchanged, 0 duplicate, 0 ignored, 0 flagged`. Comments 5715, 5716, 5717, and 5718 were added, with 3 new sets and 24 new predictions. The previous 91 prediction ids and 14 set ids stayed, including selections and timestamps. Comments 5707 and 5713 stayed flagged. Compared with the backup taken before the restart, scores stayed 350 summing to 4575, result attempts stayed 0, result logs stayed 155, observations stayed 320, both checkpoints stayed, and round 14's manual flags stayed. Only round 15's prediction clock moved. The next time is `2026-11-20T11:07:13.781Z` (14:07 UTC+3). This machine was awake, so that timing is not a sleep-resume test.

## Background worker

Prediction due time and result due time are separate. `nextPredictionFetchAt` advances by `PREDICTION_REFRESH_INTERVAL_MINUTES` after a prediction attempt. The live environment sets that interval to 60. `WORKER_RESULTS_ENABLED` is unset. The loop rechecks eligibility at most every 60 seconds and does not wake the Mac. Status and stop:

```bash
zsh scripts/worker-agent.sh status
zsh scripts/worker-agent.sh stop
```

See [../OPERATIONS.md](../OPERATIONS.md).

## Open

- Two audit groups remain after Next.js 16.4.5. They were not upgraded with the worker. See [../SECURITY.md](../SECURITY.md).
- The running web process is Next.js 16.4.5 build `-ViUojczofhfmwOlfN68r` from merge `c12c410ac859cfa74f19afb34a9ca8a23feccca4`. It listens only on `127.0.0.1:3000`. A later docs commit does not replace that build.
- No authentication and no TLS. The web command remains `npm run start -- --hostname 127.0.0.1 --port 3000`.
- Prediction refresh is supervised. `WORKER_ENABLED=1` and `PREDICTION_REFRESH_INTERVAL_MINUTES=60` are in the live environment. `WORKER_RESULTS_ENABLED` is unset. The 10:34 UTC+3 fetch kept all 91 prediction ids and 14 set ids. The 13:07 UTC+3 cycle added comments 5715–5718 without changing those rows. Saved calculations stay on the stored breakdown. Round 15's publication times are normalized. Comments on other rounds keep the legacy encoding. Do not shift those times. Live comments were not relabeled, and the earlier replaced prediction ids were not restored.
- The running checkout can lag `main` until an explicit update. Merging source does not restart it.
- Server deployment is not designed beyond [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Do not do next

- Do not seed, re-import, poll, refresh, or recalculate the live season to "confirm" these docs.
- Do not close, reopen, or start a real round.
- Do not upgrade Next.js or Prisma unless that upgrade was requested.
- Do not set `WORKER_RESULTS_ENABLED=1`. Do not add cron, a web-process timer, or a second worker. Stop the existing worker with `zsh scripts/worker-agent.sh stop`.
- Do not force a prediction refresh with `forceRoundId`. The supervised worker fetches a round when `nextPredictionFetchAt` is due. Do not rewrite that timestamp by hand.
- Do not recalculate archived or closed rounds. Do not bulk-shift the remaining legacy `postedAt` values. A legacy publication time on any round other than the corrected round 15 stays uncertain.
- Do not clear comments 5707 or 5713. Both keep the unresolved-edit note and their previous prediction rows. 5701 is already `unchanged`. Do not bulk-relabel stored `new` comments, and do not restore prediction ids from an older copy.
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
