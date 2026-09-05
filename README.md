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
npm run test:browser # real-browser smoke test of the /beta tools
```

- **Web UI:** `GET /` (or `/?n=696969`)
- **Badge index:** `GET /badges` - browse all 233 badges: obtainment rule, EP score,
  rarity tier, exact share of numbers that earn it, family/supersession relations,
  and example numbers (each linking into the calculator, plus a link to that badge's
  `/grid` highlight view). Searchable, filterable by rarity, sortable by EP /
  rarity / name / arrival date. Every card carries the date the badge arrived here, and
  the history panel at the bottom lists each batch since the original port - including
  the badges that have since been retired, which have no card left anywhere else.
- **Beta lab:** `GET /beta` - an index of experimental data-vis and insight tools, each at
  `/beta/<tool>`. See below.
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

## Beta lab (`/beta`)

Experimental tools, all in `src/beta.js`, all reading the **same** cached full-range
sweep as `/`, `/grid` and `/chains` (`sweepShared` in `engine.js`). Nothing here is
precomputed on the server, so every one of them tracks the live badge rules; the sweep
runs once per browser and every tool after that is instant.

Each tool is a dedicated Web Worker that sweeps and derives, plus a page that only
draws - so neither the sweep nor a heavy derivation (a 233×233 co-occurrence pass is
~100M operations) ever touches the main thread. `betaBoot` / `betaSweep` in `beta.js`
are the two halves of that protocol.

| Route | What it is |
| --- | --- |
| `/beta/atlas` | The 1000×1000 map as WebGL2 **terrain** - EP or badge count as height, card tier as colour. One mesh with no vertex attributes: the vertex shader derives position from `gl_VertexID` and fetches everything from one `RGBA32F` texture. Picking renders a second pass through a projection that blows the pixel under the cursor up to fill a 1×1 framebuffer. Any badge can be lit up over the terrain, which the worker cuts from the sweep bitmask on demand. |
| `/beta/projections` | The same million numbers under five **layouts** - value order, nested decimal, Hilbert, Z-order, by score - as a WebGL2 point cloud that interpolates between them. Every layout is computed in the vertex shader from `gl_VertexID`, so switching is a uniform change. Sorted by score, each tier's *area* is its exact share of the range. Any badge can be lit up here too, which is where "every digit divisible by 3" turns out to be a Cantor set. |
| `/beta/spectrum` | Every badge as a **density stripe** across the range - one row per badge, one column per thousand numbers. Digit-length rules step at each power of ten, modular rules band, exact badges are a single lit pixel. Orderable by an entropy measure of how evenly a rule is spread. |
| `/beta/contact` | Every badge's map as a **100x100 thumbnail**, all on one page. Rules with the same geometry line up side by side and the odd one out in a family is obvious; sparse badges have their marks grown to 3x3 so a three-earner rule is not an empty tile. |
| `/beta/pairs` | **Badge affinity**: how often each of the ~26k badge pairs lands on the same number, read as lift, `P(B|A)`, Jaccard or a raw count. Orderable by family or by average-linkage cluster. |
| `/beta/oracle` | **Digit oracle**: lock any digits of a six-digit number and all 60 digit-position choices are re-scored against only the numbers that still match - along with the badges every survivor earns, i.e. what is already guaranteed. |
| `/beta/nearmiss` | **Near misses**: the 54 numbers one digit away from any given one, what each would have scored, and across the range the local peaks, the local valleys, and how much of it sits one digit from a mythic. |
| `/beta/collection` | **Which badges a player is missing** - `/u` counts them, nothing said which. Ranks the gaps by expected wait and by the chance of closing each one in another run the length of the one so far. The only tool here that needs no sweep: a few hundred rolls score instantly through `/engine.js`, and every badge's rate is already in `probabilities.gen.js`. |
| `/beta/luck` | **Roll odds**: the exact EP distribution, tier odds, closed-form best-of-N, and a luck reading for a real player's rolls (via `/api/profile`, scored locally). Name several players to rank them against each other. |
| `/beta/collector` | **Coupon collector**: rolls needed to earn all 233 badges, simulated over the real earner sets, against a greedy cover of the same badge list. |
| `/beta/anatomy` | **Plain properties against score**: digit sum, distinct digits, longest run, divisibility, palindromes - each measured as lift against the range average and ranked by how much spread it actually produces. |
| `/beta/economy` | **Badge pricing**, written up as a finding: EP turns out to be exactly `100 / P(earn)` for every badge, so supersession is the only thing that varies. |
| `/beta/species` | The range grouped by **exact badge set** - distinct kinds, their rank-size curve, and the numbers that score like nothing else. |

Three things worth knowing about the code:

- Tool pages are marked `noindex` and the routes are not linked from the main tools;
  the only entry point is the rail's **Beta lab** item.
- The shared loading overlay is `.beta-ov`, deliberately prefixed: it is a full-screen
  fixed layer, so a tool reusing a bare class name would paint over the whole page.
- `betaShell` prepends a no-op `__name` shim to every page script, because the clients
  are shipped via `toString()` and esbuild's `keepNames` fills that source with calls to
  a bundle-only helper. Run **`npm run test:deploy`** before deploying: it serves the
  real bundle, which is the only way to catch that class of bug.

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

`src/index.js` contains all 233 badges as `[id, label, emoji, ep, rarity, test(c)]`.
For an input `n`, every `test` runs against a precomputed context (digit array,
counts, sum, product, substring helper, etc.); matches are summed into `totalEP`.

## Rules (verified at full parity with prod)

The badge `test` functions and the `FAMILIES` map were reconciled against the live game's
own bundled scoring engine (scraped from rngdle.com) and now match it **exactly**: every
number in `0..1,000,000` produces the identical total EP **and the identical set of
scoring badges** (see `research/full-parity.mjs`, which checks all 1,000,001 numbers
against prod's own scorer replayed from the current production bundle by
`research/prod9-scorer.mjs`). The consecutive / sequence / contiguous-pair badges call helpers
transcribed verbatim from prod (the `p*` functions in `src/index.js`). Notable rules worth
calling out (all confirmed against prod):

- **Number format:** the number is its plain decimal string with no leading zeros
  (e.g. `42` → `"42"`, `0` → `"0"`).
- **Family supersession:** the live game tags each badge with a `family`, and within a
  family only the **single highest-EP earned badge scores**; the rest are still displayed
  but score **0**. The full family map (39 families / 168 badges) is mirrored verbatim from
  prod's `BADGE_DEFINITIONS` as `FAMILIES` in `src/index.js`; the other 65 badges are
  standalone and always score. This was extracted from the live JS, so it matches prod
  exactly (the per-number EP totals across the whole range now diverge from prod only on
  badge *membership* rules, not on supersession). Notable families:
  - **PAIRS** - the whole pair ladder collapses: `Framed/Two/Three Pair`, their contiguous
    variants, `Contiguous Pair`, and `Pair`. So `6161` earns Pair + Two Pair but only Two
    Pair (377) scores. A lone pair (e.g. `5051`) still scores 120 because it's the only
    pair-family badge present (and `407777` keeps Contiguous Pair = 249 for the same reason).
  - **POWER** - all 13 perfect-power badges. The top three (13th/17th/19th) **tie** at EP
    33,333,367, and prod keeps the **first** (13th), so the 13th is what scores - not the
    highest exponent. Confirmed by `0` = 139,927,162.
  - **PI / E** - `exact → Slice (5) → (4) → (3)`. **VOID_DEPTH** - since prod's 2026-09-05
    bundle this is the whole zero ladder: `Deep Void (5)…(3) → Deep Void`, the "ends in
    zeros" run `Eon → Epoch → Millennium → Century → Clean` and the "ends in 5 then zeros"
    run `Semi-Eon → Semi-Epoch → Semi-Millennium → Semi-Century`. So `100000` pays Eon alone
    (Eon, Semi-Eon and Deep Void (5) tie at 10,000,010 and prod keeps the first defined,
    Eon) and `455000` pays Semi-Epoch ("5000") alone - Millennium, Century, Clean and the
    Deep Voids it also earns all score 0. Semi-Clean (ends in 5) is not in it.
    **JACKPOT** - `exact/Six/Five/Four → Jackpot`. **CONTIGUOUS_RUN** -
    `Sixes → Fives → Quads → Trips` (Contiguous Pair lives in PAIRS, not here).
    **OF_A_KIND** - `Framed Triple/Quads → Trips`. **REPEAT** - `Mini Echo → Rhyme`.
    **SINGLE_DIGIT** - the exact digit (Two/Three/…) supersedes `Single Digit` (`2`).
    Plus thematic exact/base pairs: `NICE`, `DEVIL`, `LEET`, `HELL`, `BOOB`, `BOTANIST`,
    `EMERGENCY`, `SIXTY_SEVEN`, `STRAIGHT`, `BOOKENDS`, `CALENDAR`, and more - see `FAMILIES`.

  Standalone badges (e.g. Lucky Seven) always score even when a stronger badge implies
  them - only members of a shared family collapse.
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
