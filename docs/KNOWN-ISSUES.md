# Known issues

## Open

- **Next.js 16.4.2 advisories are patched in 16.4.5.** That patch does not clear the two remaining audit groups.
- **Two audit groups remain, and neither is a forum-import bug.** `npm audit` reports ten entries. They are [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) (`deepmerge-ts` 7.1.5 through the Prisma 6 CLI) and [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (`minimatch` 10.2.6 through TypeScript ESLint 8.72.0). There is no patched Prisma 6 release; the latest 6.19.3 is still affected, and the audit fix is Prisma 7.10.1. The ESLint finding has a compatible later 8.73.0 release that was not installed. Details and the reachability limits are in [SECURITY.md](SECURITY.md). Neither finding is a reason to delay a scheduler by itself.
- **No authentication.** The local service binds `127.0.0.1` only. Anyone who can open that address on this Mac can use the admin. There is still no login. A future host that runs `next start` without `--hostname` listens on `0.0.0.0`. See [SECURITY.md](SECURITY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
- **Prediction refresh is supervised, and result checks are off.** The live environment has `WORKER_ENABLED=1` and `PREDICTION_REFRESH_INTERVAL_MINUTES=60`. `WORKER_RESULTS_ENABLED` is unset. The supervised loop rechecks persisted due times at most every 60 seconds. That recheck is not a forum poll. A sleeping Mac is not woken for it. See [OPERATIONS.md](OPERATIONS.md).
- **The first unattended fetch kept the existing prediction rows.** At 10:34 UTC+3 on 2026-11-20 the worker fetched round 15 and stored 20 unchanged comments. All 91 prediction ids and all 14 set ids stayed. The earlier stored-`new` rewrite from the pre-fix cycle was not restored. Comments 5707 and 5713 stayed flagged. See [IMPORT-AND-PARSING.md](IMPORT-AND-PARSING.md).
- **Round 15 comments 5707 and 5713 remain pending review.** Their slips differ from the current body and have no edit time, so the prediction rows stayed. 5701's false `flagged` label was set back to `unchanged` after its body matched the slip. The parser-review queue follows set status, which stayed accepted, so the visible warning is the comment badge and note. See [IMPORT-AND-PARSING.md](IMPORT-AND-PARSING.md).
- **Historical publication times stay on the legacy encoding.** Archived and closed rounds still display the stored breakdown. Their source comments were not shifted. A legacy offset-less `postedAt` on an open round stays time-uncertain. Round 15 is the exception: its 14 proven legacy comment times were corrected to the normalized UTC instant. See [decisions/008-per-fixture-deadline.md](decisions/008-per-fixture-deadline.md).
- **Schema history.** There is no `prisma/migrations` directory. A new environment is `db push` plus, for an existing operational database, `scripts/backfill-production-started.ts` if `productionStartedAt` is still null. Running the backfill twice is safe. Running `db:seed` is not.
- **The running checkout can lag `main`.** Pull request #12 put the verified source on `main`. That merge does not switch the serving checkout, rebuild `.next`, or restart the LaunchAgent. Do those only when the operator asks. See [OPERATIONS.md](OPERATIONS.md).
- **Two manual checkpoints can exist.** Loaders use the latest `source = manual` row by `afterRoundNumber`. An older checkpoint remains stored and is not the production baseline.

## Documented behavior that is easy to misread

- Calculation label Draft on an open round with no `RoundScore` rows means the calculation has not been stored. It does not mean preparation. Status Production comes from `productionStartedAt`.
- `preliminary` on a review total means no stored round total and fixtures that are not all verified. It does not mean the slip failed to parse (`cleanMatrixTotalLabel`).
- Comments with no fixtures produce no prediction rows. The repair is fixture bootstrap, not a rescore.
- New comment permalinks and the corrected round-15 times are UTC instants. Older comments still store the permalink minute as if it were UTC. Fixture kickoffs are Moscow wall time converted to UTC.

## Not implemented

- Return to preparation after Start.
- A signed-in actor on close, reopen, or start.
- A forum edit time when the theme HTML has only the permalink timestamp. Those edits stay in review.
- Automatic polling inside the Next.js process.
- Public deployment, TLS, and authenticated admin.
