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

The database provider is SQLite, set in `prisma/schema.prisma`. There is no `prisma/migrations` directory. Schema changes are applied with `npm run db:push`.

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

There is no timer, cron, or `setInterval` in the application. `pollDueRounds` and `refreshDuePredictions` run only when an admin action or `scripts/poll-results.ts` / `scripts/refresh-predictions.ts` calls them.

The LaunchAgent in [OPERATIONS.md](OPERATIONS.md) starts the web server. It does not start a second poller. Running those npm scripts by hand while the server is up is a second writer, not a second scheduler process. Avoid two servers on port 3000; `scripts/dev-up.sh --service` leaves an already healthy server in place.

Due selection is in `selectDueRoundIds` and `selectDuePredictionRoundIds`. Both skip a closed round. Prediction refresh also returns inactive while `productionStartedAt` is null. Result due selection skips a non-archived round with a null timestamp even if a caller passes a force id. Archived rounds are skipped unless a result poll is forced for that id.

## Cache

Server actions call `revalidatePath` for the round hub, review, fixtures, results, export, and the season list. Start, close, and reopen use that season invalidation. A read-only page load does not write fixtures or scores.

## Read and write boundary

Exports and standings pages read. Mutation actions go through `assertRoundMutable` in `src/lib/domain/rounds/round-lock-db.ts`, which throws when `closedAt` is set. Start, close, and reopen are the exceptions and use their own transactions. Fixture creation checks the lock before parsing the schedule.
