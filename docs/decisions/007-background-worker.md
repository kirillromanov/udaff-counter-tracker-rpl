# Separate disabled worker

Recorded 2026-11-20. The Next.js process still has no timer. `scripts/worker.ts` is a second process. It is not started by `scripts/dev-up.sh` or by `npm start`.

`WORKER_ENABLED` must be exactly `1` before a cycle fetches anything. Prediction fetches also require `PREDICTION_REFRESH_INTERVAL_MINUTES`. Result fetches also require `WORKER_RESULTS_ENABLED=1`. There is no default that turns processing on.

The worker calls `refreshRoundPredictions` for rounds `selectDuePredictionRoundIds` already selects. Result checks call `refreshRoundResults` only when `WORKER_RESULTS_ENABLED` is also `1`. That flag is off. `WORKER_ENABLED` alone does not fetch results or store scores.

`nextPredictionFetchAt` is the prediction clock. A successful or failed attempt moves it forward by `PREDICTION_REFRESH_INTERVAL_MINUTES` when that variable is set. There is no default. The accepted initial value is 60 minutes. It is not configured, and setting it later does not by itself replace a time already stored. Result attempts stay on the fixture fields: kickoff plus 120 minutes, then 5 minutes, at most 10. A prediction refresh does not change those fields.

The same claim directory is `WORKER_LOCK_DIR`. The live web process sets it to the absolute path of `~/Library/Application Support/udaff-counter-tracker/worker-locks`. Do not enable the worker while post-kickoff acceptance is undecided.
