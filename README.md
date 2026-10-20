# udaff-counter-tracker-rpl

Local-first admin for a football prediction contest. This phase contains the data model, a pure scoring engine, tests, and demo seed data. The admin UI is a placeholder.

## Requirements

- Node.js 22+
- npm

## Setup

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npx prisma db seed
```

`DATABASE_URL` defaults to `file:./dev.db`. Prisma resolves that path relative to `prisma/`, so the SQLite file is `prisma/dev.db`.

Equivalent npm scripts:

```bash
npm run db:generate
npm run db:push
npm run db:seed
```

Re-running the seed clears the existing seasons and participants, then loads the demo contest again.

## Scoring

Match points, bonuses, and the Match of the Round multiplier live in [`src/lib/config/scoring.ts`](src/lib/config/scoring.ts). The engine in `src/lib/domain/scoring` is pure: it does not import Prisma or React.

- `scoreMatch` classifies one prediction and returns a point breakdown.
- `scoreRound` sums match points, adds the round total-goals bonus, and counts categories.
- `buildSeasonStandings` ranks a season and compares the latest round with the ranking before it.

A neighbor is the same outcome and the same signed goal difference, with both teams shifted by exactly one goal. `1-0` against `2-1` is a neighbor. `2-0` against `4-2` is the same goal difference, but not a neighbor.

Match bonuses apply only to rewarded categories (`exact`, `neighbor`, `diff`, `outcome`) unless `bonusesRequireRewardedBase` is turned off. A `0-0` result awards +2 instead of the +1 zero-total bonus. The Match of the Round multiplier also applies to a negative score unless `mtAppliesToNegative` is turned off.

## Tests

```bash
npm test
```

Vitest covers score categories, bonuses, the Match of the Round multiplier, round totals, and season movement. The tests do not need the database.

## App

```bash
npm run dev
```

Open `/` and `/admin`. Both pages are placeholders for later phases.
