# 009 — Result verification by configured source

A source is the id in `RESULT_ADAPTERS` / `SOURCE_RANK`. Two URLs or two fetches for that id are one confirmation. Two ids that agree on the finished full-time score verify it. One id is provisional. Disagreement does not overwrite a stored score.

This counts configured identities only. A shared upstream behind two ids is intentionally not modeled.

The operator fixes scores on Parser review, in the compact block under the result refresh. Eight fixtures sit in two columns on a wide screen and in one column on a narrow screen. Each row is the fixture name, a short status, a small Fix score switch, and two score fields. Source rows stay behind a control that opens on demand.

Off leaves the score automatic: one configured source is provisional, and two configured ids with the same full-time score are verified. The fields are not editable. On makes that score authoritative. Later source rows are stored and shown, and they do not replace it. The earlier path that let two agreeing sources replace a same-score confirmation is removed.

Parser review and the round overview keep the counters and put the matching records in one panel under them. The panel is closed until a counter is selected. The same counter closes it. Another counter replaces it. The address keeps `metric`, so back and forward restore the panel. Parse conflicts and slips that need correction stay on their own counters. Result-source conflicts, unverified scores, and missing selected predictions are Result issues. A fixture with no full-time score yet is listed there as pending and is not an error. The refresh line is one sentence. Details holds the last attempt, the last successful source refresh, the next check, the polling policy, and the per-fixture attempts. Opening Details does not request a source.

The switch and the typed numbers stay on the page until Save actual results. Turning a saved switch off does not write by itself. The save confirms every authoritative score change, including a switch that returns the fixture to the stored sources, and shows the previous and proposed scores. A change to a score that standings already use also needs the standings confirmation. Cancelling that confirmation writes nothing. One save checks every fixture version first, writes the changed fixtures together, and rejects the whole save if any version is stale. Unchanged rows are not rewritten. Recalculation runs once for that save, and only when an authoritative score changes.

The label is `verified, fixed manually` when the fixed score matches two agreeing sources, `fixed manually. Only one source agrees.` when it matches one source, and the exact red text `manual corrected, not source verified` when the sources do not confirm it. Turning the switch off recomputes the score from the stored source rows and does not fetch. A row stored as `manual` with empty provenance stays that way and is shown as `older manual score` until the operator saves a change.

Fixtures save names, order, and the Match of the Round. It does not change a score. Use this score, Verify this score, and the fixtures rollback form are gone.

There is no login. The audit actor is `local-admin`.

Existing rows are not rewritten. Empty provenance keeps the previous label. Closed rounds still reject writes. Archived reference rounds reject the new correction actions.

The new workflow applies only when the season slug is `rpl-demo-2026` and the round number is 16 or later. `resultVerificationApplies` in `src/lib/domain/results/eligibility.ts` is that check. It does not use a database id, and another season's round 16 is outside it. Manual save, rollback, result refresh, season ingest, due polling, conflict acknowledgement, and the worker result line all refuse an earlier round before a fetch or a stored-result write. Prediction refresh is unchanged. Rounds before 16 keep the stored phase label. Their counters still show stored parse warnings, and they do not gain the new result-status notes. `scripts/import-rounds-12-13.ts` now hits this guard. Do not run it to rewrite those rounds.
