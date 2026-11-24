# Domain and data model

The schema is `prisma/schema.prisma`. SQLite stores dates as integers. There is no `prisma/migrations` directory. `scripts/apply-result-verification-schema.ts` is the checked-in additive change for an existing database: `Match.resultProvenance`, `Match.manuallyCorrected`, `Match.resultVersion`, nullable `ResultObservation.firstSeenAt` and `lastSeenAt`, and `ResultAudit`. It does not rebuild `Match` or rewrite stored rows. It has not been applied to the live database. `scripts/backfill-production-started.ts` is the one data backfill that sets `productionStartedAt = createdAt` for operational rows that are still null.

## Season

`Season` owns rounds, roster rows, one scoring-config row, checkpoints, and standing snapshots. The default scoring numbers are in `src/lib/config/scoring.ts`. A season can store a different config, and loaders read that row when it exists.

## Participant

`Participant` is one person. Aliases and ignored authors live beside the registry in `src/lib/domain/participants/`. `SeasonParticipant.status` is the roster membership. Archive hides the person from the active registry. Scores already stored stay stored.

## Round fields that are easy to mix up

| Field | Meaning |
| --- | --- |
| `standingRole` | `operational` or `archived`. Archived rounds are reference data and stay out of production totals. |
| `productionStartedAt` | Null means preparation. A timestamp means production has been started. Re-open does not clear it. |
| `status` | Calculation completeness used by the Layer label: `draft`, `open`, `partial`, `scored`, `imported`, or `stale`. An open unscored round can already be in production. |
| `closedAt` | Operator lock. Null means writes are allowed. A closed operational round still counts in season totals. |
| `closureLog` | JSON events `{action, at}` for `started`, `closed`, and `reopened`. The app has no signed-in actor, so there is no user id. |
| `sourceSnapshot` | Excerpt stored for a fixture bootstrap when the snapshot was empty, or older full opening text from earlier imports. |
| `importNotes` | Warnings, and for a new bootstrap the source name, URL, time, and fallback reason. |
| `forumUrl` | Saved thread URL. Start production requires it. |

`roundLayerLabel` in `src/lib/domain/review/operator-status.ts` turns `status`, stored score rows, and role into the Calculation label. `productionLockLabel` in `src/lib/domain/rounds/round-lock.ts` turns role, `closedAt`, and `productionStartedAt` into Preparing / Not started, Production, Closed, or Archived reference.

## Match

One fixture: teams, Moscow kickoff stored as a UTC instant, sort order, and at most one `isMatchOfTheRound` flag enforced by application code. Actual goals and `resultState` are the result. `resultProvenance` is empty on existing rows. New automatic results use `one-source` or `two-source`. Fix score on Parser review uses `manual` and `manuallyCorrected`. A later fetch does not replace that score. An older `manual` row with empty provenance is left as stored. `resultVersion` rejects a correction that was looking at an older score. `ResultObservation.firstSeenAt` and `lastSeenAt` are null until a new fetch writes them. `ResultAudit` records a correction or a rollback and does not change source rows. Automatic attempt counters (`autoCheckAttempts`, `autoCheckNextAt`, `autoCheckHistory`) belong to the current kickoff and are not reset by Start, Close, or Re-open. A rollback that is waiting for another check sets the next attempt to that moment and does not fetch.

## Comments and predictions

`ForumComment` keeps raw HTML and plain text. `PredictionSet` is one slip for one participant. `selected` marks the slip that scoring uses. `Prediction` rows are cells. An empty cell is a missing prediction. A comment line that names no stored fixture is not stored as a prediction.

## Scores and standings

`RoundScore` is the stored calculation for one participant in one round. `StandingSnapshot` is the calculated table after a round. `StandingsCheckpoint` plus `StandingsCheckpointRow` is the hand-entered baseline and is not overwritten by calculation.

`countsTowardProduction` in `src/lib/domain/standings/round-role.ts` is true only for an operational round that is past the baseline round and whose `productionStartedAt` is not null. Callers that omit the timestamp still treat the round as started, which matches the backfill. Closed is not an argument: a closed started round still counts.

Historical snapshots and the live view are different. Snapshots are rows written by `build-season-standings.ts`. The clean and live loaders build a table for the page from the checkpoint plus eligible rounds. Reading a page does not rewrite the checkpoint.
