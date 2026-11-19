---
name: write-session-handoff
description: Update docs/handoff/CURRENT.md after verified work. Use when a session changes behavior, finishes a checkpoint, or needs the next session to resume safely.
---

# Write a session handoff

## When

Behavior, operations, or publication status changed, and the operator expects a durable handoff.

## Read

- `docs/handoff/TEMPLATE.md`
- `docs/handoff/CURRENT.md`
- `docs/INDEX.md`

## Checks

- Include only checks that were actually run.
- Do not paste chat logs, `.env` values, forum HTML, or backup paths.
- Do not claim a build retry fixed the Next.js advisory.
- Do not claim the live database changed unless a read-only query in this session showed it.

## Procedure

Follow the template. Point at modules and tests. Separate implemented, open, and deliberately not done. Update `docs/KNOWN-ISSUES.md` when a new gap is real. Add a decision record only for a choice that is visible in the code.

## Verification

Relative links in the handoff resolve. `git status` shows the handoff as an intended doc change, not as the only copy of a code fix.

## Stop

Stop if the handoff would require a production import or recalculation to "make the notes true".

## Report

The revision line, the checks named, and what the next session must not run.
