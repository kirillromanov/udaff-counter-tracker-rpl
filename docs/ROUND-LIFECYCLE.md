# Round lifecycle

Four stored ideas stay separate. Mixing them up is how a Draft label was mistaken for "not started" and a closed round was shown as Production.

| Idea | Storage | Label |
| --- | --- | --- |
| Role | `standingRole` | Archived reference, or an operational round |
| Activation | `productionStartedAt` | Preparing / Not started when null; otherwise eligible for production |
| Calculation layer | `status` plus stored `RoundScore` rows | Draft, Confirmed round, Imported raw, Reference total, and the other strings from `roundLayerLabel` |
| Lock | `closedAt` and `closureLog` | Closed when `closedAt` is set |

`productionLockLabel` is the shared Status badge on the season Rounds table and the round pages. The season column that used to say Layer is titled Calculation.

## Transitions that exist

```text
Preparation → Start production → Production → Close round → Closed
Closed → Re-open production → Production
```

There is no deactivate or return-to-preparation action. A new operational round is created with `productionStartedAt` null (`createRoundAction`). Existing operational rows were backfilled to `createdAt` by `scripts/backfill-production-started.ts` so they stayed in production. That backfill does not write a `started` event. Archived rows stay null.

## Permission matrix

| Action | Preparing | Production | Closed | Archived reference |
| --- | --- | --- | --- | --- |
| Save URL, edit fixtures, fetch and parse, review, correct cells | Allowed | Allowed | Rejected before the write | Allowed as reference work |
| Due comment refresh and due result poll | Skipped | Eligible when a button or npm script runs | Skipped, including a forced id | Skipped unless a result poll is forced for that round |
| Calculate and store `RoundScore` | Allowed, but the round is outside official totals | Allowed | Rejected | Allowed for reference snapshots; excluded from production totals |
| Export | Allowed | Allowed | Allowed | Allowed |
| Start production | Shown. Requires a saved URL, at least one fixture, and at most one Match of the Round | Idempotent if already started | Rejected | Rejected |
| Close | Rejected until production has been started | Allowed | Idempotent; keeps the original timestamp | Rejected |
| Re-open | Not closed | Not closed | Clears `closedAt` only | Rejected |

Start does not require a prediction for every participant or every fixture, and it does not require actual results or a stored calculation. `planStart` in `src/lib/domain/rounds/round-lock.ts` checks only role, lock, URL, fixture count, and Match of the Round count.

The Start and Close buttons share `hasUnsavedFieldEdits` in `src/lib/domain/results/refresh-status.ts`. Empty, null, and placeholder cells compare equal, so a saved missing prediction is not an unsaved edit. A real dirty control blocks the submit and tells the operator to save or cancel.

## What the actions do not do

`startProductionRound` updates `productionStartedAt` and appends one `started` event inside a transaction. A conditional `updateMany` keeps a second concurrent request from writing a second event. It does not fetch, parse, calculate, or reset retry counters.

`closeProductionRound` and `reopenProductionRound` change `closedAt` and the log only. Re-open leaves `productionStartedAt` set, so the round returns to Production without another Start. Neither action recalculates.

After Start, the round is eligible for the next invocation of the existing due functions. Nothing in the Next.js process invokes those functions on a timer. The button copy says the next check follows the current kickoff schedule. That schedule is real (`FIRST_CHECK_MINUTES` is 120, then `AUTO_RETRY_MINUTES` is 5, up to `MAX_AUTO_ATTEMPTS` of 10). The invocation is not automatic until someone runs the button or the npm script. See [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

## Server guards

`assertRoundMutable` reads `closedAt` and throws `RoundClosedError` with the Russian operator message. Refresh, fixture creation, and other round writes call it before they parse or insert. `assertRoundMutableTx` repeats the read inside a write transaction so a close that commits first wins.

Season accounting does not use `closedAt`. `countsTowardProduction` uses role, round number, baseline cutoff, and activation. A closed started operational round remains in the total.

Tests: `src/tests/rounds/round-lock.test.ts` and `src/tests/rounds/production-activation.test.ts`.
