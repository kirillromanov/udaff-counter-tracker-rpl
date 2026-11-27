# Operations

## Commands that match `package.json`

| Command | Effect |
| --- | --- |
| `npm install` | Install from `package-lock.json` |
| `npm run db:generate` | `prisma generate` |
| `npm run db:push` | Push `schema.prisma` to the database in `DATABASE_URL` |
| `npm run db:seed` | Deletes all seasons and participants, then loads the demo. Not safe on a real season |
| `npm test` | `vitest run` |
| `npm run lint` | `eslint` |
| `npx tsc --noEmit` | Typecheck. There is no `typecheck` script |
| `npm run build` | `next build`. Stop `next start` first so it is not reading `.next/` |
| `npm run start` | `next start`. Without a hostname, Next listens on `0.0.0.0`. The local service does not use that default |
| `npm run dev` | `next dev` |
| `npm run local:install` | Writes a per-user LaunchAgent. The plist is outside the repo |
| `npm run local:service` | `scripts/dev-up.sh --service` |
| `npm run worker:plan` | Read-only eligibility list. No fetch and no database write |
| `npm run worker:once` | One prediction cycle, only when `WORKER_ENABLED=1` |
| `npm run worker:run` | Supervised loop. Refuses to process until enable and scan are both set |
| `npm run worker:agent -- install` | Writes the worker LaunchAgent and does not load it |
| `npm run import:rounds` | Downloads the configured early-round sources. Writes comments and fixtures |
| `npm run results:poll` | Runs `pollDueRounds` once |
| `npm run predictions:refresh` | Runs the due prediction refresh once |
| `npm run baseline:round13` | Installs the round-13 checkpoint. Do not rerun casually |
| `npm run scores:recalculate-1-13` | Recalculates stored scores for rounds 1–13. Do not rerun casually |

Read a script before running it. Import, poll, refresh, baseline, and recalculate scripts write the database named by `DATABASE_URL`.

## Environment

Names only. Values stay in the untracked `.env`. See `.env.example`.

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | SQLite URL. `file:./dev.db` means `prisma/dev.db` |
| `FOOTBALLDATA_API_KEY` | No | Bearer token. Empty skips that source |
| `FOOTBALLDATA_LEAGUE_ID` | No | Overrides league discovery |
| `FOOTBALLDATA_SEASON_ID` | No | Overrides season discovery |
| `RESULT_POLL_INTERVAL_MINUTES` | No | Default 60. Passed into due selection. The fixture clock is kickoff plus 120 minutes, then 5 |
| `RESULT_POLL_LIVE_INTERVAL_MINUTES` | No | Default 15. Same limitation as the regular interval |
| `WORKER_ENABLED` | No | Exact `1` allows worker cycles. Any other value does no processing |
| `WORKER_RESULTS_ENABLED` | No | Exact `1`, and `WORKER_ENABLED=1`, allows result checks. Read once at process start. Off by itself. A round also needs `resultsProcessing` |
| `PREDICTION_REFRESH_INTERVAL_MINUTES` | No | Gap written into `nextPredictionFetchAt` after a prediction attempt. Integer from 5 to 1440. No default. The live environment sets 60 |
| `WORKER_SCAN_MINUTES` | No | Optional shorter ceiling. The supervised wait is already at most 60 seconds, and the smallest accepted scan is 5 minutes, so a set value does not change that wait. It does not set a task due time |
| `WORKER_LOCK_DIR` | No | Claim files shared by the worker, web refresh, and CLI. Default `~/Library/Application Support/udaff-counter-tracker/worker-locks` |

Prisma Client resolves a relative `file:` URL from the `prisma/` directory, so `file:./dev.db` is `prisma/dev.db`. `prisma migrate diff --from-url` resolves a relative `file:` URL from the process working directory. A `dev.db` at the repository root is a different file. `scripts/apply-result-verification-schema.ts` does not read `DATABASE_URL`. Pass `--database` with the absolute path of the existing SQLite file. The deployment order is in [DEPLOYMENT.md](DEPLOYMENT.md) and has not been run.

## Backup

The live file is `prisma/dev.db`. A consistent copy:

```bash
sqlite3 prisma/dev.db ".backup '/path/outside/the/repo/dev.db'"
sqlite3 /path/outside/the/repo/dev.db "PRAGMA integrity_check;"
```

Also copy `.env` to the same private directory if the machine must be rebuilt. Do not commit either file. A git bundle does not contain the database, `.env`, or uncommitted files.

Restore by stopping the server, replacing `prisma/dev.db` with the backup, and starting one server. Do not run seed after a restore.

## Local service

`scripts/install-launch-agent.sh` writes `~/Library/LaunchAgents/com.udaff.counter-tracker.plist`. The program is `scripts/dev-up.sh --service`. When port 3000 is free, that mode runs `npm run start -- --hostname 127.0.0.1 --port 3000`. The plist does not contain the Next command, so a restart uses the script that is in the checkout. There is no login page and no `middleware.ts`. This loopback bind is the local admin. It is not the bind address for a future server. `npm run start` without `--hostname` still uses Next's `0.0.0.0` default.

The web LaunchAgent does not run `results:poll`, `predictions:refresh`, or the worker. Due checks still run from an admin action or those npm scripts unless the worker is later enabled.

## Worker

The worker is one sequential process, `scripts/worker.ts`. It is not a Next.js timer, a route, or a second cron. The web command is unchanged.

| Command | Effect |
| --- | --- |
| `npm run worker:plan` | Prints eligible and skipped rounds. Reads scheduling columns, including `resultsProcessing`, only. A due result line is `results-disabled` when the boot flag is off and `round-switch-off` when the flag is on and the round switch is off. Creates no claim file and fetches nothing |
| `npm run results:observe -- --database /absolute/copy.db --round 15` | Read-only. Prints the score a check would store. Writes no match, observation, fetch log, source health, score, audit, or claim. Pass `--fixtures` to use a recorded file instead of live requests |
| `WORKER_ENABLED=1 PREDICTION_REFRESH_INTERVAL_MINUTES=60 npm run worker:once` | One prediction cycle. The live environment already sets both values |
| `WORKER_ENABLED=1 WORKER_RESULTS_ENABLED=1 npm run worker:once` | Also runs due result checks. Do not set this on the live database until approved |
| `zsh scripts/worker-agent.sh install` | Writes `~/Library/LaunchAgents/com.udaff.counter-tracker.worker.plist` and does not bootstrap it |
| `zsh scripts/worker-agent.sh start` | Loads the plist. `RunAtLoad` starts the process. A user login does the same. A reboot does not start it until that user logs in |
| `zsh scripts/worker-agent.sh status` | `launchctl print` for the worker label |
| `zsh scripts/worker-agent.sh stop` | `launchctl bootout` for the worker label |
| `zsh scripts/worker-agent.sh uninstall` | Bootstraps nothing. Removes the plist after a bootout |

`scripts/worker-service.sh` is the program inside the plist. It does not export `WORKER_ENABLED`. Missing `.env` or `node_modules` exits 1. A disabled worker, with `WORKER_ENABLED` unset, exits 0. `KeepAlive` restarts only a non-zero exit, and `ThrottleInterval` is 60 seconds, so a broken start does not spin. `zsh scripts/worker-agent.sh stop` unloads the job and leaves it stopped. Killing the process without unloading is not the stop command: a non-zero exit is started again after the throttle. Logs go to `~/Library/Logs/udaff-counter-tracker/worker.log`. The file is appended and is not rotated here. Cycle lines are written when a cycle runs, not once a minute while nothing is due.

The worker and the web server both use `DATABASE_URL` from the repo `.env`. Start the worker with the repository as its working directory. `file:./dev.db` is the same relative path the server already uses. Claim files record a pid. A dead pid is replaced on the next acquire. A second live process logs `duplicate-worker` and exits 0. `SIGINT` and `SIGTERM` stop the loop after the current round. Forum and result fetches already time out after 20 seconds. One round's error does not stop the process.

Prediction and result times are separate. `nextPredictionFetchAt` is the only prediction due time. Null means an active round is due. After an attempt, the worker and a manual refresh write `now` plus `PREDICTION_REFRESH_INTERVAL_MINUTES` when that variable is set. They do not copy the result clock and they do not change `autoCheckAttempts`. Without the variable, a manual refresh leaves the stored prediction time unchanged and an enabled supervised process exits 1 instead of looping. The supervised loop waits at most 60 seconds, then reads the wall clock and the persisted due times again. That recheck does not fetch the forum. An overdue round is fetched once; missed intervals are not replayed. The next stored time is still one interval after the attempt. A sleeping Mac is not woken for this timer, and the wait is not an exact wake bound. Once the process is executing, it does not keep a remaining hour-long timer. The result clock remains kickoff plus 120 minutes, then 5 minutes, up to 10 attempts, on the fixture row. `npm run worker:plan` prints one line per job.

`refreshRoundPredictions` can write comments and, only when the round has no fixtures, new fixtures. It does not write `RoundScore`. It stores a comment published at or after kickoff and can parse it. A new comment counts for a fixture only when its normalized publication time is before that kickoff. A remaining legacy offset-less `postedAt` stays uncertain and is not treated as on time or late. Round 15's proven legacy times were corrected; other rounds were not. Archived, closed, and scored rounds display the stored breakdown. An open round's live selection does not freeze a fixture that has no stored score. A later eligible comment updates only the fixtures it names. A manual selection is the whole slip. An edited comment replaces a fixture only when its edit time is before that kickoff; without an edit time the stored predictions stay and the comment is flagged. The flag follows a body difference from the parsed slip, not a stored `updated` label or a reply-form wrapper. `refreshRoundResults`, used only when the result flag is on, writes that round's observations and scores, may set the round's calculation status, and rebuilds season snapshots from that round forward. It reads the manual baseline and does not rewrite it. It does not close a round. Archived rounds are not scored. Closed rounds are rejected before the write.

The web process, `npm run predictions:refresh`, and `npm run results:poll` take claim files in `WORKER_LOCK_DIR`. The live environment sets that variable to the absolute path of `~/Library/Application Support/udaff-counter-tracker/worker-locks`. The supervised worker uses the same file. The live environment has `WORKER_ENABLED=1` and `PREDICTION_REFRESH_INTERVAL_MINUTES=60`. `WORKER_RESULTS_ENABLED` is unset, so the supervised loop does not fetch results or store scores. The parser in the running build receives the current fetch outcome, so an unchanged already-parsed slip keeps its prediction ids. The first unattended fetch ran at `2026-11-20T07:34:15.744Z` (10:34:15 UTC+3) and stored `0 new, 0 updated, 20 unchanged, 0 duplicate, 0 ignored, 0 flagged`. All 91 prediction ids and all 14 set ids stayed. A later attempt at `2026-11-20T09:07:13.765Z` (12:07:13 UTC+3) stored the same summary. The first cycle on the recheck build, at `2026-11-20T10:07:13.781Z` (13:07:13 UTC+3), stored `4 new, 0 updated, 20 unchanged, 0 duplicate, 0 ignored, 0 flagged` and left the earlier 91 prediction ids and 14 set ids in place. Do not install or start the worker agent as part of a web restart.

The running web agent is `com.udaff.counter-tracker`. Status and stop:

```bash
launchctl print "gui/$(id -u)/com.udaff.counter-tracker"
launchctl bootout "gui/$(id -u)/com.udaff.counter-tracker"
```

The worker agent is `com.udaff.counter-tracker.worker`. Status and stop:

```bash
zsh scripts/worker-agent.sh status
zsh scripts/worker-agent.sh stop
```

`zsh scripts/worker-agent.sh start` loads the plist, and `RunAtLoad` starts the process. The same load at user login starts it. A reboot does not start it until that user logs in. `zsh scripts/worker-agent.sh stop` unloads it and leaves it stopped.

Restart without a second process. Boot the agent out first and wait until port 3000 is free. If a listener is still healthy, `--service` exits and leaves that listener in place, including an older all-interface process.

```bash
launchctl bootout "gui/$(id -u)/com.udaff.counter-tracker"
# wait until port 3000 is free
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.udaff.counter-tracker.plist"
```

If this start fails, leave the agent stopped. Do not start `npm run start -- --port 3000` as a rollback. That command listens on every interface.

A dependency change needs the agent stopped before `npm ci` or `npm run build`. Do not replace `node_modules` or `.next` while `next start` is using them. Then bootstrap the same LaunchAgent once. The start command stays `--hostname 127.0.0.1`. Do not run seed, `db push`, import, or recalculation as part of that restart. If the new build fails, leave the agent stopped rather than starting the previous vulnerable Next.js.

## Isolated tests

`src/tests/rounds/production-activation.test.ts` runs `prisma db push` against a temporary SQLite file and passes that client into the functions. Other tests are pure and do not open `prisma/dev.db`. Do not point `DATABASE_URL` at the live file inside a new test.

## Publish routine

Start each task from current `origin/main`, on a new branch. Do not continue `cursor/participant-identity-8862`.

1. Fetch and inspect the branch, status, and the live database.
2. Implement only the requested change. Use a separate worktree when the serving checkout must stay where it is.
3. Run the checks in [TESTING.md](TESTING.md) without seed, poll, or recalculate scripts.
4. Update `docs/` and `docs/handoff/CURRENT.md` when behavior or publication status changed.
5. Review the diff. Reject `.env`, databases, backups, logs, and `.next/`.
6. Commit the reviewed files and push the task branch with a normal push.
7. Open a pull request into `main`. Merge it when the checks pass and the operator has asked for that merge.
8. Fetch `origin/main` and confirm the SHA.

Updating the running server, rebuilding `.next`, or copying the database is a separate explicit operation. Merging `main` does not do those things.

The configured remote is `https://github.com/kirillromanov/udaff-counter-tracker-rpl`. Do not force-push. There is no commit hook in this repo that publishes or deploys.
