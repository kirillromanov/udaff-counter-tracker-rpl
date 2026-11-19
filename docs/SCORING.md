# Scoring

The pure engine is `src/lib/domain/scoring/score-match.ts` and `score-round.ts`. Defaults are `defaultScoringConfig` in `src/lib/config/scoring.ts`. Tests are `src/tests/scoring/score-match.test.ts`, `score-round.test.ts`, and `missing-roster.test.ts`.

## Base category

`classifyBase` picks the first match:

| Category | Rule | Default points |
| --- | --- | --- |
| exact | Both numbers match | 10 |
| neighbor | Same outcome, same signed difference, both sides shifted by exactly 1 | 6 |
| diff | Same outcome and same signed difference, but the shift is not exactly 1 | 4 |
| outcome | Same winner or draw, difference differs | 3 |
| miss | Wrong outcome, or no prediction | -1 |

`1-0` against `2-1` is a neighbor. `2-0` against `4-2` is `diff`.

## Bonuses

Bonuses are added only when the category is exact, neighbor, diff, or outcome, because `bonusesRequireRewardedBase` defaults to true. A miss stays at -1 with zero bonus. A missing prediction is a miss and gets no bonus even if the config flag is turned off, because there is no predicted scoreline.

Zero-side bonus: +1 for each side where both the prediction and the result are 0 for that team. An exact `0-0` is +2 from the two sides. The older separate nil-nil field is not added on top of that.

Goal-difference bonus +3 when `abs(predictedHome - predictedAway) >= 3` and `abs(actualHome - actualAway) >= 3`. Equality is not required.

Total-goals bonus +4 when the predicted sum is at least 5 and the actual sum is at least 5. Equality is not required.

The round total-goals bonus +3 is separate. `roundTotalGoalsBonus` awards it only when every match in that slip has a prediction and the predicted goal sum equals the actual goal sum. One missing match blocks it.

## Match of the Round

The official flag is `Match.isMatchOfTheRound`. A `(МТ)` mark on a prediction line does not change that flag.

The multiplier is `base + bonuses`, then times 2 once. It also doubles a negative miss unless `mtAppliesToNegative` is false. The default is true, so a missing Match of the Round prediction is -2. An ordinary missing prediction is -1.

## Confirmed examples

From `src/tests/scoring/score-match.test.ts`, argument order is actual then predicted:

- Actual 4-2, predicted 3-2, Match of the Round: outcome 3 + total bonus 4, times 2 = 14.
- Actual 1-2, predicted 0-3: outcome 3, bonuses 0, total 3.
- Actual 0-4, predicted 1-2, Match of the Round: 6.
- Actual 0-3, predicted 1-4: neighbor 6 + difference bonus 3 = 9.

## Who gets scored

`rosterIdsToScore` in `src/lib/domain/standings/roster-scores.ts` scores every selected slip, plus each included roster participant who has no selected slip and is not an unresolved owner. A participant with no slip is missing every fixture. `missing-roster.test.ts` expects seven ordinary misses at -1 and one Match of the Round miss at -2, which is -9 before any other points.

`recalculateRound` writes `RoundScore`. It is a manual action. Start production does not call it.

## Season aggregation

`buildProductionStandings` starts from the manual checkpoint rows and adds `RoundScore.totalPoints` for the rounds it is given. Tie-break is points, then round-win medals, then baseline rank, then Russian name order, then id.

Loaders pass only rounds for which `countsTowardProduction` is true. That excludes archived rounds, operational rounds at or before the baseline number, and operational rounds with `productionStartedAt` null. A closed operational round that was started is still included.

The checkpoint itself is not a calculated snapshot. Calculated `StandingSnapshot` rows are a stored view. The clean season page rebuilds its table on read from the checkpoint and eligible stored or live slips. Do not add baseline points a second time by also including archived rounds.
