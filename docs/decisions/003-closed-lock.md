# Closed lock

Recorded 2026-11-19 from `src/lib/domain/rounds/round-lock.ts` and `round-lock-db.ts`.

`closedAt` is a write lock, not a season-total switch. Close and reopen change that timestamp and `closureLog` only. They do not fetch, parse, calculate, or reset attempt counters.

Mutations call `assertRoundMutable` before parsing or creating fixtures. The lock is read again inside write transactions.

The operator message is fixed: `Тур закрыт. Для изменения данных сначала нажмите Re-open production.`
