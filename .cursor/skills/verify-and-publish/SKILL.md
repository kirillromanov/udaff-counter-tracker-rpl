---
name: verify-and-publish
description: Test, review secrets, commit, and push this repository without force-push. Use when the operator asks to publish, commit, or verify a checkpoint on GitHub.
---

# Verify and publish

## When

The operator asked to commit and push verified work to `kirillromanov/udaff-counter-tracker-rpl`.

## Read

- `docs/OPERATIONS.md`
- `docs/SECURITY.md`
- `docs/DEPLOYMENT.md`
- `docs/handoff/CURRENT.md`

## Checks

- `git remote -v` must be that GitHub repository. If it is not, stop and ask before changing it.
- `git fetch` is allowed. Merge, rebase, reset, and branch switches are not.
- Push only when the current branch fast-forwards its upstream.
- Do not push `main` unless the operator named `main`.
- Do not commit `.env`, `prisma/dev.db`, backups, logs, or `.next/`.

## Procedure

Run tests, lint, and `tsc --noEmit` without live-database scripts. Review `git diff`. Search staged files for private keys and tokens without printing secret values. Commit reviewed paths. `git push` with no `--force`. Fetch and compare SHAs.

## Verification

The remote ref equals the local HEAD. `git status -sb` shows no unexpected ahead or behind count.

## Stop

Stop on diverged history, a secret in an unpublished commit, or a remote that points somewhere else.

## Report

Branch, SHA, whether it is `main`, the push result, and any files left uncommitted.
