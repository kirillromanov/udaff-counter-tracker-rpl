# Production activation

Recorded 2026-11-19 from `productionStartedAt` on `Round` and `planStart`.

Activation is its own timestamp. It is not `status`, not `standingRole`, and not the absence of `RoundScore` rows. Null means preparation. A new operational round is created null. Operational rows that already existed were set to `createdAt` by `scripts/backfill-production-started.ts` without a `started` log event.

Start production persists the timestamp and one log event. It does not fetch or calculate. Re-open does not clear the timestamp. There is no action that returns a round to preparation.
