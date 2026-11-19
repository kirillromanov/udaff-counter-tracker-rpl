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

There is no in-process poller. If the host should check results without a person clicking the button, that scheduler does not exist yet. Adding cron for `npm run results:poll` would be a new operational decision. Until then, document that due work runs only when invoked.

## Not done

- Authentication
- TLS
- A chosen bind address for a non-local host
- Off-machine backups
- A process supervisor other than the local LaunchAgent
- The Next.js security upgrade

Those are prerequisites for any network deployment. They are not implemented here.
