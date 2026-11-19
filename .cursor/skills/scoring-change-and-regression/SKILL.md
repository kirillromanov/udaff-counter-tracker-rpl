---
name: scoring-change-and-regression
description: Change or review match points, bonuses, the Match of the Round multiplier, or season aggregation. Use when editing scoring config, score-match, score-round, or baseline inclusion.
---

# Scoring change and regression

## When

Any edit under `src/lib/domain/scoring/`, `src/lib/config/scoring.ts`, or season-total inclusion.

## Read

- `docs/SCORING.md`
- `docs/REQUIREMENTS.md`
- `docs/decisions/001-scoring-thresholds.md`
- `docs/decisions/002-baseline-and-archive.md`
- `src/tests/scoring/score-match.test.ts`

## Checks

- Both sides of a threshold must qualify. Equality is not required.
- Bonuses stay off a miss while `bonusesRequireRewardedBase` is true.
- The multiplier applies once to the whole fixture score.
- Ordinary miss is -1. Match of the Round miss is -2 with the default config.
- Do not add the manual baseline and the archived rounds that built it.

## Procedure

Change the pure function and the test together. Do not run `scores:recalculate-1-13` or calculate a real round unless the operator asked to rewrite stored totals.

## Verification

Run `src/tests/scoring/score-match.test.ts`, `score-round.test.ts`, `missing-roster.test.ts`, and `production-standings.test.ts`.

The four examples must stay: 4-2 vs 3-2 on Match of the Round is 14; 1-2 vs 0-3 is 3; 0-4 vs 1-2 on Match of the Round is 6; 0-3 vs 1-4 is 9.

## Stop

Stop before writing `RoundScore` or `StandingSnapshot` on the live database.

## Report

The rule that changed, the tests run, and that stored season totals were not rewritten.
