---
name: project-orientation
description: Orient a new session in the contest tracker. Use when starting work, asking what the project does, where a subsystem lives, or which docs to read before editing.
---

# Project orientation

## When

A new session, or any request that assumes chat history is the source of truth.

## Read

1. `AGENTS.md`
2. `docs/handoff/CURRENT.md`
3. `docs/INDEX.md`
4. `docs/KNOWN-ISSUES.md`

## Checks

- `git status -sb`, `git rev-parse HEAD`, and the upstream.
- Do not fetch-and-merge. A fetch without merge is inspection only.
- Do not treat a previous chat's row counts as the database.

## Procedure

Map the request to one page under `docs/`. Open the modules and tests that page names. Say what is implemented, what is only a requirement, and what is a known issue.

## Stop

Stop if the checkout is not this repository, or if the branch is not the one `CURRENT.md` names, until the operator confirms the target.

## Report

Branch, HEAD, the doc pages used, and the implemented-versus-open classification. No production writes.
