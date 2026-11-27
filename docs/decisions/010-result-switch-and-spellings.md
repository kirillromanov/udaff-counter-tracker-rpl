# Per-round result switch and team spellings

## Context

Prediction intake for a started round has to keep running while result checks stay off until a round is ready. The live SQLite file already has production rows. `prisma db push` has proposed a `Match` rebuild for an earlier column change, so a new column cannot go through that command on the live file.

Round 16's Lokomotiv fixture stores the away club as `Динамо Мx`. The last letter is Latin `x` (`U+0078`). The key is `динамо мx`. That is a different key from `Динамо Мх` and from `Динамо Махачкала`.

## Decision

`Round.resultsProcessing` is a boolean, default false, added by `scripts/apply-results-processing-schema.ts` as one `ADD COLUMN` in one transaction. The worker runs a result line only when `WORKER_ENABLED` and `WORKER_RESULTS_ENABLED` are both exactly `1` at process start and the column is true. The page turns one round on or off without a restart. Start production sets the column true only for the round it actually starts.

`teamKey` strips punctuation and symbols, including the trademark sign, before NFKC. NFKC would otherwise turn `™` into the letters `TM` and glue them to the previous word. Latin letters are not rewritten as Cyrillic. Similarity is only the fallback after an exact key miss, and two fixtures within 0.05 are left unmatched. `dynamoCross` blocks Moscow markers against Makhachkala markers. It does not treat every longer Dynamo name as a different club.

`ENGLISH_CLUBS` still maps the English Makhachkala names to `Динамо Махачкала`. The saved alias on the stored Latin-x name is what reaches that fixture. Krylia's English names map to `Крылья Советов`, which matches that fixture directly.

`npm run results:observe` is a separate read-only command so a rehearsal does not write a score.

## Consequences

Turning the flag on does not turn a round on. Turning a round on does not fetch by itself. A result line that is not yet due stays `not-due`. Closed, archived, preparation, and rounds before 16 stay excluded for their existing reasons.

Saved spellings attach a source name to the stored fixture. They do not change the stored fixture string. Parse predictions is still a separate action after a spelling save.

## Alternatives considered

A global fold of Latin `x` to Cyrillic `х` would attach `Динамо Мx` and `Динамо Мх` to each other and would also attach other lookalike pairs. That was rejected.

Putting the switch only in the environment would force a worker restart for one round and could not leave round 16 off while a later round is on. Putting it only on the round would leave no way to stop every result line without editing each round. Both gates stay.
