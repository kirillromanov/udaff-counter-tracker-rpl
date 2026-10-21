# udaff-counter-tracker-rpl

Local-first admin for a football prediction contest. Import a forum thread, correct the parsed predictions, enter results, calculate the round, and copy standings back to the forum. There is no login in this MVP.

## Requirements

- Node.js 22+
- npm

## Setup

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npx prisma db seed
```

`DATABASE_URL` defaults to `file:./dev.db`. Prisma resolves that path relative to `prisma/`, so the SQLite file is `prisma/dev.db`.

Equivalent npm scripts:

```bash
npm run db:generate
npm run db:push
npm run db:seed
```

Re-running the seed clears the existing seasons and participants, then loads the demo contest again.

## Scoring

Match points, bonuses, and the Match of the Round multiplier live in [`src/lib/config/scoring.ts`](src/lib/config/scoring.ts). The engine in `src/lib/domain/scoring` is pure: it does not import Prisma or React.

- `scoreMatch` classifies one prediction and returns a point breakdown.
- `scoreRound` sums match points, adds the round total-goals bonus, and counts categories.
- `buildSeasonStandings` ranks a season and compares the latest round with the ranking before it.

A neighbor is the same outcome and the same signed goal difference, with both teams shifted by exactly one goal. `1-0` against `2-1` is a neighbor. `2-0` against `4-2` is the same goal difference, but not a neighbor.

Match bonuses apply only to rewarded categories (`exact`, `neighbor`, `diff`, `outcome`) unless `bonusesRequireRewardedBase` is turned off. A `0-0` result awards +2 instead of the +1 zero-total bonus. The Match of the Round multiplier also applies to a negative score unless `mtAppliesToNegative` is turned off.

## Tests

```bash
npm test
```

Vitest covers score categories, bonuses, the Match of the Round multiplier, round totals, season movement, forum comment extraction, prediction parsing, and the plain-text exports. The tests do not need the database.

## Workflow

```bash
npm run dev
```

Open `/admin`. The participant registry is at `/admin/participants`. A season roster is at `/admin/seasons/<id>/roster`.

The registry stores each person once. Aliases use the same normalization as forum nicks (`Йош!` and `йош` match; `Павел` and `Павел Абросимов` do not). **Include** puts someone on a season roster. **Exclude** keeps the roster row and any past scores, but marks them inactive. **Archive** removes them from the active registry and from every current roster without deleting standings. **Delete permanently** is available only when they have no prediction sets, round scores, or standing rows.

1. Create a season, or open the seeded **RPL Demo 2026**.
2. Open a round. The overview groups totals, import, participants, round results, and season standings. Rounds 1 and 2 are already calculated, so the season table shows points, medals (☼), and movement (▲ N, ▼ N, ◄► 0). Changed places are tinted. Parse conflicts and rows that still need a correction are marked on the review page.
3. **Fixtures and results** edits teams, marks one official Match of the Round, and stores actual scores.
4. **Review predictions** fetches a forum URL, parses comments, and keeps the latest scored comment per participant. Rename, merge, edit scores, ignore a line, or choose a different comment. A line marked `(МТ)` does not change the official Match of the Round.
5. **Calculate round** scores every selected prediction set, writes round totals, marks the winner or winners, and rebuilds the cumulative snapshot through that round.
6. **Round standings** shows the ranking and each match breakdown, including an `x2` when the official Match of the Round multiplier applies.
7. **Export** copies plain-text round standings, the season table, and an audit. **Season standings** is the cumulative view.

Round 11 is the open sample thread. From that round, open **Review predictions** and paste `https://canadaru.net/udaff_afterlife/sport/football/rpl/2633/`.

## Import and review

**Fetch comments** downloads the WordPress page and stores each comment's author, timestamp, raw HTML, and plain text. **Parse predictions** turns score lines into prediction sets for the round's fixtures.

The scraper expects Atahualpa comment markup: `li#comment-{id}`, `span.authorname`, a permalink timestamp like `16/10/2026 at 10:10`, and the body in the following paragraphs. A PHP warning inside the comment container class is ignored. Only the HTML of the given URL is read.

The parser accepts Cyrillic names, dashes (`-`, `—`, `–`), a tight club hyphen (`Зенит-Ахмат 2-0`), scores (`2-1`, `2:1`, `2 — 1`), a leading date and kickoff (`17.10 14:00` or `18/09/2026 at 22:20`), and an optional `(МТ)`, `(MT)`, or `*²` on a line. `Динамо Мх` and `Кр Советов` match the full club names, and a declined name such as `Краснодара` still matches. A line with teams but no score, or with a placeholder such as `-1*`, is kept on that fixture so the score can be filled in. Clocks, prices (`900-1000`, `2-3,8`), and ordinary sentences with a dash are skipped. A line that looks like a prediction but cannot be read is kept as a warning. When someone posts twice, the latest comment that contains at least one scored prediction is selected. Use **Use this set** to override that. Renaming, merging participants, editing scores, reassigning a fixture, and marking a line ignored are on the same page. A manual set can be added when a comment failed to import. Edits are kept if the thread is parsed again. A line marked `(МТ)` is stored on the prediction and does not change the official Match of the Round flag. Nicks that differ only by case, `ё`/`е`, extra spaces, or wrapping punctuation (`Йош!` and `Йош`) are one participant; `Павел` and `Павел Абросимов` are not. A second score later on the same line, a `vs` or slash between clubs, and a reversed home/away line stay on the review page.
