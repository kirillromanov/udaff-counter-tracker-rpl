---
name: diagnose-import-and-parsing
description: Diagnose empty review tables, fixture bootstrap, article schedules, and comment parsing. Use when comments exist but fixtures or prediction sets do not, or when changing Абразцы extraction.
---

# Diagnose import and parsing

## When

A round shows comments but no scorelines, or the fixture source, fallback, or provenance is being changed.

## Read

- `docs/IMPORT-AND-PARSING.md`
- `src/lib/domain/forum/schedule-source.ts`
- `src/lib/domain/import/ensure-fixtures.ts`
- `src/lib/domain/import/refresh-predictions.ts`
- `src/tests/forum/schedule-source.test.ts`
- `src/tests/import/draft-review-fixtures.test.ts`

## Checks

- Read fixture and prediction counts before any write.
- A closed round must fail before bootstrap.
- If matches already exist, do not replace them.
- Do not call Refresh predictions on a real round as the diagnosis.

## Procedure

Confirm whether matches exist. Zero matches explain missing prediction rows: `parseStoredComments` drops lines with no fixture. The article block is the primary schedule. The earliest comment is the fallback. Do not merge a partial article with a comment.

## Verification

Run the schedule-source and draft-review tests. They must not open `prisma/dev.db`.

## Stop

Stop if the only remaining step is a live fetch or a live fixture insert, and the operator did not ask for that write.

## Report

Counts read, which source would be chosen, and whether any live row was written.
