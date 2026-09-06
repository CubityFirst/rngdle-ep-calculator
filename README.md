# RNGdle badge engine + legacy tools (Cloudflare Worker)

The badge rules behind [rngdle.tools](https://rngdle.tools), and the tools that were
never ported there. This repo used to be the front end too - the calculator, `/badges`,
`/grid`, `/u` - and all of that has moved: rngdle.tools is the front end now, drawn in
rngdle's own furniture, and this Worker is what it embeds for the rest.

What is still served from here, and where it is reached:

| Route | What it is |
| --- | --- |
| `/engine.js` | The browser engine - an ES module (`computeLean`, `BADGE_META`, `sweepShared`, `CARD_TIERS` / `cardTier`) *generated from the live badge table* via `Function.prototype.toString()`. There is no second copy of the rules: edit a `test` once and it flows into the server scorer and every client tool. |
| `/api?n=696969` | `{ number, totalEP, count, badges: [{ id, label, emoji, ep, rarity }] }` |
| `/api/profile?u=<name>` | A player's rolls (from rngdle's public API) scored locally: tier counts, distinct badges, best roll, streak. Several names pool them. Read by `/beta/collection`. |
| `/chains` | The n → EP(n) graph, computed in-browser. |
| `/beta/<tool>` | The legacy lab - see below. |
| `/api/palettes…` | The Box Lab's shared gallery (D1, `src/gallery.js`). |

Every other path this Worker used to answer - `/`, `/?n=`, `/badges`, `/grid`, `/u/<name>`,
the old `/beta` index - is a 301 to the same place on rngdle.tools (`FRONT_END` in
`src/index.js`; `/?n=696969` becomes `/n/696969`, `/beta` becomes `/other`).

**How rngdle.tools uses this.** Its `tools/sync-legacy.js` copies `src/*.js` and
`schema.sql` into its `legacy/` directory byte for byte, and its Worker mounts that
module for `/beta/`, `/chains`, `/engine.js` and the APIs, passing its own origin in as
`env.FRONT_END` so the redirects above stay on-site. Its **Other** tab is drawn from
`legacyCatalogue()` (`src/beta.js`): the titles, blurbs and marks the old `/beta` index
used. So after a change here - a badge rule, a tool - re-run that sync over there and
commit the copy; nothing is retyped on either side.

## Run / deploy

```bash
npm install          # installs wrangler
npm run dev          # local dev server (http://localhost:8787)
npm run deploy       # publish to your Cloudflare account (wrangler login first)
npm test             # run the badge-logic test harness
npm run test:browser # real-browser smoke test of /chains and the /beta tools
```

The deploy target is `rng.cubityfir.st`. It still serves the legacy tools itself, and
sends everything else to rngdle.tools, so old links keep working.

## Legacy lab (`/beta/<tool>`, `/chains`)

The tools that have no tab on rngdle.tools yet, all in `src/beta.js` (and `/chains` in
`src/index.js`), all reading the **same** cached full-range sweep (`sweepShared` in
`engine.js`). Nothing here is precomputed on the server, so every one of them tracks the
live badge rules; the sweep runs once per browser and every tool after that is instant.

Each tool is a dedicated Web Worker that sweeps and derives, plus a page that only
draws - so neither the sweep nor a heavy derivation (a 233×233 co-occurrence pass is
~100M operations) ever touches the main thread. `betaBoot` / `betaSweep` in `beta.js`
are the two halves of that protocol.

| Route | What it is |
| --- | --- |
| `/beta/atlas` | The 1000×1000 map as WebGL2 **terrain** - EP or badge count as height, card tier as colour. One mesh with no vertex attributes: the vertex shader derives position from `gl_VertexID` and fetches everything from one `RGBA32F` texture. Picking renders a second pass through a projection that blows the pixel under the cursor up to fill a 1×1 framebuffer. Any badge can be lit up over the terrain, which the worker cuts from the sweep bitmask on demand. |
| `/beta/projections` | The same million numbers under five **layouts** - value order, nested decimal, Hilbert, Z-order, by score - as a WebGL2 point cloud that interpolates between them. Every layout is computed in the vertex shader from `gl_VertexID`, so switching is a uniform change. Sorted by score, each tier's *area* is its exact share of the range. Any badge can be lit up here too, which is where "every digit divisible by 3" turns out to be a Cantor set. |
| `/chains` | **The EP graph**: every number is a node with one edge, to its own score. Out-degree 1 makes it a functional graph - basins draining into loops or, rarely, escaping the range - drawn whole, traceable from any number, with the attractors, the deepest chain and a depth profile. |
| `/beta/spectrum` | Every badge as a **density stripe** across the range - one row per badge, one column per thousand numbers. Digit-length rules step at each power of ten, modular rules band, exact badges are a single lit pixel. Orderable by an entropy measure of how evenly a rule is spread. |
| `/beta/contact` | Every badge's map as a **100x100 thumbnail**, all on one page. Rules with the same geometry line up side by side and the odd one out in a family is obvious; sparse badges have their marks grown to 3x3 so a three-earner rule is not an empty tile. |
| `/beta/pairs` | **Badge affinity**: how often each of the ~26k badge pairs lands on the same number, read as lift, `P(B|A)`, Jaccard or a raw count. Orderable by family or by average-linkage cluster. |
| `/beta/oracle` | **Digit oracle**: lock any digits of a six-digit number and all 60 digit-position choices are re-scored against only the numbers that still match - along with the badges every survivor earns, i.e. what is already guaranteed. |
| `/beta/collection` | **Which badges a player is missing** - `/u` counts them, nothing said which. Ranks the gaps by expected wait and by the chance of closing each one in another run the length of the one so far. The only tool here that needs no sweep: a few hundred rolls score instantly through `/engine.js`, and every badge's rate is already in `probabilities.gen.js`. |
| `/beta/boxes` | **Box Lab**: every coloured box rngdle.com knows how to draw, with your number in all of them, then the same boxes in words and colours of your own. Palettes can be published to a shared gallery (`src/gallery.js`, D1). |
| `/beta/collector` | **Coupon collector**: rolls needed to earn all 233 badges, simulated over the real earner sets, against a greedy cover of the same badge list. |
| `/beta/anatomy` | **Plain properties against score**: digit sum, distinct digits, longest run, divisibility, palindromes - each measured as lift against the range average and ranked by how much spread it actually produces. |
| `/beta/economy` | **Badge pricing**, written up as a finding: EP turns out to be exactly `100 / P(earn)` for every badge, so supersession is the only thing that varies. |
| `/beta/species` | The range grouped by **exact badge set** - distinct kinds, their rank-size curve, and the numbers that score like nothing else. |

Ported to rngdle.tools, and gone from here: the calculator and its *Analyze all scores*
panel (now **Sandbox** and **Analysis**), `/badges` (**Badges**, compact layout), `/grid`
(**Grid**), `/u` (**Profiles**), `/beta/nearmiss` (**Neighbours**) and `/beta/luck`
(**Luck**). The old `/beta` index is its **Other** tab.

Three things worth knowing about the code:

- Tool pages are marked `noindex`. Their only entry point is rngdle.tools' **Other**
  tab; the rail down their left edge links to that site's tabs.
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

- `src/examples.gen.js` - the first 3 numbers that earn each badge (read by the /beta
  tools, e.g. the Collector's greedy cover).
- `src/probabilities.gen.js` - each badge's exact share of all inputs (the
  "X% of numbers earn this" figure the /beta tools quote).
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
