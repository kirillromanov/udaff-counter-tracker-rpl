---
name: safe-round-operations
description: Change round preparation, Start production, Close, or Re-open without fetching or scoring. Use when editing the round lock, activation, season status labels, or unsaved-edit guards.
---

# Safe round operations

## When

Work on `productionStartedAt`, `closedAt`, the Status badge, or the Start, Close, and Re-open actions.

## Read

- `docs/ROUND-LIFECYCLE.md`
- `docs/DOMAIN-AND-DATA-MODEL.md`
- `src/lib/domain/rounds/round-lock.ts`
- `src/lib/domain/rounds/round-lock-db.ts`
- `src/tests/rounds/round-lock.test.ts`

## Checks

- Do not click Start, Close, or Re-open on a real round.
- Do not use "no scores yet" as "not started".
- A missing saved prediction is not an unsaved edit. `hasUnsavedFieldEdits` is the guard.
- Re-open must not clear `productionStartedAt`.

## Procedure

Keep Layer, role, activation, and the lock as separate fields. Due selectors skip closed rounds and unstarted operational rounds. Start, close, and reopen write only their own columns and the log.

## Verification

Run `src/tests/rounds/round-lock.test.ts` and `src/tests/rounds/production-activation.test.ts`. The activation test must keep using its temporary database.

## Stop

Stop if a change would recalculate, refetch, or reset `autoCheckAttempts`. Do not install, load, or start the worker LaunchAgent. Do not set `WORKER_ENABLED=1` against the live database unless the operator asked to enable the worker.

## Report

Which transition changed, which tests ran, and confirmation that the live round rows were not updated.
