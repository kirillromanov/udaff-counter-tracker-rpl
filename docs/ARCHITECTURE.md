# Architecture

## Stack

Verified from `package-lock.json` at the documentation checkpoint:

| Piece | Version |
| --- | --- |
| Node.js used locally | 24.19.0 (README requires 22+) |
| npm | 11.17.0 |
| Next.js | 16.4.5 |
| React | 19.3.0 |
| Prisma | 6.19.3 |
| Zod | 4.6.7 |
| Vitest | 5.0.5 |
| TypeScript | 5.9.3 |

The database provider is SQLite, set in `prisma/schema.prisma`. There is no `prisma/migrations` directory. A new empty database still uses `npm run db:push`. The live file uses the additive script for that change. `prisma db push` on the live file has proposed a table rebuild and is not the live path.

Next.js 16 in this repo is not the older App Router shape from training data. `AGENTS.md` points at `node_modules/next/dist/docs/`. Pages that read the database set `instant = false` and `await connection()` so they do not prerender live data.

## Boundaries

| Area | Path |
| --- | --- |
| Admin UI and server actions | `src/app/admin/` |
| Forum HTML and fixture source choice | `src/lib/domain/forum/` |
| Comment storage, parse, and refresh | `src/lib/domain/import/` |
| Slip parsing | `src/lib/domain/parser/` |
| Pure scoring | `src/lib/domain/scoring/` and `src/lib/config/scoring.ts` |
| Round totals, baseline, live and clean tables | `src/lib/domain/standings/` |
| Result sources and due selection | `src/lib/domain/results/` |
| Close, reopen, and start | `src/lib/domain/rounds/` |
| People and aliases | `src/lib/domain/participants/` |
| One-shot commands | `scripts/` |
| Prisma client | `src/lib/db/prisma.ts` |

Scoring functions do not import Prisma. Loaders and actions do.

## Data flow

1. `fetchForumPost` in `src/lib/domain/forum/fetch-post.ts` downloads one page. `fetchForumThread` follows comment-page links when a caller uses it. The prediction refresh path uses the single-page fetch.
2. `extractForumPost` splits the article body from `li#comment-{id}` nodes.
3. `ensureRoundFixtures` creates matches only when the round has none. See [IMPORT-AND-PARSING.md](IMPORT-AND-PARSING.md).
4. `saveForumPost` stores comments. `parseStoredComments` builds prediction sets and attaches lines to fixtures. Lines with no fixture are dropped.
5. The operator selects, edits, or corrects sets on the review page. Saved cells win over a later parse of the same slip.
6. Result adapters in `src/lib/domain/results/sources.ts` fetch public pages. `decideFixture` classifies agreement. Verified or manual scores are what a stored calculation uses.
7. `recalculateRound` scores the roster through `scoreRound` and writes `RoundScore`. `build-season-standings.ts` writes `StandingSnapshot` rows.
8. Live and clean season pages recompute a view on read. They do not replace the manual checkpoint.

## Scheduler

There is no timer, cron, or `setInterval` in the Next.js process. `pollDueRounds` and `refreshDuePredictions` run when an admin action or `scripts/poll-results.ts` / `scripts/refresh-predictions.ts` calls them.

`scripts/worker.ts` is a separate process. It loads `.env` once at process start. It is disabled unless `WORKER_ENABLED=1`. One supervised process plans a prediction line and then a result line for each round. Prediction timing is `nextPredictionFetchAt`. The result line also needs `WORKER_RESULTS_ENABLED=1` at that start and `Round.resultsProcessing` true on that round. The web LaunchAgent does not start the worker. See [OPERATIONS.md](OPERATIONS.md), [RUNBOOK.md](RUNBOOK.md), and [decisions/007-background-worker.md](decisions/007-background-worker.md).

## Result path

`RESULT_ADAPTERS` in `src/lib/domain/results/sources.ts` lists seven sources. Sport.ru is primary. Championat, Sportbox, football-data, and Premier Liga are fallbacks. Understat and Footbolno are verification. `decideFixture` calls a score provisional from one finished source id and verified when two different ids report the same full-time score.

`attachResults` matches a source name by `teamKey` against the fixture name or a saved `TeamNameAlias`. Similarity runs only after no exact hit. An ambiguous pair is not guessed. `recalculateRound` runs when a result write changes goals. Season snapshots rebuild only when the round is complete. `ResultAudit` is written by operator Fix or rollback, not by the automatic check.

The first automatic check is `FIRST_CHECK_MINUTES` (120) after kickoff. A retry waits `AUTO_RETRY_MINUTES` (5), up to `MAX_AUTO_ATTEMPTS` (10). Those constants are in `src/lib/domain/results/poll.ts`.

## Attribution

`matchTokens` in `src/lib/domain/parser/normalize.ts` removes punctuation and symbols before NFKC, so a trademark sign is not glued onto the previous word. Latin letters stay Latin. `isBalbesMarker` and the `мну` marker in `src/lib/domain/parser/attribute-blocks.ts` apply only inside a comment by neofit. Two different people in one header are a review flag, not a guess. The prediction deadline is the comment's publication or edit time, not the parse time. See [GLOSSARY.md](GLOSSARY.md).

Running the npm scripts by hand while the server is up is another writer. The worker's claim file stops a second worker. An admin request shares that claim only when the server process has the same `WORKER_LOCK_DIR`. Avoid two servers on port 3000; `scripts/dev-up.sh --service` leaves an already healthy server in place.

Due selection is in `selectDueRoundIds` and `selectDuePredictionRoundIds`. Both skip a closed round. Prediction refresh also returns inactive while `productionStartedAt` is null. Result due selection skips a non-archived round with a null timestamp even if a caller passes a force id. Archived rounds are skipped unless a result poll is forced for that id.

## Cache

Server actions call `revalidatePath` for the round hub, review, fixtures, results, export, and the season list. Start, close, and reopen use that season invalidation. A read-only page load does not write fixtures or scores.

## Read and write boundary

Exports and standings pages read. Mutation actions go through `assertRoundMutable` in `src/lib/domain/rounds/round-lock-db.ts`, which throws when `closedAt` is set. Start, close, and reopen are the exceptions and use their own transactions. Fixture creation checks the lock before parsing the schedule.
