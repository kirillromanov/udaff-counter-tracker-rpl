# 009 — Result verification by configured source

A source is the id in `RESULT_ADAPTERS` / `SOURCE_RANK`. Two URLs or two fetches for that id are one confirmation. Two ids that agree on the finished full-time score verify it. One id is provisional. Disagreement does not overwrite a stored score.

This counts configured identities only. A shared upstream behind two ids is intentionally not modeled.

An operator can verify a finished fixture in one action. Submitting the score already on screen is Verified manually. A later single-source disagreement stays visible and does not replace that score. Two configured sources that later agree on a different full-time score can replace it, and that replacement is not a manual correction. Changing the score is Manually corrected. Automatic results do not replace a changed score. When two configured sources later agree on a different score, a verified-manually score is replaced once. That write records an audit action `replace`, keeps the sentence “Verified manually … was replaced by two sources”, and recalculates once. The same fetch again does not write or calculate again. One disagreeing source does not replace it. Either state needs a second confirmation when the fixture was already verified and the number changes, because standings use that score. Rollback removes either state and recomputes the score from the stored source rows. Rollback does not poll. The existing operator poll, and the worker only when `WORKER_RESULTS_ENABLED=1`, perform the next check.

Save fixtures and Use this score call the same action. They no longer set `resultState` to `manual` by themselves. Empty score boxes do not clear a stored score. Names, order, and the Match of the Round still save without an audit. A score that was already stored as `manual` by the older path stays that way until an operator uses the new action.

There is no login. The audit actor is `local-admin`.

Existing rows are not rewritten. Empty provenance keeps the previous label. Closed rounds still reject writes. Archived reference rounds reject the new correction actions.
