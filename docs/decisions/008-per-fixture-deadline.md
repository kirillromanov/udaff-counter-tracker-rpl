# Per-fixture prediction deadline

Recorded 2026-11-20. A participant may post one fixture at a time and may revise a fixture by posting another comment. The revision counts only when its publication time is strictly before that fixture's kickoff. The same comment can be eligible for a later fixture and ineligible for one that has already kicked off.

The comparison uses the stored instants. `postedAt` comes from the forum permalink text and is parsed as UTC with no zone conversion. `kickoffAt` is the Moscow wall clock converted to UTC. The deadline does not add another three hours to either value. `createdAt`, `lastFetchedAt`, and the import clock are not eligibility.

A later eligible comment replaces only the fixtures named in that comment. An earlier eligible prediction for any other fixture stays. A comment published at the kickoff instant, or after it, does not replace that fixture. Identical eligible scores stay on the earliest comment. Two eligible comments with the same publication time and different scores stay in review. A line with no publication time, or a fixture with no kickoff, stays in review and does not replace an eligible line. A manual set remains the whole slip.

Editing a stored comment is not authorized by its original publication time. `commentEditEvidence` reads only the HTML before the first paragraph. An edit time counts when that metadata has an edit mark and exactly one timestamp different from publication. The permalink time is not an edit time. A reliable edit writes only the incoming fixtures whose edit time is before kickoff and leaves every other stored prediction. An updated comment with no reliable edit time is flagged and its prediction rows are not replaced. The edit time is derived from stored `rawHtml` when the slip is read, so the rule does not add a schema column.

Late lines remain stored. They are omitted from the effective slip. An unresolved cell is omitted from intermediate scoring. A fixture with only a late line is missing and can take the existing missing penalty once the result is finished.
