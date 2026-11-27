# Glossary

Terms below are the ones the code and the admin pages use. A chat summary is not a definition.

| Term | Meaning |
| --- | --- |
| Preparation | `productionStartedAt` is null. The round stays out of automatic prediction and result jobs and out of the official season total. |
| Started / Production | `productionStartedAt` is set. Status on the round page comes from `productionLockLabel`. |
| Provisional | One finished source agrees with itself. `resultProvenance` is `one-source`. It is not a verified score. |
| Verified | Two different source ids report the same full-time score. `resultProvenance` is `two-source`. Disagreement does not pick a third score. |
| Closed | `closedAt` is set. Server writes are rejected before parsing. Close is not the same as preparation. |
| Archived | `standingRole` is `archived`. Historical rounds 1–13 are archived and scored. They are not closed, and their `productionStartedAt` is null. |
| Operational | `standingRole` is `operational`. Rounds 14, 15, and 16 are operational. |
| Draft | The calculation label from `roundLayerLabel` when an open round has no stored `RoundScore`. It does not mean preparation. |
| Parse predictions | Reparses comments already stored for that round. It does not download the forum page. |
| Refresh predictions | Downloads the forum page, stores comments, then parses. The worker's prediction line is this job. |
| Start production | Sets `productionStartedAt` and writes a `started` closure event. It does not fetch or parse. For a round that is actually started after `resultsProcessing` exists, the same transaction sets that column true. |
| Result switch | `Round.resultsProcessing`. The round page turns it on or off. The worker reads it every cycle. |
| Kill switch | `WORKER_RESULTS_ENABLED`. Read once, when the worker process starts, and only if `WORKER_ENABLED` is also `1`. Editing `.env` does nothing until that process restarts. |
| Observe | `npm run results:observe`. Prints a would-be score from a read-only database open. It writes no match, observation, log, health, score, or audit row. |

The deadline for a prediction is the comment's publication or edit time against that fixture's kickoff. Parse time is not the deadline. See [decisions/008-per-fixture-deadline.md](decisions/008-per-fixture-deadline.md).
