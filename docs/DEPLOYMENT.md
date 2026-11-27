# Deployment

Nothing in this repository deploys to a server. The only running arrangement is a per-user LaunchAgent on the operator's machine. Do not treat a GitHub push as a production release.

A future host has four separate steps. Completing one does not complete the others.

## 1. Source

The intended Git remote is `https://github.com/kirillromanov/udaff-counter-tracker-rpl`. Pull request #12 put the verified application and documentation on `main` at `4bdf8a1512b77b8442a9198a9b34006e6d27e266`. New work starts from current `main`. Updating the process that is already running is a separate step from merging that source.

A clone has source, schema, tests, and the lockfile. It does not have `prisma/dev.db` or `.env`.

## 2. Secrets

Create `.env` on the host from `.env.example`. Set `DATABASE_URL` to a path on persistent disk. Set `FOOTBALLDATA_API_KEY` only if that source should be used. Do not bake the file into the image or the git remote.

## 3. Persistent data

Provision an empty SQLite file with `npm run db:generate` and `npm run db:push`, or copy a verified backup into place and run an integrity check. `db:push` has no migration history to replay. An existing database that already has the pre-change `Match` table uses `scripts/apply-result-verification-schema.ts` instead of `db push`. `npm run db:seed` deletes seasons and participants; it is not a production step.

Transferring the current season means restoring a backup taken with `sqlite3 .backup`, not cloning GitHub. Recalculating or re-importing is a separate decision and is not part of copying the file.

## 4. Process

Run one `next start` after one `next build`. Do not also run `next dev` on the same port. Do not start a second copy of the LaunchAgent. The local agent passes `--hostname 127.0.0.1`. A different host chooses its own hostname. This repository does not set that choice.

There is no in-process poller. A separate worker can refresh predictions when `WORKER_ENABLED=1` and `PREDICTION_REFRESH_INTERVAL_MINUTES` is set. Result checks also need `WORKER_RESULTS_ENABLED=1`. Do not add a cron entry as well. The worker LaunchAgent is not loaded by deploying the web server. See [OPERATIONS.md](OPERATIONS.md).

A worker-only source change does not require a web rebuild. Stop the worker with `zsh scripts/worker-agent.sh stop` before updating the checkout it runs from, so an old process does not refresh during the update. Fast-forward that checkout, run `zsh scripts/worker-agent.sh install` to rewrite the plist, then `zsh scripts/worker-agent.sh start` once. `RunAtLoad` starts the process; do not kickstart it as well. A reboot starts this user agent only after that user logs in. `zsh scripts/worker-agent.sh stop` unloads it and leaves it stopped. Logs stay at `~/Library/Logs/udaff-counter-tracker/worker.log`. Missing `.env` or `node_modules` exits 1 and is retried after the 60-second throttle, not reported as a healthy exit.

## Additive result schema, deployed

Completed on 2026-11-24. This record is separate from the instructions below. Do not repeat the migration or rebuild the serving checkout for a documentation change.

- Source revision `3bd98e758503a528910acb606b2a56f9c933c450`, the merge of pull request #32.
- Production build `seHUpIzJaQYzWLsPOGA-q` on Next.js 16.4.5. One web process listens on `127.0.0.1:3000`.
- One prediction worker is running with `WORKER_ENABLED=1` and a 60-minute interval. `WORKER_RESULTS_ENABLED` is unset, so result processing stays disabled.
- Round 16 was not created. Rounds 1–15 were not refreshed, recalculated, relabeled, or otherwise rewritten.
- The reviewed script was applied once to the live database by its absolute path. A second invocation printed `already applied`. Integrity and foreign-key checks passed. Original business-column hashes matched the fresh backup taken immediately before the change. New values stayed at the neutral defaults, and `ResultAudit` stayed empty. The follow-up Prisma diff was empty.
- `prisma db push` was not used on the live file. The `Match` rebuild was not run. The production build used a disposable database.

## Additive result schema instructions

These steps are the procedure for this kind of change. They were followed for the deployment recorded above. Do not run them again against the current live database.

Prisma's SQLite diff from the pre-change `Match` table builds a replacement table so `resultProvenance`, `manuallyCorrected`, and `resultVersion` sit before `resultNote`, copies the old rows, and drops `Match`. Those three columns are ordinary `ADD COLUMN` statements, and the same diff is empty afterwards. Do not run the rebuild.

1. Quiesce the existing supervisors. Stop the worker with `zsh scripts/worker-agent.sh stop`, then stop the web agent with `launchctl bootout gui/$(id -u)/com.udaff.counter-tracker`. Do not rewrite the plists and do not drop `--hostname 127.0.0.1`.
2. Take a new backup at this moment, from the absolute live file: `sqlite3 "file:/absolute/path/prisma/dev.db?mode=ro" ".backup '/path/outside/the/repo/dev.db'"`, then `PRAGMA integrity_check`. Record a private baseline of the stored rows. Do not reuse an older backup as the file to migrate. Do not restore that backup as an automatic recovery.
3. Fast-forward the serving checkout to the reviewed commit. Do not seed, and do not use `--accept-data-loss` or `--force-reset`. Do not run `npm ci` unless the lockfile changed.
4. Preflight the absolute database path. `scripts/apply-result-verification-schema.ts` does not read `DATABASE_URL` or `.env`. It refuses a relative path, a `file:` URL, a missing file, an empty file, and any schema that is not the complete reviewed start or the complete reviewed target. A refusal happens before a write, and a missing path is not created.
5. Apply `npx tsx scripts/apply-result-verification-schema.ts --database /absolute/path/prisma/dev.db`. The script adds the three `Match` columns, nullable `firstSeenAt` and `lastSeenAt`, and empty `ResultAudit` with its index and foreign key, in one transaction. A second run prints `already applied` only after the full target catalog matches. It does not write a Prisma migration history row. Do not run `prisma db push` or a diff that contains `DROP TABLE "Match"`.
6. Build with an explicit disposable `DATABASE_URL` when the build must not open the live file, then start one `next start --hostname 127.0.0.1 --port 3000` through the existing supervisor. Read the historical rounds. Compare them with the new baseline. Existing scores, ids, timestamps, warnings, baselines, and checkpoints must match. The new columns stay `''`, false, `0`, or null, and `ResultAudit` stays empty.
7. Start one prediction worker with `zsh scripts/worker-agent.sh start`. Leave `WORKER_RESULTS_ENABLED` unset. Before leaving it up, `npm run worker:plan` must show no prediction run for rounds 1–15. If one of those rounds is due, stop the worker and do not change a clock or a round lifecycle.

If the path preflight refuses, stop. The database was not opened for write. If a statement fails, the transaction rolls back and nothing is marked applied. Confirm the starting catalog and the private baseline, then leave both services stopped. Do not restore the backup automatically, do not drop a column, and do not rebuild `Match`. A partial or incompatible schema is refused and left as it was found.

## Team spellings schema, NOT performed

Do not run this against the live database until that step is approved. The parser change can be deployed only after this script, because the fixtures page reads `TeamName`. The script has not been run. No spelling was inserted. The live `6aJI6ec` nick was not added as a participant alias.

`scripts/apply-team-alias-schema.ts` creates empty `TeamName` and `TeamNameAlias` tables and their indexes. It does not read `DATABASE_URL` or `.env`. It takes `--database` as an absolute filesystem path, refuses any other catalog, and commits one transaction. A second run prints `already applied` only when the full target catalog matches. It does not rebuild `Match`, write a Prisma migration row, or update existing rows.

1. Stop only when a deployment is approved. Until then leave the web agent and the prediction worker running.
2. Take a new `sqlite3 "file:/absolute/live.db?mode=ro" ".backup …"` snapshot. Do not open the live file for writing. Prove the script on a copy of that snapshot first: original-column hashes unchanged, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, and an empty `prisma migrate diff` from the copy to `prisma/schema.prisma`.
3. Fast-forward the serving checkout to the reviewed commit. Do not seed and do not `db push` the live file.
4. Apply `npx tsx scripts/apply-team-alias-schema.ts --database /absolute/path/prisma/dev.db`.
5. Build with a disposable `DATABASE_URL`. Restart through the existing supervisors. Leave `WORKER_RESULTS_ENABLED` unset, the 60-minute prediction interval, and the shared lock directory as they are.
6. Do not start production on round 16 and do not reparse it as part of this schema step. Spellings affect only a later parse.

The admin process listens on `127.0.0.1:3000`. `scripts/dev-up.sh` passes `--hostname 127.0.0.1` because Next's default is `0.0.0.0`. The manual score actions are server actions on that same process, so they are not a second listener. A listener check on this machine showed `node` bound to `127.0.0.1:3000` only.

An isolated review instance uses another port and a new database file. Do not run it in the serving checkout, and do not point it at `prisma/dev.db`, the live `.env`, or the live worker lock directory. From a separate worktree:

```sh
export PATH="/usr/bin:/bin:/usr/local/bin:$PATH"
unset DATABASE_URL WORKER_ENABLED WORKER_RESULTS_ENABLED WORKER_LOCK_DIR PREDICTION_REFRESH_INTERVAL_MINUTES
dir=$(mktemp -d /tmp/udaff-review-XXXX)
export DATABASE_URL="file:${dir}/review.db"
export WORKER_LOCK_DIR="${dir}/locks"
npx prisma db push --skip-generate --accept-data-loss
node scripts/isolated-review-seed.mjs
npx next start --hostname 127.0.0.1 --port 3016
```

Stop it and remove that disposable directory. Use the path printed for `dir`. Do not delete any other database.

```sh
pid=$(lsof -nP -iTCP:3016 -sTCP:LISTEN -t)
kill "$pid"
rm -rf "$dir"
```

Do not use port 3000. Do not click Fetch results or Check due rounds during that review. Those buttons poll sources.

## Not done

- Authentication
- TLS
- A chosen bind address for a non-local host
- Off-machine backups
- A process supervisor other than the local LaunchAgent
- The Next.js security upgrade

Those are prerequisites for any network deployment. They are not implemented here.
