# Security

This application is a local admin with no authentication. That is the current implementation, not a finished threat model.

## What is true now

- Server actions trust whoever can open the site. There is no session and no actor id on `closureLog`.
- The local LaunchAgent runs `scripts/dev-up.sh --service`, which starts `next start --hostname 127.0.0.1 --port 3000`. A source change does not move an already running process. Confirm the live socket after restart. `npm run start` without `--hostname` still defaults to `0.0.0.0` and is not the local service command.
- There is no TLS terminator in this repository.
- `.env` is gitignored. `.env.example` has empty placeholders. `FOOTBALLDATA_API_KEY` is a secret when it is set.
- `prisma/dev.db` is gitignored. It contains the season, comments, and scores. A clone of GitHub does not contain it.
- Result adapters download public pages with a fixed user agent. The forum fetch does the same for the saved URL.
- The worker has no HTTP route. Nothing in `npm start` enables it. `WORKER_ENABLED` must be the exact value `1` before it fetches. Prediction fetches also need `PREDICTION_REFRESH_INTERVAL_MINUTES`. Result fetches and score writes also need `WORKER_RESULTS_ENABLED=1`. Plan mode reads scheduling columns and does not print comment text.

## Unverified or open

- `next` and `eslint-config-next` are pinned at 16.4.5. That closes the Next.js advisories whose range ended at 16.4.4. It does not close the two remaining `npm audit` groups below.

## Remaining audit findings

Reproduced from the lockfile on `main` with `npm ci` and `npm audit`. Ten reported entries are two vulnerabilities. Neither was changed in that review.

- [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) is one high finding reported three times: `deepmerge-ts` 7.1.5, `@prisma/config` 6.19.3, and the direct dev dependency `prisma` 6.19.3. `deepmerge()` can throw `RangeError` when two object graphs cycle through the same key. Plain JSON cannot form that cycle. `@prisma/config` passes `deepmerge` to its config loader. This repository has no `prisma.config.ts`. Application code uses `@prisma/client`, which does not reference `deepmerge`. Forum text is not passed to that loader. The latest Prisma 6 release is still 6.19.3, inside the affected range. The patched library is `deepmerge-ts` 8.0.0, and the audit's fix is Prisma 7.10.1. That major upgrade was not applied.
- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) is one moderate finding reported seven times through `typescript-eslint` 8.72.0. The vulnerable copy is `minimatch` 10.2.6, used when ESLint compares a source path with an `allowDefaultProject` pattern. A hostile glob can waste CPU and memory. Forum comments are not lint inputs. `minimatch` 3.1.5, also installed, is outside this range. `typescript-eslint` 8.73.0 depends on `minimatch` `^11.0.1` and fits `eslint-config-next`'s existing `^8.56.0` range. That bump was not applied.

The 2026-11-24 deployment audit reported 11 findings: 7 moderate and 4 high. The additional high finding is `effect` through the Prisma CLI. No dependency was upgraded. That follow-up is listed in [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

These two findings do not block a later decision to schedule external imports. The import path does not call either function. The worker added after this review does not upgrade either package.

- No third-party secret scanner is configured. Publication checks are the targeted searches recorded in the handoff.
- Network deployment is not approved. Putting this process on a public host without authentication, TLS, a private database volume, and backups would expose the admin.

## Publication rules

Do not commit `.env`, database files, journals, backups, `.next/`, or logs. Ignoring a file does not remove it from history. If a secret is found in history that has not yet been pushed, stop and report it. Do not rewrite history in the same task.
