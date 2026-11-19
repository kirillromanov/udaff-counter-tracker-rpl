# Known issues

## Open

- **Next.js 16.4.2 advisories are patched in 16.4.5.** The affected range for the corroborated advisories ends at 16.4.4. `npm audit` on 16.4.2 reported two of them and offered `next@16.4.6`; 16.4.5 is the first patched release and has no further entries in the npm bulk advisory feed. 16.4.6 is a later bugfix release and was not required. Remaining `npm audit` findings are the Prisma 6 high advisory, whose fix is a Prisma 7 major upgrade, and a moderate `minimatch` advisory reached through TypeScript ESLint. Those were left in place. Loopback binding does not retire them.
- **No authentication.** The local service binds `127.0.0.1` only. Anyone who can open that address on this Mac can use the admin. There is still no login. A future host that runs `next start` without `--hostname` listens on `0.0.0.0`. See [SECURITY.md](SECURITY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
- **No timer.** Due comment and result checks run when an admin button or an npm script calls them. The Start production confirmation says the existing check can include the round on its next cycle. The eligibility and the kickoff timetable are implemented. A daemon that wakes up by itself is not. `scripts/dev-up.sh` only starts the web server. A read-only check on 2026-11-19 found no user crontab and no second LaunchAgent for the poll scripts.
- **Schema history.** There is no `prisma/migrations` directory. A new environment is `db push` plus, for an existing operational database, `scripts/backfill-production-started.ts` if `productionStartedAt` is still null. Running the backfill twice is safe. Running `db:seed` is not.
- **The running checkout can lag `main`.** Pull request #12 put the verified source on `main`. That merge does not switch the serving checkout, rebuild `.next`, or restart the LaunchAgent. Do those only when the operator asks. See [OPERATIONS.md](OPERATIONS.md).
- **Two manual checkpoints can exist.** Loaders use the latest `source = manual` row by `afterRoundNumber`. An older checkpoint remains stored and is not the production baseline.

## Documented behavior that is easy to misread

- Calculation label Draft on an open round with no `RoundScore` rows means the calculation has not been stored. It does not mean preparation. Status Production comes from `productionStartedAt`.
- `preliminary` on a review total means no stored round total and fixtures that are not all verified. It does not mean the slip failed to parse (`cleanMatrixTotalLabel`).
- Comments with no fixtures produce no prediction rows. The repair is fixture bootstrap, not a rescore.
- Forum comment clocks are stored without a zone conversion. Fixture kickoffs are Moscow wall time converted to UTC.

## Not implemented

- Return to preparation after Start.
- A signed-in actor on close, reopen, or start.
- Prediction deadlines beyond "latest scored comment".
- Automatic polling inside the Next.js process.
- Public deployment, TLS, and authenticated admin.
