# Scoring thresholds

Recorded 2026-11-19 from `src/lib/domain/scoring/score-match.ts` and `src/lib/config/scoring.ts` at parent commit `0aed0b5`. This file does not reconstruct when the rule was first chosen.

The goal-difference bonus is awarded when both absolute differences reach `bigGoalDiffMin` (default 3). The total-goals bonus is awarded when both sums reach `highTotalMin` (default 5). The two numbers do not have to be equal.

Bonuses require a rewarded base category by default. The Match of the Round multiplier is applied once to base plus bonuses. A missing prediction is a miss and receives no bonus.

Tests in `src/tests/scoring/score-match.test.ts` lock the confirmed examples. Changing a threshold without updating those tests is a product change, not a documentation change.
