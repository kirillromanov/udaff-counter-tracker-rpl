# 009 — Result verification by configured source

A source is the id in `RESULT_ADAPTERS` / `SOURCE_RANK`. Two URLs or two fetches for that id are one confirmation. Two ids that agree on the finished full-time score verify it. One id is provisional. Disagreement does not overwrite a stored score.

This counts configured identities only. A shared upstream behind two ids is intentionally not modeled.

An operator can verify a finished fixture in one action. Changing an already verified score needs a second confirmation because standings use that score. The manual value stays until an explicit rollback recomputes it from the stored source rows. Rollback does not poll. The existing operator poll, and the worker only when `WORKER_RESULTS_ENABLED=1`, perform the next check.

There is no login. The audit actor is `local-admin`.

Existing rows are not rewritten. Empty provenance keeps the previous label. Closed rounds still reject writes. Archived reference rounds reject the new correction actions.
