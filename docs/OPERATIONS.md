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
| `npm run start` | `next start`. The local service adds `--port 3000` |
| `npm run dev` | `next dev` |
| `npm run local:install` | Writes a per-user LaunchAgent. The plist is outside the repo |
| `npm run local:service` | `scripts/dev-up.sh --service` |
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
| `RESULT_POLL_INTERVAL_MINUTES` | No | Default 60. Used when a due check is actually run |
| `RESULT_POLL_LIVE_INTERVAL_MINUTES` | No | Default 15 |

## Backup

The live file is `prisma/dev.db`. A consistent copy:

```bash
sqlite3 prisma/dev.db ".backup '/path/outside/the/repo/dev.db'"
sqlite3 /path/outside/the/repo/dev.db "PRAGMA integrity_check;"
```

Also copy `.env` to the same private directory if the machine must be rebuilt. Do not commit either file. A git bundle does not contain the database, `.env`, or uncommitted files.

Restore by stopping the server, replacing `prisma/dev.db` with the backup, and starting one server. Do not run seed after a restore.

## Local service

`scripts/install-launch-agent.sh` writes `~/Library/LaunchAgents/com.udaff.counter-tracker.plist`. The program is `scripts/dev-up.sh --service`, which runs `npm run start -- --port 3000` when nothing is already healthy on port 3000. `next start` listens on all interfaces. That is the current local binding, not a public deployment.

Restart without a second process:

```bash
launchctl bootout "gui/$(id -u)/com.udaff.counter-tracker"
# wait until port 3000 is free
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.udaff.counter-tracker.plist"
```

If a build is required, boot the agent out first, run `npm run build`, then bootstrap once.

## Isolated tests

`src/tests/rounds/production-activation.test.ts` runs `prisma db push` against a temporary SQLite file and passes that client into the functions. Other tests are pure and do not open `prisma/dev.db`. Do not point `DATABASE_URL` at the live file inside a new test.

## Publish routine

1. Inspect branch, status, and the live database.
2. Implement only the requested change.
3. Run the checks in [TESTING.md](TESTING.md) without seed, poll, or recalculate scripts.
4. Update `docs/` and `docs/handoff/CURRENT.md` when behavior changed.
5. Review the diff. Reject `.env`, databases, backups, logs, and `.next/`.
6. Commit the reviewed files.
7. Push the agreed branch with a normal push when it fast-forwards.
8. Fetch and compare the remote SHA.

This repository's configured remote is `https://github.com/kirillromanov/udaff-counter-tracker-rpl`. The working branch is not `main`. Do not force-push, and do not merge into `main` from an agent session unless the operator asked.

There is no commit hook in this repo that publishes or deploys.
