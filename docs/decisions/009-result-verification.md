# 009 — Result verification by configured source

A source is the id in `RESULT_ADAPTERS` / `SOURCE_RANK`. Two URLs or two fetches for that id are one confirmation. Two ids that agree on the finished full-time score verify it. One id is provisional. Disagreement does not overwrite a stored score.

This counts configured identities only. A shared upstream behind two ids is intentionally not modeled.

The operator fixes a score with the Fix score toggle on Parser review, in the block under the result refresh. Off leaves the score automatic: one configured source is provisional, and two configured ids with the same full-time score are verified. The fields are not editable. On makes that score authoritative. Later source rows are stored and shown, and they do not replace it. The earlier path that let two agreeing sources replace a same-score confirmation is removed.

The label is `verified, fixed manually` when the fixed score matches two agreeing sources, `fixed manually. Only one source agrees.` when it matches one source, and `manual corrected, not source verified` when the sources do not confirm it. That last label is red and also starts with `!`. Turning the toggle off recomputes the score from the stored source rows and does not fetch. Recalculation runs once, and only when the authoritative score changes. A change to a score that standings already use needs the standings confirmation. A row stored as `manual` with empty provenance stays that way and is shown as `older manual score` until the operator uses the toggle.

Fixtures save names, order, and the Match of the Round. It does not change a score. Use this score, Verify this score, and the fixtures rollback form are gone.

There is no login. The audit actor is `local-admin`.

Existing rows are not rewritten. Empty provenance keeps the previous label. Closed rounds still reject writes. Archived reference rounds reject the new correction actions.
