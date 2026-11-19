# Requirements

This page records rules the operator confirmed. [SCORING.md](SCORING.md), [ROUND-LIFECYCLE.md](ROUND-LIFECYCLE.md), and [IMPORT-AND-PARSING.md](IMPORT-AND-PARSING.md) say where the current code implements them. A conflict is listed in [KNOWN-ISSUES.md](KNOWN-ISSUES.md) and is not treated as a change to the requirement.

## Contest administration

- A season has participants, a roster, rounds, a trusted manual baseline, and calculated standings.
- One person is stored once. Aliases normalize like forum nicks. A short name and a longer distinct name are not the same person.
- Include, exclude, and archive change roster visibility. They do not delete historical scores.
- Permanent delete is only for a person with no prediction sets, round scores, or standing rows.

## Import and review

- Fixture schedules are read from the article body under a heading that contains the standalone word "Абразцы". The ordinal is not fixed.
- If that article candidate is missing or invalid, the earliest real comment is the only fallback. The two partial lists are not merged.
- Existing fixtures are kept. A failed read writes no partial fixture list.
- Predicted scores in the article or in a comment are not actual results.
- A saved empty prediction cell is a missing prediction, not an unsaved edit.
- A genuine unsaved form edit must be saved or cancelled before Start production or Close.

## Activation and closure

- A new operational round is in preparation until an explicit Start production action.
- Preparation allows manual source loading, fixture bootstrap, parsing, review, and corrections.
- Preparation excludes the round from automatic due jobs and from official season totals.
- Start production does not itself fetch, parse, or calculate.
- Close locks writes. It does not remove the round from season totals.
- Re-open restores the previously active round and does not require Start production again.
- There is no return-to-preparation action.

## Scoring

- Base categories, in order: exact, neighbor, same difference, correct outcome, miss.
- A neighbor is the same outcome and the same signed goal difference, with both sides shifted by exactly one goal.
- Goal-difference bonus requires both absolute differences to reach the configured minimum. The differences do not have to be equal.
- Total-goals bonus requires both the predicted total and the actual total to reach the configured minimum. The totals do not have to be equal.
- Bonuses stay off a miss while `bonusesRequireRewardedBase` is true. A missing prediction receives no bonus.
- Match of the Round multiplies the complete fixture score, including bonuses and a negative miss, by the configured multiplier once.
- An ordinary missing prediction is penalized once. A missing Match of the Round prediction is that same miss multiplied once.
- The manual baseline is added once. Saved operational rounds after that baseline are added on top. Archived rounds are not added again.

## Confirmed examples

With the default configuration in `src/lib/config/scoring.ts`:

- Actual 4-2, predicted 3-2, Match of the Round: outcome 3 plus total bonus 4, times 2, equals 14.
- Actual 1-2, predicted 0-3: outcome 3, bonuses 0, total 3.
- Actual 0-4, predicted 1-2, Match of the Round: outcome 3 times 2 equals 6.
- Actual 0-3, predicted 1-4: neighbor 6 plus difference bonus 3 equals 9.

These are asserted in `src/tests/scoring/score-match.test.ts`.
