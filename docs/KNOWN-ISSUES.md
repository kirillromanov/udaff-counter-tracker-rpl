# Known issues

## Open

- **Next.js advisory.** `next build` on 16.4.2 stops once with `SecurityFatalError` and tells the operator to run `next upgrade`. Repeating the build completes compilation. The retry does not change the Next.js version. The advisory is unresolved. Do not describe a successful retry as a patch. A clean `npm ci` on 2026-11-19 also reported 11 audit findings (8 moderate, 3 high). Those findings were not patched and were not mapped one-by-one to the Next.js advisory.
- **No authentication and a wide bind.** The admin is open to anyone who can reach the process. `next start --port 3000` listens on all interfaces. Acceptable only as a local admin. Not acceptable as a public service. See [SECURITY.md](SECURITY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
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
