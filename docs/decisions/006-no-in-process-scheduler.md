# No in-process scheduler

Recorded 2026-11-19 from `scripts/dev-up.sh`, `scripts/poll-results.ts`, and the absence of a timer in `src/`.

Due selection is a function. It runs when an admin action or an npm script calls `pollDueRounds` or `refreshDuePredictions`. The LaunchAgent starts `next start` only.

Eligibility after Start production is implemented. A process that wakes itself on the kickoff timetable is not. Adding one would be a new operational component.
