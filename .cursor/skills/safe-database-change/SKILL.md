---
name: safe-database-change
description: Apply a schema or data change to SQLite without seeding or resetting the live season. Use when editing prisma/schema.prisma, db push, or a backfill script.
---

# Safe database change

## When

The Prisma schema or a one-off data script must change.

## Read

- `docs/OPERATIONS.md`
- `docs/DOMAIN-AND-DATA-MODEL.md`
- `prisma/schema.prisma`
- The script that would write, before executing it

## Checks

- Copy `prisma/dev.db` with `sqlite3 .backup` to a directory outside the repo and run `PRAGMA integrity_check`.
- Do not run `db:seed`, `--force-reset`, or `--accept-data-loss` on the live file.
- Do not stop the server only to edit documentation. Stop it only when a build or a file replace requires it, and then start one process.

## Procedure

Prefer a nullable column and a backfill that updates only the rows that need it. Keep the backfill idempotent. Verify through a new Prisma or sqlite connection. Compare fixture, prediction, score, and checkpoint counts with the pre-change read.

## Verification

The isolated test database pattern is `src/tests/rounds/production-activation.test.ts`. Use that pattern for new write tests.

## Stop

Stop if the only backup failed its integrity check, or if the change would recalculate scores.

## Report

Backup location to the operator only, the SQL or script that ran, before-and-after counts, and files not committed (the database and the backup).
