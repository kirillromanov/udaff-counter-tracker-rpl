# Known issues

## Open

- **Next.js 16.4.2 advisories are patched in 16.4.5.** That patch does not clear the two remaining audit groups.
- **Two audit groups remain, and neither is a forum-import bug.** `npm audit` reports ten entries. They are [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) (`deepmerge-ts` 7.1.5 through the Prisma 6 CLI) and [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (`minimatch` 10.2.6 through TypeScript ESLint 8.72.0). There is no patched Prisma 6 release; the latest 6.19.3 is still affected, and the audit fix is Prisma 7.10.1. The ESLint finding has a compatible later 8.73.0 release that was not installed. Details and the reachability limits are in [SECURITY.md](SECURITY.md). Neither finding is a reason to delay a scheduler by itself.
- **No authentication.** The local service binds `127.0.0.1` only. Anyone who can open that address on this Mac can use the admin. There is still no login. A future host that runs `next start` without `--hostname` listens on `0.0.0.0`. See [SECURITY.md](SECURITY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
- **The worker is implemented and not enabled.** The accepted prediction interval is 60 minutes, and `PREDICTION_REFRESH_INTERVAL_MINUTES` is still unset. Configuring it does not rewrite an existing `nextPredictionFetchAt`. `WORKER_RESULTS_ENABLED` defaults off. The serving web process uses the shared claim directory. See [OPERATIONS.md](OPERATIONS.md).
- **The per-fixture deadline is not safe to merge yet.** Pull request #21 changes archived review cells and some live totals at read time. Stored breakdowns, audit exports, and scored season totals stay on the saved points. The forum permalink has no timezone; it is stored as a UTC minute. See [decisions/008-per-fixture-deadline.md](decisions/008-per-fixture-deadline.md).
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
- A forum edit time when the theme HTML has only the permalink timestamp. Those edits stay in review.
- Automatic polling inside the Next.js process.
- Public deployment, TLS, and authenticated admin.
