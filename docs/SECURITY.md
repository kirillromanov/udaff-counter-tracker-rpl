# Security

This application is a local admin with no authentication. That is the current implementation, not a finished threat model.

## What is true now

- Server actions trust whoever can open the site. There is no session and no actor id on `closureLog`.
- The local LaunchAgent runs `scripts/dev-up.sh --service`, which starts `next start --hostname 127.0.0.1 --port 3000`. A source change does not move an already running process. Confirm the live socket after restart. `npm run start` without `--hostname` still defaults to `0.0.0.0` and is not the local service command.
- There is no TLS terminator in this repository.
- `.env` is gitignored. `.env.example` has empty placeholders. `FOOTBALLDATA_API_KEY` is a secret when it is set.
- `prisma/dev.db` is gitignored. It contains the season, comments, and scores. A clone of GitHub does not contain it.
- Result adapters download public pages with a fixed user agent. The forum fetch does the same for the saved URL.

## Unverified or open

- `next` and `eslint-config-next` are pinned at 16.4.5. That is the first release after the vulnerable range `<=16.4.4`. A clean `next build` of 16.4.5 completed on the first attempt. The old `SecurityFatalError` was Next's upgrade nudge for an affected install, not a patch. See [KNOWN-ISSUES.md](KNOWN-ISSUES.md) for the advisories and the findings that remain.
- No third-party secret scanner is configured. Publication checks are the targeted searches recorded in the handoff.
- Network deployment is not approved. Putting this process on a public host without authentication, TLS, a private database volume, and backups would expose the admin.

## Publication rules

Do not commit `.env`, database files, journals, backups, `.next/`, or logs. Ignoring a file does not remove it from history. If a secret is found in history that has not yet been pushed, stop and report it. Do not rewrite history in the same task.
