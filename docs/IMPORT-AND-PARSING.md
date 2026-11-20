# Import and parsing

## Fixture source

`chooseFixtureSchedule` in `src/lib/domain/forum/schedule-source.ts` is the chooser. `ensureRoundFixtures` in `src/lib/domain/import/ensure-fixtures.ts` is the only writer used by season import and by Refresh predictions.

Priority:

1. The article is `extractOpeningPost`: the `.post-bodycopy` region, stopped at the first `li#comment-{id}`. Block tags become line breaks. Sidebar markup outside that region is not the article.
2. The article is accepted only when it contains the standalone word "Абразцы", case-insensitively. Text between the heading and the first dated line is skipped. The block ends at the first non-empty line that is not a dated fixture line. Later sections are not scanned.
3. Each dated line must parse with `readFixtureLine` (same team, date, and Moscow rules as `parseFixtureSchedule`). A conflicting kickoff for the same pair, an unreadable dated line, or more than one Match of the Round rejects the whole article candidate. A length other than 8, or a missing Match of the Round, is a warning and does not reject the block. There is no extra hardcoded requirement that every round have eight matches.
4. If the article fails, the fallback is the earliest comment on the fetched post: smallest `postedAt`, then lowest comment id. Array order is not used. A heading in that comment uses the same block rule. Otherwise only dated lines in that comment are read, which is the older whole-text fallback limited to one comment.
5. The article list and the comment list are never merged. If both fail, `ensureRoundFixtures` throws before `createMany`, and Refresh predictions throws before `saveForumPost` and `parseStoredComments`.

Kickoff clocks without a zone are the forum site clock, UTC+3, and are stored as UTC instants once (`moscowWallClockToUtc`). A new comment permalink uses the same offset once (`normalizeOffsetlessPublication`). An explicit offset on a timestamp is kept and is not shifted again. Round 15's proven legacy `postedAt` values were corrected to that normalized instant. Comments on other rounds still have the older digit-as-UTC encoding and stay uncertain. Fetch time and import time are not the deadline. A saved calculation is displayed from its stored breakdown. Live selection on an open round does not treat a remaining legacy time as on time or late.

When fixtures are created and `sourceSnapshot` is empty, the snapshot stored is the schedule excerpt, not the whole page. `importNotes` records `Fixture source: article_body` or `Fixture source: first_comment_fallback`, the URL, the extraction time, the fallback reason when used, and the existing warnings. An existing fixture list returns immediately and is not replaced. An existing snapshot is not overwritten.

Tests: `src/tests/forum/schedule-source.test.ts`.

## Comments and prediction sets

`parseStoredComments` attaches score lines to stored fixtures. With zero fixtures, scored comments produce no prediction rows. That is the "comments exist but the review table is empty" failure: the comments were stored, and the lines had no fixture id. Refresh predictions now calls `ensureRoundFixtures` before `parseStoredComments`. A closed round still fails before that bootstrap.

A line with teams but no score is kept so the cell can be filled in. Clocks, prices, and ordinary dashed sentences are skipped. `(МТ)` on a prediction does not change the official fixture flag. Manual edits are kept when the thread is parsed again.

Team names go through `normalizeTeamName`. Short forms such as `Динамо Мх` and `Кр Советов` are handled by the parser's alias list, not by a second schedule scanner.

## People

`src/lib/domain/participants/` stores one person and matches nicks after case, `ё`/`е`, spacing, and wrapping punctuation are folded. `Йош!` and `Йош` match. `Павел` and `Павел Абросимов` do not. Uncertain authors stay in review. An unresolved owner is not scored as a confirmed blank slip (`rosterIdsToScore`).

## Results

Adapters are listed in `RESULT_ADAPTERS` (`src/lib/domain/results/sources.ts`). Policy in `src/lib/domain/results/policy.ts`:

- Preferred: `sport-ru`
- Fallback: `championat`, `sportbox`, `football-data`, `premierliga`
- Verification only: `understat`, `footbolno`

`SOURCE_RANK` gives premierliga weight 100, sport-ru 80, football-data 70, championat 45, sportbox 40, understat 35, footbolno 25. Verification sources cannot accept a score by themselves. A disagreement between official-strength sources stays in review. `FOOTBALLDATA_API_KEY` empty skips that adapter. The key belongs in `.env` and must not be committed.

Result polling stops for a fixture when it is verified, manually set, acknowledged, postponed or cancelled, or when 10 attempts are used. The first result attempt is kickoff plus 120 minutes. Result retries are 5 minutes apart. A new kickoff starts a new result budget. Prediction refresh does not consume that budget. Its due time is `nextPredictionFetchAt`. Null means an active round is due. A set interval moves that field forward after an attempt. A comment at or after a fixture kickoff is stored and parsed, and that fixture's line is left out of the scoring slip. A later eligible comment replaces only the fixtures it contains. A manual selection stays the whole scoring slip. An edit replaces a fixture only when the comment metadata has one edit time before that kickoff. An edit without that time is flagged and leaves the stored predictions. The warning follows a difference between the current comment body and the text the slip was parsed from. A stored `updated` label is not that evidence. The reply form and the comment-list wrapper are outside the body; markup inside a comment paragraph stays in the extracted text. `refreshRoundPredictions` does not write scores. `refreshRoundResults` does, for that round, and then rebuilds later operational snapshots from stored scores plus the unchanged manual baseline.

## Provenance and duplicates

Batch import still compares full opening texts in memory to warn when two rounds share the same article text. That comparison is not a second network fetch. Re-import does not replace fixtures that already exist and does not overwrite `importNotes` unless the bootstrap created fixtures on that call.
