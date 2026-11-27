# Runbook

Start a new session at [handoff/CURRENT.md](handoff/CURRENT.md). The commands there are read-only. This page is the operation list. None of these steps run themselves when a documentation pull request merges.

Backup folders, the live database path, and process names are kept outside Git. Do not copy them into this file.

## Deploy

1. Review the pull request. Leave it unmerged until the operator says to merge.
2. On the serving checkout, confirm the branch and that the only expected extra file is the untracked root `dev.db`. Do not delete that file, do not switch that checkout's branch, and do not build `.next` while `next start` is using it.
3. Build in a separate worktree with a disposable `DATABASE_URL`. Do not run `prisma db push` on the live file.
4. Quiesce, then fast-forward the serving checkout to the merge commit and start the existing LaunchAgent. `scripts/dev-up.sh --service` leaves a healthy port 3000 alone, so a deploy has to stop the web job first.

## Quiesce

1. `zsh scripts/worker-agent.sh stop`. Wait until the worker lock directory has no claim file with a live pid. Do not kill an in-flight fetch.
2. `launchctl bootout gui/$(id -u)/com.udaff.counter-tracker`. Wait until nothing listens on port 3000.
3. Start the web again with `launchctl bootstrap` of the existing plist. Start the worker with `zsh scripts/worker-agent.sh start` only. `RunAtLoad` starts it; do not also kickstart.

## Backup

Take a backup only when a later write was approved, and only after the writers above are stopped. Use the SQLite backup API so a WAL is included. Check integrity on the copy. Do not delete older backup folders.

## Additive migration

Use the existing script for that change, with an absolute database path. `scripts/apply-results-processing-schema.ts` adds `resultsProcessing` and refuses every other catalog. Rehearse it on a copy first. A second run on an already matching catalog prints `already applied`. Do not use `prisma db push`, `--force-reset`, `--accept-data-loss`, or a table rebuild on the live file.

## Rollback

Turn the round's result switch off on the round page. That needs no restart. To stop every result line, remove `WORKER_RESULTS_ENABLED` and restart the worker once. Do not restore the database automatically. A score a live check already wrote stays until an operator uses Fix or rollback on that fixture.

## Arm the worker flag

Run `npm run worker:plan` first. Restart the worker with `WORKER_RESULTS_ENABLED=1` only when that plan shows the prediction line is not due. The flag is read at process start. `results=true` on the worker start line is the confirmation. `results-disabled` means the flag is off. `round-switch-off` means the flag is on and that round's column is false.

## Enable a round's result switch

Use the round page. The click writes `resultsProcessing` and a `results-processing` closure event with actor `local-admin`. It does not fetch. Rounds 14 and 15 are closed, so the control is hidden there. A round started after the column exists is set true by Start production. An already-started round keeps its stored value until the page is used.

## Read `worker:plan`

`npm run worker:plan` prints one line per job and writes nothing. Plan mode returns before the instance claim. A `run` line in that printout is a prediction of the planner, not a fetch that happened.

## `results:observe`

```sh
npm run results:observe -- --database /absolute/copy.db --round 16
```

The path must be absolute. The script opens SQLite with `mode=ro` and `PRAGMA query_only = ON`. Use a copy when the point is a rehearsal. Do not point it at the live file unless that read was explicitly approved, and do not treat a rehearsal as a live poll.
