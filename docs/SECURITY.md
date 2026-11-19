# Security

This application is a local admin with no authentication. That is the current implementation, not a finished threat model.

## What is true now

- Server actions trust whoever can open the site. There is no session and no actor id on `closureLog`.
- `next start --port 3000` listens on all interfaces. The LaunchAgent uses that command. Binding to localhost only is not what the running service does.
- There is no TLS terminator in this repository.
- `.env` is gitignored. `.env.example` has empty placeholders. `FOOTBALLDATA_API_KEY` is a secret when it is set.
- `prisma/dev.db` is gitignored. It contains the season, comments, and scores. A clone of GitHub does not contain it.
- Result adapters download public pages with a fixed user agent. The forum fetch does the same for the saved URL.

## Unverified or open

- The Next.js 16.4.2 build reports a known security advisory and asks for `next upgrade`. A later retry of `next build` finished the compile. The retry does not patch Next.js. The advisory stays open until an upgrade is requested and verified. A clean install's `npm audit` summary (11 findings: 8 moderate, 3 high) was recorded and not remediated. See [KNOWN-ISSUES.md](KNOWN-ISSUES.md).
- No third-party secret scanner is configured. Publication checks are the targeted searches recorded in the handoff.
- Network deployment is not approved. Putting this process on a public host without authentication, TLS, a private database volume, and backups would expose the admin.

## Publication rules

Do not commit `.env`, database files, journals, backups, `.next/`, or logs. Ignoring a file does not remove it from history. If a secret is found in history that has not yet been pushed, stop and report it. Do not rewrite history in the same task.
