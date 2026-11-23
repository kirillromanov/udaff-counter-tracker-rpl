# Deployment

Nothing in this repository deploys to a server. The only running arrangement is a per-user LaunchAgent on the operator's machine. Do not treat a GitHub push as a production release.

A future host has four separate steps. Completing one does not complete the others.

## 1. Source

The intended Git remote is `https://github.com/kirillromanov/udaff-counter-tracker-rpl`. Pull request #12 put the verified application and documentation on `main` at `4bdf8a1512b77b8442a9198a9b34006e6d27e266`. New work starts from current `main`. Updating the process that is already running is a separate step from merging that source.

A clone has source, schema, tests, and the lockfile. It does not have `prisma/dev.db` or `.env`.

## 2. Secrets

Create `.env` on the host from `.env.example`. Set `DATABASE_URL` to a path on persistent disk. Set `FOOTBALLDATA_API_KEY` only if that source should be used. Do not bake the file into the image or the git remote.

## 3. Persistent data

Provision an empty SQLite file with `npm run db:generate` and `npm run db:push`, or copy a verified backup into place and run an integrity check. `db:push` has no migration history to replay. `npm run db:seed` deletes seasons and participants; it is not a production step.

Transferring the current season means restoring a backup taken with `sqlite3 .backup`, not cloning GitHub. Recalculating or re-importing is a separate decision and is not part of copying the file.

## 4. Process

Run one `next start` after one `next build`. Do not also run `next dev` on the same port. Do not start a second copy of the LaunchAgent. The local agent passes `--hostname 127.0.0.1`. A different host chooses its own hostname. This repository does not set that choice.

There is no in-process poller. A separate worker can refresh predictions when `WORKER_ENABLED=1` and `PREDICTION_REFRESH_INTERVAL_MINUTES` is set. Result checks also need `WORKER_RESULTS_ENABLED=1`. Do not add a cron entry as well. The worker LaunchAgent is not loaded by deploying the web server. See [OPERATIONS.md](OPERATIONS.md).

A worker-only source change does not require a web rebuild. Stop the worker with `zsh scripts/worker-agent.sh stop` before updating the checkout it runs from, so an old process does not refresh during the update. Fast-forward that checkout, run `zsh scripts/worker-agent.sh install` to rewrite the plist, then `zsh scripts/worker-agent.sh start` once. `RunAtLoad` starts the process; do not kickstart it as well. A reboot starts this user agent only after that user logs in. `zsh scripts/worker-agent.sh stop` unloads it and leaves it stopped. Logs stay at `~/Library/Logs/udaff-counter-tracker/worker.log`. Missing `.env` or `node_modules` exits 1 and is retried after the 60-second throttle, not reported as a healthy exit.

## Result verification deploy, not performed

This order is a plan. None of it has been done.

1. Not performed. Take a SQLite backup of the live database and check its integrity. Do not restore it as part of this plan.
2. Not performed. Stop the prediction worker with `zsh scripts/worker-agent.sh stop`. Leave `WORKER_RESULTS_ENABLED` unset.
3. Not performed. Fast-forward the serving checkout to the reviewed commit. Do not seed, and do not use `--accept-data-loss` or `--force-reset`.
4. Not performed. Apply the additive schema with `npx prisma db push` against that database only. The new columns default to empty, false, or zero, and `firstSeenAt` stays null. If this step fails, stop. Do not start the web server or the worker on the new source. The previous database file is unchanged if the push did not finish; if it did finish and the following build fails, the new columns can stay because existing result values are not rewritten. Restore the backup only if a later check shows a stored score, status, or observation changed.
5. Not performed. Build with the live `DATABASE_URL` only for the running server's own file, then restart one `next start` with `--hostname 127.0.0.1 --port 3000`.
6. Not performed. Start one prediction worker with `zsh scripts/worker-agent.sh start`. Do not enable result processing.
7. Not performed. Read back one closed round and the active round. Stored scores, statuses, prediction ids, and the warnings on comments 5707 and 5713 must match the backup. New source-observation times stay empty on old rows.

The admin process listens on `127.0.0.1:3000`. `scripts/dev-up.sh` passes `--hostname 127.0.0.1` because Next's default is `0.0.0.0`. A listener check on this machine showed `node` bound to `127.0.0.1:3000` only.

## Not done

- Authentication
- TLS
- A chosen bind address for a non-local host
- Off-machine backups
- A process supervisor other than the local LaunchAgent
- The Next.js security upgrade

Those are prerequisites for any network deployment. They are not implemented here.
