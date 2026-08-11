# RNGdle EP Calculator (Cloudflare Worker)

Enter any number from **0 to 999,999** and get the **total EP** plus the list of
**badges** it earns. EP per badge is the `Score (Decimal)` value from
`RNGdle badges - Sheet1.csv`; the total is the sum over every matching badge.

## Run / deploy

```bash
npm install          # installs wrangler
npm run dev          # local dev server (http://localhost:8787)
npm run deploy       # publish to your Cloudflare account (wrangler login first)
npm test             # run the badge-logic test harness
```

- **Web UI:** `GET /` (or `/?n=696969`)
- **Badge index:** `GET /badges` - browse all 230 badges: obtainment rule, EP score,
  rarity tier, exact share of numbers that earn it, family/supersession relations,
  and example numbers (each linking into the calculator, plus a link to that badge's
  `/grid` highlight view). Searchable, filterable by rarity, sortable by EP /
  rarity / name.
- **JSON API:** `GET /api?n=696969` →
  `{ number, totalEP, count, badges: [{ id, label, emoji, ep, rarity }] }`
- **Browser engine:** `GET /engine.js` - an ES module (`computeLean`, `BADGE_META`,
  `CARD_TIERS` / `cardTier`) *generated from the live badge table* via
  `Function.prototype.toString()`, used by the analysis Web Worker. There is no second
  copy of the rules or of the rarity cutoffs: edit a `test` once and it flows into both
  the server calculator and the client analysis.

## Analyze all scores

The **📊 Analyze all scores** button sweeps the whole 0–999,999 range in a client-side
Web Worker (the work is far past a single Worker request's CPU budget) and plots the
**EP distribution** as a log/log histogram. The sweep fans out over one shard worker per
core - `engine.js` loaded under the name `rngdle-shard` serves range requests - so it
finishes in a few seconds; where nested workers are unavailable it falls back to a
single-threaded sweep with an identical result.

- **Filter by number length** (1–6 digits). This drives *what gets computed*: lengths 1–5
  are only 100k numbers total, so they are always computed **exactly**. Only the 6-digit
  bucket (900k) is optionally **sampled** (by a hash of `n`, so divisibility-based badges
  like Even/Odd/Prime stay representative); sampled 6-digit counts are **weighted by the
  stride** so the histogram still reflects the true full range.
- **Filter by badge(s)** - restrict to numbers that earn *all* selected badges (instant
  re-filter; no recompute).
- **Break down by rarity** - every matching number is bucketed into its card tier
  (trash / common / uncommon / rare / epic / anomaly / mythic, the percentile-derived
  `CARD_TIERS` cutoffs the number card uses) and reported as a **rarity breakdown**:
  count, share, mean EP and a share bar per tier. The histogram bars are **stacked by
  tier** too, so the EP distribution reads as a rarity composition - a quarter-decade
  bucket can straddle a cutoff (the uncommon band is narrower than one bucket), so
  buckets are tallied per tier rather than given a single colour.
- **Filter by rarity tier** - the tier chips (and the breakdown rows) include/exclude a
  tier; shift-clicking a row isolates it. Tier is a pure post-compute filter on the
  already-swept EP values, so it never recomputes. Breakdown counts deliberately
  **ignore the tier filter itself** (facet counts), so the breakdown still works as a
  picker once a tier is isolated.
- **Resolution** - Full (every number) or a sample; only affects the 6-digit bucket.
- **Exports:** *Matching numbers (.csv)* dumps the current filter as
  `number,totalEP,rarity`;
  *Examples per badge (.txt)* lists example numbers for every badge. Use **Full** resolution
  for complete examples (6-digit-only badges are missed by sampling).

## Generated snapshot files (`npm run gen`)

`research/gen-snapshot.mjs` scans **all 1,000,001 inputs** through the badge engine
once and writes three committed artifacts. The scan is split over worker threads
(~5 s on 16 cores; `GEN_WORKERS=1` forces a serial run):

- `src/examples.gen.js` - the first 3 numbers that earn each badge (the `/badges`
  page's clickable examples).
- `src/probabilities.gen.js` - each badge's exact share of all inputs (the
  "X% of numbers earn this" figure in tooltips and on `/badges`).
- `research/badge-tally.json` - a **limited, diffable snapshot** of the whole range:
  per badge, how many numbers *earn* it and how many it *scores* on (>0 EP after
  family supersession). No per-number data - a rule/EP change shows up as a small,
  reviewable tally diff.

**Before any commit or deploy that touches a badge `test`, EP value, or `FAMILIES`:
run `npm run gen` and commit the updated files with the change.** `npm run deploy`
runs it automatically (via `predeploy`) so prod can't ship stale snapshot data, but
the regenerated files still need to be committed.

## How it works

`src/index.js` contains all 230 badges as `[id, label, emoji, ep, rarity, test(c)]`.
For an input `n`, every `test` runs against a precomputed context (digit array,
counts, sum, product, substring helper, etc.); matches are summed into `totalEP`.

## Rules (verified at full parity with prod)

The badge `test` functions and the `FAMILIES` map were reconciled against the live game's
own bundled scoring engine (scraped from rngdle.com) and now match it **exactly**: every
number in `0..1,000,000` produces the identical total EP (see `test/full-parity.mjs`, which
checks all 1,000,001 numbers against a faithful reconstruction of prod's scorer in
`test/prod-scorer.mjs`). The consecutive / sequence / contiguous-pair badges call helpers
transcribed verbatim from prod (the `p*` functions in `src/index.js`). Notable rules worth
calling out (all confirmed against prod):

- **Number format:** the number is its plain decimal string with no leading zeros
  (e.g. `42` → `"42"`, `0` → `"0"`).
- **Family supersession:** the live game tags each badge with a `family`, and within a
  family only the **single highest-EP earned badge scores**; the rest are still displayed
  but score **0**. The full family map (35 families / 138 badges) is mirrored verbatim from
  prod's `BADGE_DEFINITIONS` as `FAMILIES` in `src/index.js`; the other 65 badges are
  standalone and always score. This was extracted from the live JS, so it matches prod
  exactly (the per-number EP totals across the whole range now diverge from prod only on
  badge *membership* rules, not on supersession). Notable families:
  - **PAIRS** - the whole pair ladder collapses: `Framed/Two/Three Pair`, their contiguous
    variants, `Contiguous Pair`, and `Pair`. So `6161` earns Pair + Two Pair but only Two
    Pair (447) scores. A lone pair (e.g. `5051`) still scores 120 because it's the only
    pair-family badge present (and `407777` keeps Contiguous Pair = 249 for the same reason).
  - **POWER** - all 13 perfect-power badges. The top three (13th/17th/19th) **tie** at EP
    33,333,367, and prod keeps the **first** (13th), so the 13th is what scores - not the
    highest exponent. Confirmed by `0` = 139,927,162.
  - **PI / E** - `exact → Slice (5) → (4) → (3)`. **VOID_DEPTH** - `Deep Void (5)…(3) → Deep
    Void`. **JACKPOT** - `exact/Six/Five/Four → Jackpot`. **CONTIGUOUS_RUN** -
    `Sixes → Fives → Quads → Trips` (Contiguous Pair lives in PAIRS, not here).
    **OF_A_KIND** - `Framed Triple/Quads → Trips`. **REPEAT** - `Mini Echo → Rhyme`.
    **SINGLE_DIGIT** - the exact digit (Two/Three/…) supersedes `Single Digit` (`2`).
    Plus thematic exact/base pairs: `NICE`, `DEVIL`, `LEET`, `HELL`, `BOOB`, `BOTANIST`,
    `EMERGENCY`, `SIXTY_SEVEN`, `STRAIGHT`, `BOOKENDS`, `CALENDAR`, and more - see `FAMILIES`.

  Note: "ends in zeros" is NOT a family - `Millennium` (ends 000) and `Century` (ends 00)
  both score in full, confirmed by `455000`. Standalone badges (e.g. Lucky Seven) always
  score even when a stronger badge implies them - only members of a shared family collapse.
- **Pair / Two Pair / Three Pair** = a digit appearing **exactly twice**; a triple/quad is
  not a pair, so `455000` (5×2, 0×3) is a Full House, not Two Pair. **Contiguous Two/Three
  Pair** = two/three digits that each occur exactly twice *and adjacently* (`dd`), with the
  `dd` blocks themselves adjacent (`ddee` / `ddeeff`) - so `112211` is **not** a contiguous
  two-pair (digit 1 occurs four times, not twice).
- **Rhyme** needs the repeated 2+ digit substring to appear **non-overlapping**, so the
  `00` inside `000` does not by itself make a rhyme.
- **Perfect powers** (square, cube, 4th…19th power): **`0` and `1` both count** as perfect
  powers of *every* exponent (`0 = 0ⁿ`, `1 = 1ⁿ`) and earn all 13 power badges - but they
  form **one family**, so only the highest-EP member scores (the 13th-power tier; the rest
  display as 0). Confirmed against prod: `0` = **139,927,162**, `1` = **162,575,449**.
- **Power of 2 / Power of 3:** `1` **does** count (`1 = 2⁰ = 3⁰`) - prod uses
  `n>0 && (n&(n-1))===0` for powers of two and a multiply-up loop for powers of three.
- **Factorial** includes `1` (= 0! and 1!). **Fibonacci** and **Pronic** include `0`.
- **Single-digit numbers:** prod *does* award the badges that are simply true of a one-char
  string - **Palindrome, Flush, Heterogeneous** - but *not* the ones that imply repetition or
  two positions (Homogeneous, Equilibrium). Confirmed against prod: `2` = **119,610,065**.
  Also, **Single Digit** is displayed but scores **0**: the exact digit badge (Two, Three…)
  supersedes it (see `FAMILIES`). Single digits still get digit-set/value badges
  (Void, Prime, Low Ball…).
- **Sequence (3/4/6)** = a contiguous run of consecutive digits, **ascending OR descending**
  (e.g. `654321` earns Sequence (6)). **Straight (5)** likewise ascending or descending.
- **"Consecutive Numbers" badges** (pair/triple/quad) require at least one **multi-digit**
  part, so a single-digit run like `1234` is a *Sequence*, **not** "4 Consecutive Numbers".
  The variants differ by coverage: **Exact** = the whole number splits into N consecutive
  integers; **Contains** = N adjacent consecutive substrings that do *not* span the whole
  number (so `1213`=12,13 is Exact-only; `91011`=9,10,11 is Contains); **Scrambled** = the
  whole number splits into N consecutive integers but out of order. Confirmed: `3125` =
  6,271,772.
- **Neighbors** = two **positionally adjacent** digits whose *values* differ by 1
  (e.g. `…34…`), not any two digits anywhere.
- **Spy** = digit sum equals digit product, excluding only `1` and `2`; so single digits
  `0` and `3`–`9` **are** spies (`5`: 5 = 5), but `1` and `2` are not.
- **Even Spacing / arithmetic** badges require ≥ 3 digits.
- **Echo** = even length ≥ 2 with the first half equal to the second, so `"11"` **is** an
  Echo (as well as a Pair - different families, both score).
- **Balanced** requires **even length** (first-half digit-sum = second-half). **Firefly** /
  **Hopscotch (Double Hop)** / **Hills** / **Zipper** match prod's exact length and
  distinct-digit guards (see the `test` functions).
- **Divisible by Three** = every *digit* ∈ {0,3,6,9} (per the CSV wording), not
  "number divisible by 3".
- **Framed / consecutive-split** badges disallow leading-zero parts (except `"0"`).
- `0` is **Even** but does **not** earn the other modular badges (Eleven, Dozen, Lucky
  Seven Div) - prod requires `n > 0` for those even though `0 % k === 0`. Harshad also
  excludes it (digit sum 0). All confirmed against prod: `0` = 139,927,162.

Edit any `test` in `src/index.js` to change behavior - each is one self-contained line.
