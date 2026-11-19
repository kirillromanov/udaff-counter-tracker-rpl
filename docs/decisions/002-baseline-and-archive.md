# Baseline and archive

Recorded 2026-11-19 from `src/lib/domain/standings/round-role.ts` and `src/lib/domain/scoring/production-standings.ts`.

`StandingsCheckpoint` rows with `source = manual` are the trusted table. Loaders take the latest such checkpoint by `afterRoundNumber`. Calculated snapshots are a different table.

`standingRole = archived` keeps a round out of production totals even if it has scores. Operational rounds at or before the baseline number also stay out, so those points are not added twice. Preparation rounds stay out because `productionStartedAt` is null. A closed operational round that has been started still counts.

Do not recompute historical rounds in order to refresh documentation.
