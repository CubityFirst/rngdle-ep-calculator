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
- **JSON API:** `GET /api?n=696969` →
  `{ number, totalEP, count, badges: [{ id, label, emoji, ep, rarity }] }`
- **Browser engine:** `GET /engine.js` — an ES module (`computeLean`, `BADGE_META`)
  *generated from the live badge table* via `Function.prototype.toString()`, used by the
  analysis Web Worker. There is no second copy of the rules: edit a `test` once and it
  flows into both the server calculator and the client analysis.

## Analyze all scores

The **📊 Analyze all scores** button sweeps the whole 0–999,999 range in a client-side
Web Worker (the work is far past a single Worker request's CPU budget) and plots the
**EP distribution** as a log/log histogram.

- **Filter by number length** (1–6 digits). This drives *what gets computed*: lengths 1–5
  are only 100k numbers total, so they are always computed **exactly**. Only the 6-digit
  bucket (900k) is optionally **sampled** (by a hash of `n`, so divisibility-based badges
  like Even/Odd/Prime stay representative); sampled 6-digit counts are **weighted by the
  stride** so the histogram still reflects the true full range.
- **Filter by badge(s)** — restrict to numbers that earn *all* selected badges (instant
  re-filter; no recompute).
- **Resolution** — Full (every number) or a sample; only affects the 6-digit bucket.
- **Exports:** *Matching numbers (.csv)* dumps the current filter as `number,totalEP`;
  *Examples per badge (.txt)* lists example numbers for every badge. Use **Full** resolution
  for complete examples (6-digit-only badges are missed by sampling).

## How it works

`src/index.js` contains all 203 badges as `[id, label, emoji, ep, rarity, test(c)]`.
For an input `n`, every `test` runs against a precomputed context (digit array,
counts, sum, product, substring helper, etc.); matches are summed into `totalEP`.

## ⚠️ Assumptions (please verify against the live game)

Many badge rules are described in prose in the CSV and are ambiguous. These are the
judgment calls I made — if any disagree with the real game, tell me the badge and
the intended rule and I'll fix the single `test` function.

- **Number format:** the number is its plain decimal string with no leading zeros
  (e.g. `42` → `"42"`, `0` → `"0"`).
- **Tier supersession:** some badges are nested tiers of the same idea — earning a higher
  tier implies the lower ones, so only the **highest earned tier scores EP**; lower tiers
  are still displayed but score **0**. Handled via `SUPERSEDE_GROUPS` in `src/index.js`.
  Currently applied to (confirmed against prod):
  - **Contiguous Pair → Pair** (`634700` = 18,194)
  - **Pi: exact Pi → Slice (5) → Slice (4) → Slice (3)**
  - **E: exact E → Slice (5) → Slice (4) → Slice (3)** (same structure as Pi)
  - **Deep Void (5) → (4) → (3) → Deep Void** and **Contiguous Full House → Full House**
    (`455000` = 1,188,838)
  - **Jackpot Six → Five → Four → Jackpot** (7s in a row)
  - **Contiguous Sixes → Fives → Quads → Trips** — note **Contiguous Pair is excluded**:
    it's a base badge that always scores, even with a longer run present
  - **Four of a Kind → Three of a Kind**
  - **Mini Echo → Rhyme** (a mini echo is a more specific repeat) — all confirmed by
    `407777` = 409,497
  - **Perfect powers** (19th → 17th → … → Cube → Square) — only the highest exponent earned
    scores; confirmed by `0` = 139,927,162 (a perfect power of every exponent)
  - **Exact digit → Single Digit** (Two/Three/… supersedes Single Digit), confirmed by `2`

  Note: "ends in zeros" is NOT a supersession tier — `Millennium` (ends 000) and
  `Century` (ends 00) both score in full, confirmed by `455000`. Likewise some "base"
  badges (Contiguous Pair, Lucky Seven) keep scoring even when a stronger badge implies
  them — only the families listed above collapse.
- **A pair means a digit appearing exactly twice.** A triple/quad is not counted as a
  "pair", so `455000` (5×2, 0×3) is a Full House, not Two Pair. Applies to **Two Pair**,
  **Three Pair**, and the contiguous pair-count badges (run-length based).
- **Rhyme** needs the repeated 2+ digit substring to appear **non-overlapping**, so the
  `00` inside `000` does not by itself make a rhyme.
- **Perfect powers** (square, cube, 4th…19th power): **`0` and `1` both count** as perfect
  powers of *every* exponent (`0 = 0ⁿ`, `1 = 1ⁿ`) and earn all 13 power badges — but they
  form **one tier family**, so only the highest exponent scores (the rest display as 0).
  `0` is confirmed against prod (`0` = **139,927,162**); **`1` is assumed by request and not
  yet prod-verified**. (`1` is still not a *Power of Two/Three*, which require exponent ≥ 1.)
- **Power of 2 / Power of 3:** exponent **≥ 1**, so `1` does **not** count.
- **Factorial** includes `1` (= 0! and 1!). **Fibonacci** and **Pronic** include `0`.
- **Single-digit numbers:** prod *does* award the badges that are simply true of a one-char
  string — **Palindrome, Flush, Heterogeneous** — but *not* the ones that imply repetition or
  two positions (Homogeneous, Equilibrium). Confirmed against prod: `2` = **119,610,065**.
  Also, **Single Digit** is displayed but scores **0**: the exact digit badge (Two, Three…)
  supersedes it (see `SUPERSEDE_GROUPS`). Single digits still get digit-set/value badges
  (Void, Prime, Low Ball…).
- **Sequence (3/4/6)** = contiguous **ascending** run only. **Straight (5)** =
  ascending *or* descending (as the CSV explicitly states for that one).
- **"Consecutive Numbers" (pair) badges** require at least one **multi-digit** part:
  `1213` (12, 13) counts, but a single-digit run like `12` does not — single-digit
  consecutive pairs are covered by **Neighbors** instead. (Confirmed against the live
  game: `3125` = 6,271,772 EP.) Triple/quad consecutive badges still allow single-digit
  splits (e.g. `1234`), since 4 multi-digit consecutive numbers won't fit in 6 digits.
- **Spy / Even Spacing / arithmetic** badges require ≥ 2 / ≥ 3 digits respectively.
- **Echo** requires even length ≥ 4 (so `"11"` is treated as a Pair, not an Echo).
- **Divisible by Three** = every *digit* ∈ {0,3,6,9} (per the CSV wording), not
  "number divisible by 3".
- **Framed / consecutive-split** badges disallow leading-zero parts (except `"0"`).
- `0` is **Even** but does **not** earn the other modular badges (Eleven, Dozen, Lucky
  Seven Div) — prod requires `n > 0` for those even though `0 % k === 0`. Harshad also
  excludes it (digit sum 0). `0` *does* earn **Spy** (sum 0 = product 0), unlike the other
  single digits. All confirmed against prod: `0` = 139,927,162.

Edit any `test` in `src/index.js` to change behavior — each is one self-contained line.
