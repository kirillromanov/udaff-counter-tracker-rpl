# udaff-counter-tracker-rpl

Local admin for a football prediction contest. It imports a forum thread, reviews parsed predictions, records results, calculates a round, and exports standings. There is no login.

The canonical description of the running application is in [docs/INDEX.md](docs/INDEX.md). This file is only the entry point. Where this page and `docs/` disagree, `docs/` describes the code and [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) records the gap.

## Requirements

- Node.js 22 or newer
- npm
- The lockfile is `package-lock.json`

## Setup

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
```

`DATABASE_URL` defaults to `file:./dev.db`. Prisma resolves that path relative to `prisma/`, so the SQLite file is `prisma/dev.db`.

`npm run db:seed` deletes every season and participant, then loads a demo season. Do not run it against a database that already holds a real season. See [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Checks

```bash
npm test
npm run lint
npx tsc --noEmit
```

`npm run build` writes `.next/`. Do not run it while `next start` is using that directory. Tests do not need the live database; the activation test creates its own temporary SQLite file.

## Run

```bash
npm run dev
```

Open `/admin`. The process does not poll results or comments on a timer. Due checks run only from the admin buttons or from `npm run results:poll` and `npm run predictions:refresh`.

A login LaunchAgent can start `next start` for this checkout. That arrangement is local and is documented in [docs/OPERATIONS.md](docs/OPERATIONS.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Cloning this repository does not restore the season database.
