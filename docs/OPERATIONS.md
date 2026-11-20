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
| `WORKER_RESULTS_ENABLED` | No | Exact `1`, and `WORKER_ENABLED=1`, allows result checks. Off by itself |
| `PREDICTION_REFRESH_INTERVAL_MINUTES` | No | Gap written into `nextPredictionFetchAt` after a prediction attempt. Integer from 5 to 1440. No default. Accepted initial value 60, not configured |
| `WORKER_SCAN_MINUTES` | No | Optional ceiling on sleep before the process looks again. It does not set a task due time |
| `WORKER_LOCK_DIR` | No | Claim files shared by the worker, web refresh, and CLI. Default `~/Library/Application Support/udaff-counter-tracker/worker-locks` |

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
| `npm run worker:plan` | Prints eligible and skipped rounds. Reads scheduling columns only. Creates no claim file and fetches nothing |
| `WORKER_ENABLED=1 PREDICTION_REFRESH_INTERVAL_MINUTES=60 npm run worker:once` | One prediction cycle. 60 is the accepted initial interval and is not set in the live environment |
| `WORKER_ENABLED=1 WORKER_RESULTS_ENABLED=1 npm run worker:once` | Also runs due result checks. Do not set this on the live database until approved |
| `zsh scripts/worker-agent.sh install` | Writes `~/Library/LaunchAgents/com.udaff.counter-tracker.worker.plist` and does not bootstrap it |
| `zsh scripts/worker-agent.sh start` | Bootstraps that plist. Do not run this until enablement is approved |
| `zsh scripts/worker-agent.sh status` | `launchctl print` for the worker label |
| `zsh scripts/worker-agent.sh stop` | `launchctl bootout` for the worker label |
| `zsh scripts/worker-agent.sh uninstall` | Bootstraps nothing. Removes the plist after a bootout |

`scripts/worker-service.sh` is the program inside the plist. It does not export `WORKER_ENABLED`. A disabled process exits 0. launchd is set to restart only after a non-zero exit, so a disabled exit does not loop. Logs go to `~/Library/Logs/udaff-counter-tracker/worker.log`. The same directory is used by the web server and is not rotated here.

The worker and the web server both use `DATABASE_URL` from the repo `.env`. Start the worker with the repository as its working directory. `file:./dev.db` is the same relative path the server already uses. Claim files record a pid. A dead pid is replaced on the next acquire. A second live process logs `duplicate-worker` and exits 0. `SIGINT` and `SIGTERM` stop the loop after the current round. Forum and result fetches already time out after 20 seconds. One round's error does not stop the process.

Prediction and result times are separate. `nextPredictionFetchAt` is the only prediction due time. Null means an active round is due. After an attempt, the worker and a manual refresh write `now` plus `PREDICTION_REFRESH_INTERVAL_MINUTES` when that variable is set. They do not copy the result clock and they do not change `autoCheckAttempts`. Without the variable, a manual refresh leaves the stored prediction time unchanged and the worker does not fetch predictions. The result clock remains kickoff plus 120 minutes, then 5 minutes, up to 10 attempts, on the fixture row. `npm run worker:plan` prints one line per job.

`refreshRoundPredictions` can write comments and, only when the round has no fixtures, new fixtures. It does not write `RoundScore`. It stores a comment published at or after kickoff and can parse it. A new comment counts for a fixture only when its normalized publication time is before that kickoff. A remaining legacy offset-less `postedAt` stays uncertain and is not treated as on time or late. Round 15's proven legacy times were corrected; other rounds were not. Archived, closed, and scored rounds display the stored breakdown. An open round's live selection does not freeze a fixture that has no stored score. A later eligible comment updates only the fixtures it names. A manual selection is the whole slip. An edited comment replaces a fixture only when its edit time is before that kickoff; without an edit time the stored predictions stay and the comment is flagged. The flag follows a body difference from the parsed slip, not a stored `updated` label or a reply-form wrapper. `refreshRoundResults`, used only when the result flag is on, writes that round's observations and scores, may set the round's calculation status, and rebuilds season snapshots from that round forward. It reads the manual baseline and does not rewrite it. It does not close a round. Archived rounds are not scored. Closed rounds are rejected before the write.

The web process, `npm run predictions:refresh`, and `npm run results:poll` take claim files in `WORKER_LOCK_DIR`. The live environment sets that variable to the absolute path of `~/Library/Application Support/udaff-counter-tracker/worker-locks`. A future worker started from this checkout uses the same file. Do not install or start the worker agent as part of a web restart. One due prediction cycle ran on 2026-11-20 with the interval supplied only to that process. The agent is still not installed, and the live environment still has no `WORKER_ENABLED` or `PREDICTION_REFRESH_INTERVAL_MINUTES`. The source on this branch passes the current fetch outcome into the parser, so an unchanged already-parsed slip keeps its prediction ids. That source is not the running build. The running build still recreates rows when the stored status is `new`. Do not start the supervised loop until this change is merged and that build is replaced by an explicit request. Result checks stay off unless `WORKER_RESULTS_ENABLED=1`.

The running web agent is `com.udaff.counter-tracker`. Status and stop:

```bash
launchctl print "gui/$(id -u)/com.udaff.counter-tracker"
launchctl bootout "gui/$(id -u)/com.udaff.counter-tracker"
```

After a future worker install, `zsh scripts/worker-agent.sh status` and `zsh scripts/worker-agent.sh stop` address `com.udaff.counter-tracker.worker`. That plist is not loaded.

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
