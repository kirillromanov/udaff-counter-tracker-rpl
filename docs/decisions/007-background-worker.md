# Separate disabled worker

Recorded 2026-11-20. The Next.js process still has no timer. `scripts/worker.ts` is a second process. It is not started by `scripts/dev-up.sh` or by `npm start`.

`WORKER_ENABLED` must be exactly `1` before a cycle fetches anything. The supervised loop also requires `WORKER_SCAN_MINUTES`. There is no default that turns processing on.

The worker calls `refreshRoundPredictions` for rounds `selectDuePredictionRoundIds` already selects. It does not call `pollDueRounds` or `recalculateRound`. Those result functions already persist scores, and automatic scoring was not approved.

Prediction timing stays on `nextPredictionFetchAt`. A null value means due while the round is active. Result timing stays kickoff plus 120 minutes, then 5 minutes, for at most 10 attempts. Until a result check advances that clock, a prediction refresh whose next time is already in the past waits `WORKER_SCAN_MINUTES`. The proposed value is 60. A failed fetch waits at least the existing 5-minute gap and does not reset `autoCheckAttempts`.
