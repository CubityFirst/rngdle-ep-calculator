# The front end (site/)

The RNGdle sandbox, served at rng.cubityfir.st (and, once the domain moves, at
rngdle.tools). This directory is the static site; `src/worker.js` serves it, and the
repo's root README covers the engine and the legacy tools around it. Paths below
are relative to the repo root.

A sandbox for [rngdle.com](https://www.rngdle.com). Roll as many times as you
like, or click the `??????` and type any number to see the badges and EP it
would have earned. The Badges tab maps every badge in the game, the Grid tab
draws all million numbers as one picture, Neighbours shows what one different
digit would have been worth, and Luck says how lucky a roll really was. The Other
tab holds the tools from the original solver that have no tab here yet.

This is the front end of what was two sites. The badge engine in `src/`, reverse-
engineered to full parity with rngdle, used to be a site of its own (the "solver");
it is now the engine and the legacy tools only, mounted for those paths (see
**Other** below).

Static site, but it routes on real paths (`/badges/pronic`), so it has to be
*served* rather than opened off disk — `file://` has no way to hand an unknown
path back to the app shell. `npm run serve` serves it straight from `site/`;
`npm run dev` (wrangler) matches production exactly.

## Deploying

Cloudflare Workers Static Assets, from the repo root:

```bash
npm run deploy             # gen-snapshot, then wrangler: check.js, build-dist.js, deploy
```

`wrangler.toml` attaches the custom domain and runs `tools/check.cjs && tools/build-dist.cjs`
as its build, so a bare `npx wrangler deploy` works too. `src/worker.js` is the
server code. It answers `/api/rolls` - rngdle's rolls API sends no CORS header, so
the Profiles page cannot read it from the browser - mounts `src/index.js` for the
Other tab's tools (below), and hands every other path to the asset binding.

The EP index ships **gzipped** and is inflated in the browser with
`DecompressionStream`. That is not premature: Cloudflare only auto-compresses by
content-type and skips `application/octet-stream`, so the raw `.bin` was going
out at the full 4.00 MB — measured on the live deploy. Pre-compressing brings it
to 2.10 MB and keeps the win on any other host.

## How it stays accurate

`vendor/rngdle-engine.js` is rngdle's own badge-engine chunk, copied
byte-for-byte. `engine-shim.js` is a ~35-line Turbopack runtime that
instantiates it, so scoring, badge families, contributor digits and percentiles
are the real thing rather than a reimplementation. Spot-checked against live
rolls: `271824` → 5,005,875 EP / MYTHIC / 15 badges, matching rngdle exactly.

`vendor/rngdle.css` is rngdle's own Tailwind bundle. `style.css` is just
`extra.css` + that file.

## Roll timings

This is rngdle's own reveal schedule, transcribed from its roll page rather than
guessed — `app.js` holds the constants and `tools/check.cjs` asserts them:

```
r = 2000
digits:reveal-1..d   gap = 1000 + 1000*((n-1)/(d-1))**2
number:collapse      at r
r += 1000
badge:1..n           gap = 500 + 1000*(i/(n-1))**1.5
                     each tweens the EP pill 0.5s, ease power2.out
summary:show         r += 1500
rarity:reveal        r += 1000   EP pill colours, card pulse, Share row
stats:show           r += 250    the rank row pops in
totalEP:show         r += 1000   lifetime EP fades in
totalEP:animate      r += 1500   counts up 1.5s, +N floats off it
reveal:end           r += 2000   vignette lifts, Share highlight on
```

For six digits the landings are 2000 / 3000 / 4040 / 5200 / 6560 / 8200, which
matches the 2001 / 3002 / 4049 / 5205 / 6563 / 8203 sampled off the live site to
within ~7ms. Digits scramble every 100ms, each landing holds `digit-settle` for
400ms, and the last fires `finale-pulse` for 700ms.

**Badge cards drop in from above, not up from below.** rngdle tweens each one
`{opacity: 0, y: -20, scale: .98} -> {opacity: 1, y: 0, scale: 1}` over 0.35s
with `power2.out`, so it starts 20px high — overlapping the card above it — and
settles down into its slot. The badge card and each superseded row under it get
their own tween, as they do upstream, rather than the group moving as one block.
Here that is a CSS transition on the same curve
(`power2.out` is easeOutCubic, since GSAP's power2 is cubic), which needs a
`void card.offsetHeight` flush after unhiding or the browser coalesces the two
changes into one recalc and the card just pops in.

**The screen dims while you roll.** rngdle overlays a `Vignette` — a fixed
radial gradient, transparent to `rgba(0,0,0,0.1)` at the edges, `mix-blend-multiply`,
fading over 600ms — for the length of the reveal. It lifts at rngdle's
`reveal:end`, which is 4.5s after the percentile: rngdle spends that on its two
lifetime-EP steps, and while there are no accounts here the sandbox waits the
same 4.5s so the edges come back at the same moment.

**Three badges in four don't get chips at all.** rngdle picks one footer per
card, in this order:

| badge | footer |
|---|---|
| `ELEVEN` · `DOZEN` · `LUCKY_SEVEN_DIV` · `HARSHAD` | `121,212 = 12 × 10,101` — the divisor in emerald, the quotient in the info blue. `HARSHAD` divides by its own digit sum |
| `PRONIC` | the same line, solving k(k+1) for k |
| anything with contributors | the digit chips — plus, for `EQUATION` only, a second line reading `100 − 1 = 99`, its three parts tinted with the group colours the chips use |
| nothing to point at | **no footer at all** — not a row of dead grey chips |

`PAIR` is the one badge whose contributors can be `null` while it is still the
scoring badge (`606436`), so it is the one that renders bare. `findEquation` for
the last case comes out of the vendored engine, module `47558`.

The slot count is `max(6, digits)`, as it is on rngdle — 1000000 is the one
7-digit result, and it gets a seventh slot and a seventh landing rather than
being truncated. The digit spans grow on demand and surplus ones are parked
(`w-0 opacity-0`) rather than destroyed, so they stay the same nodes.

**Nothing is spoiled early.** Through the roll and the whole badge stream the
card keeps its neutral grey, the EP pill reads `??? EP`, and the rarity and
percentile are not shown at all. They arrive 2.5s after the last badge — but
not all at once, and not in the order this file used to claim. Reading rngdle's
two state flags back to the setters in its own schedule (`ec` sets `en` at
rarity:reveal, `eh` sets `ex` at stats:show):

| gated on | what appears |
|---|---|
| `en` — rarity:reveal | the EP pill's rarity colours, the card's second pulse, **the Share row and its countdown** |
| `ex` — stats:show, 250ms later | **the whole rank row** — pill and percentile together — fading and scaling up with a `back.out(1.7)` overshoot, the pill popping harder with `back.out(3)` 100ms behind it |

So the colour lands first and the rank label follows it. The row is not split
across the two steps: the percentile does not trail the pill. (The overshoot is
why rngdle's own markup was caught mid-flight at `opacity: 1.0756` and
`scale(1.0768)`.) `app.js` implements `power2.out` and `back.out` in a ~20-line
rAF tween instead of pulling in GSAP.

**The card pulses twice.** rngdle passes it a `pulseKey`, bumped to 1 at
`number:collapse` and to 2 at `rarity:reveal`; each change plays
`finale-pulse` for 700ms. The first is a bare pop while the card is still
neutral. The second lands with the rank and additionally paints
`RARITY_FINALE_GLOW[tier]` as an inline box-shadow — the card pops *into* its
rank. Its other two states are mutually exclusive with the pulse:

```
spinning              -> animate-attention-glow
pulsing               -> animate-finale-pulse   (+ finale glow, if rank is known)
!spinning && !pulsing -> animate-breathing
```

so the card does not breathe while it is spinning or popping.

**The page has two layouts, not one.** rngdle's roll page is a different
container before and after there is a number: `pt-[12vh] sm:pt-[15vh]` while
the `??????` is waiting, then a tight `p-2 sm:p-8` the moment one exists, which
puts the card 48px under the header — measured on the live site, and matched
here. Using the first for both is what left a rolled number stranded a sixth of
the way down the page.

The inner column stays `max-w-2xl` in both, where rngdle narrows to `max-w-lg`
before a roll: type into the `??????` here and the badge breakdown is on screen
with no roll behind it, which is a state rngdle never has and which its narrower
pre-roll column would squash.

The sequence runs ~8s of digits plus roughly a second per badge, which is right
for one roll a day and tedious in a sandbox — so a click or keypress skips to
the finished result. The roll button fades and drops away for the duration
(collapsing the gap it leaves) and eases back once the reveal is done.

**Lifetime EP.** rngdle finishes the reveal by counting a signed-in player's
lifetime total up by the roll: the row fades in a second after the percentile,
then 1.5s later counts up over 1.5s with `power2.out` while the roll's own EP
floats off the total and fades (`animate-float-up-fade`, 1.5s). There are no
accounts here, so the sandbox keeps its own running total in `localStorage`
instead — every roll taken on this machine, added up. Typing a number is not a
roll and adds nothing, which is also how rngdle treats it: it has no way to
type one. The total is banked exactly once per roll whether the reveal runs out
or you skip it.

Two things matter for it to look smooth: the card and its six digit `<span>`s
are built once and mutated in place (rebuilding them per frame kills the
`transition-all duration-500` on each digit and restarts `breathing` 10×/sec),
and `setClass`/`setText` only write when the value actually changed.

## Badge digit diagrams

The row of digit chips under each badge is rngdle's `NumberMiniDiagram`, and it
is not a static highlight — it animates, which is most of what the breakdown
looks like in motion. `app.js` transcribes it:

```
intro   set every chip to the resting colours, then light the contributors
        0.2s each, power2.out, 0.08s apart
        starts 300*index + 100ms after the card mounts
loop    0.4s back to the resting colours (0.08s apart), a 0.1s beat,
        0.4s back to the highlight (0.08s apart), then 4s of rest — forever
```

So a six-chip badge replays its highlight every 5.70s and a two-chip one every
5.06s, which is what the live site measures at (5700 / ~5060). During a roll the
newest card is always index 0, so each diagram starts 100ms after its card
lands; typing a number instead mounts every card at once and they cascade 300ms
apart.

Chips are tinted per group rather than all one colour:

| contributors | colours |
|---|---|
| `groups` | rngdle's four `GROUP_HIGHLIGHT_COLORS`, one per group |
| `indices` on a pair/trip badge | the rarity's primary and secondary, alternating over runs of the same digit — or over the odd and even digits, for `ALTERNATOR` |
| anything else | the rarity's primary |

`MOUNTAIN` and `VALLEY` ripple outwards from their middle contributor instead of
sweeping left to right.

Upstream this is GSAP; here it is the same timelines on the ~20-line rAF tween
the roll already uses, with colours interpolated as RGB. The resting colours are
read from `--surface-raised` / `--prose-3` / `--outline` through a 1×1 canvas,
as rngdle does, so they work whatever syntax the theme uses.

One deliberate difference: rngdle leaves the chips unstyled until the intro's
`gsap.set` lands, which flashes a bare border for up to `300*index + 100ms`.
Here the resting colours are applied when the chip is built.

Which badges get a diagram at all — and which get an equation instead — is under
**Roll timings** above.

## Share

The Share button copies rngdle's share format, transcribed from its own builder
(`RARITY_SQUARE` and the badge/percentile layout are theirs), with this
sandbox's wordmark and URL:

```
RNGdle [Sandbox] 🎲 361061

⬜ COMMON • Bottom 21%

🟩 🎶 Rhyme
⬜ 👯‍♀️ Two Pair
⬜ 👻 Ghost
+7 more

3,802 EP
https://rngdle.tools
```

Squares are 🟫 trash · ⬜ common · 🟩 uncommon · 🟦 rare · 🟪 epic · 🟧 anomaly ·
🟥 mythic. The header square is the roll's tier; each badge line uses that
badge's own tier. Top three badges, then `+N more`.

One deliberate difference from rngdle: it omits the percentile line for middling
rolls (printing `Top` only at ≤50% and `Bottom` only below 10%); this always
prints it, so the copied text matches what the page is showing.

The button is hidden until the rank is revealed, then fades in with the
percentile carrying rngdle's `animate-share-highlight`. Touch devices get the
native share sheet; everything else copies, falling back to the old
`execCommand` selection trick where the async clipboard API is blocked.

Beside it sits rngdle's `Next roll in 3h 33m 08s` — the wait until the real
game's day rolls over at UTC midnight, in its format (unpadded hours, two-digit
minutes and seconds) and its place in the row. Nothing here is gated on it; the
sandbox rolls whenever you like. It just says when the real one resets.

## EP to Number

Second page (`/ep`). You give it an EP total, it lists every number in
0..1,000,000 that scores exactly that.

The badge engine has no inverse, so this is brute force — but precomputed.
`tools/build-ep-table.cjs` sweeps the range once and writes `ep-table.bin.gz`, a
flat little-endian `Uint32Array` of EP-per-number: 4.00MB inflated, 2.10MB
gzipped. The page fetches it, inflates it with `DecompressionStream`, and scans
it — 791ms on the live site including the download, then ~2ms per later search.

Doing the sweep in the browser instead was the first cut: split across
`hardwareConcurrency` Web Workers it took **15s on 12 cores**, so more like 45s
on a 4-core laptop and minutes on a phone. Shipping the table is the better
trade, and it deleted the worker, the IndexedDB cache and the progress UI.
Encoding it as a dictionary index instead was measured at 1.58MB vs 1.60MB
brotli — not worth the decode step. gzip rather than brotli only because
`DecompressionStream` has no brotli.

The table is *derived from* the vendored engine, so it goes stale when
`tools/refresh.cjs` pulls a new one. `tools/check.cjs` samples 259 entries against
the live engine and fails with the rebuild command if they disagree.

Facts from a full sweep, used to size the UI and pin `tools/check.cjs`:

| | |
|---|---|
| highest total | 186,186,584 (fits `Uint32`) |
| lowest total | 1,759 |
| distinct totals | 60,392 |
| numbers with a unique total | 23,244 |
| largest group | 2,119 numbers, all scoring 3,337 EP |
| median group size | 2 |

Only 60,392 of the values in that span are reachable at all, so most amounts you
type have no answer — those get the nearest reachable totals instead. Results
link to `/n/<number>`, which opens that number on the sandbox page.

## Analysis

Third page (`/analysis`). The EP distribution over the whole roll range, as a
log/log histogram stacked by card tier, narrowed by digit length, an EP window
(or an exact total), rarity tier, and the badges a number must or must not earn.
Each badge is tri-state — neutral, ✓ require, ✕ exclude — and a whole set can be
excluded at once. Under the chart: the rarity breakdown (which doubles as the
legend and as the tier toggles), the first 48 matching numbers linking into the
sandbox, a copy-all, a `.csv` of every match, and the first 12 numbers that earn
each badge as a `.txt`.

It is a port of rngdle_solver's *Analyze all scores* panel, restyled in this
site's own furniture, and with the sweep taken out: the solver computes every
number in the browser and caches it in IndexedDB, which is the 15s-on-12-cores
problem the EP table already solved. So the badge side is precomputed too.
`tools/build-ep-table.cjs` now writes a second file, `badge-table.bin.gz`: one
bitset per badge, in `BADGE_DEFINITIONS` order, bit *n* set when *n* earns it.
Superseded badges count as earned, as they do on rngdle's card.

The layout is badge-major on purpose. Per-number rows (233 bits each) would be
29MB that barely compresses; per-badge rows are the same 29MB inflated but each
one is a sparse or periodic bit pattern — `EVEN` is `10101010…`, an exact-number
badge is a single set bit — and the file gzips to **0.40MB**. Filtering reads
the rows directly (`bits[badge * 125001 + (n >> 3)]`), so there is no transpose
on load either.

The card tier of every number is derived on load rather than shipped: rngdle's
`getCardRarityTier` is applied to the 60,392 distinct totals to find the seven
EP cutoffs, and a 1M-element pass assigns each number its tier and digit count.
After that every filter change is one synchronous scan of the typed arrays,
about 15ms, debounced at 60ms — no worker.

`tools/check.cjs` samples the badge table the same way it samples the EP table:
259 numbers × 233 badges against the live engine, failing with the rebuild
command on any disagreement.

## Grid

Fourth page (`/grid`). Every number from 0 to 999,999 as one pixel on a
1000×1000 map — `n` sits at `(n % 1000, floor(n / 1000))`, so the last three
digits run left to right and the first three top to bottom. Four views: **badge
count** (the default, a heatmap of how many badges each number earns), **total
EP** (log-scaled, since it spans seven decades), **rarity** (each number's card
tier, in rngdle's own tier colours), and **one badge**, which lights up every
number that earns it. A badge view can also knock back the numbers where a
higher badge in the same family supersedes it — grey keeps them faint, black
paints them like non-members — using the same first-defined-wins tie rule the
scorer uses. Six colour scales (grayscale and matplotlib's viridis family),
zoom and pan by wheel, drag, pinch or the buttons, hover for the number, click
to open it in the sandbox, right-click to copy the map as a PNG. Every view is
a shareable URL: `/grid`, `/grid/ep`, `/grid/rarity`, `/grid/pronic`. Each
badge's page and compact card links to its map. The Konami code is honoured.

It is a port of rngdle_solver's `/grid`, in this site's furniture: the solver
draws it full-bleed with glass panels floating over the canvas; here the map
sits in a card with its legend under it and the badge list beside it. And,
as with Analysis, without the sweep — the solver scores the million numbers in
a Web Worker and caches them in IndexedDB. Everything the grid draws is read off
the two shipped indexes: EP straight from the EP table, membership straight from
a badge's bitset row, and the badge count by summing the 233 rows into one byte
per number — ~29M byte reads, about 70ms, done in one synchronous pass. (Not
sliced across timers: that took 13 seconds in a background tab, where Chrome
lets a timer fire once a second.) That is the only work on open; each view after that
is one pass painting a 1000×1000 `ImageData`, ~10ms, so nothing is cached. Card
tiers come from the same derivation the Analysis tab does.

Not ported: the solver's *Extend to 10,000,000* mode. There is no table for it —
it exists in the solver only because the solver can sweep the engine live — and
numbers above 1,000,000 are not legal rolls anyway.

## Neighbours

Fifth page (`/neighbours`, `/neighbours/<number>`). Take any number in its
six-digit zero-padded form and it has exactly 54 neighbours — six positions,
nine other digits each — every one a legal roll. The board shows all 54 as a
6×10 grid, each cell shaded by how that swap would have scored against the
number itself: green for more, red for less, the shade on the log ratio so a
3,000 EP roll and a 3,000,000 one read on the same scale. ★ marks the biggest
gain available and ▼ the biggest loss, on every cell tied at that value, and
neither is drawn unless it is real. Beside it: this number's EP and tier, its
best neighbour, what one digit would have gained, and how many of the 54 it
beats. The big number is the input, as the sandbox's `??????` is: type over it
and the board follows every keystroke, or hit the dice for a random roll.
Click any cell to walk to that number; the address bar follows.

Under that, the whole range walked once: how much of it sits one digit from a
mythic, how many numbers are local peaks (beat all 54) or valleys (lose to all
54), the mean best neighbour against the mean roll, then the ten cruellest near
misses — ordinary numbers ranked by how many times better one different digit
would have been — and the ten highest local peaks.

It is a port of rngdle_solver's `/beta/nearmiss` (*Near Misses*), renamed, in
this site's furniture: rngdle's success green and danger red for the shading,
its rarity pills for the tiers, its stat tiles for the figures. The solver
walks the 54 million neighbour pairs in a Web Worker over its own sweep; here
the EP table is already shipped, so the walk is one synchronous pass over it,
a few hundred milliseconds, done once. A number's own board is 60 reads.

## Luck

Sixth page (`/luck`, `/luck/<name>`, `/luck/<a>,<b>`). What a roll is worth
before you make it, and how lucky yours actually were. The EP table is the
exact distribution of scores over every legal roll, so every "how likely was
that?" question has a closed-form answer:

- **The range**: median roll, mean roll, where the top 1% starts, the best
  possible.
- **Best of N rolls**: the best of N is below x with probability F(x)^N, so
  the typical best, the middle-80% band and the chance of at least one mythic
  are all exact. A log-scaled slider to 10,000 rolls drives three tiles and a
  curve with the tier cutoffs drawn across it, and a milestone table reads the
  counts as days, since RNGdle is one roll a day: a week, a month, a year.
- **How lucky were yours?**: look up a player (through the site's own rolls
  proxy, scored locally) or paste any numbers. The reading is the best roll and
  its percentile, "luckier than" — F(best)^k, the exact share of players with
  k rolls whose best would come in below it — par for that many rolls, and the
  overall drift as a z-score on the mean percentile. Every roll sits as a tick
  on a percentile strip, the best eight are listed. Several names rank the
  players against each other in a table; a row opens that player's reading.
  Each profile page links to its own reading.

It is a port of rngdle_solver's `/beta/luck` (*Luck Lab*) in this site's
furniture — the Analysis chart's ticks and tooltip, the Profiles table, the
rarity pills. Additions over the solver: the log slider and milestone table,
the tier lines on the curve, real URLs for a reading, and the profile link.
Left out: the solver's histogram of single-roll scores and its tier-odds table;
the Analysis tab already draws the distribution and its rarity breakdown. The
solver sorts its own sweep in a Web Worker; here the
shipped table is sorted once on open, about 150ms.

## Badges

Third page (`/badges`). Every badge RNGdle can award, grouped into its own
collections, using the layout from rngdle's `/sets`: one card per set with its
icon, name and description, click to open, badges inside as rarity-coloured
pills running highest EP first (which is the order rngdle sorts them in — the
Casino set reads 10,288 → 120 EP down the list).

rngdle's `/sets` is a **progress tracker** for a signed-in player: `14/20`, a
percentage, a progress bar, and `???` in place of every badge you have not
rolled. None of that means anything here, so it is gone. This is the same
furniture as a map: every badge named, nothing counted against you. The only
number kept is how many badges a set holds, which is a fact about the set rather
than about you.

Clicking a badge opens its own page at `/badges/pronic`, which is rngdle's own
URL for it (the id, lower-cased). It is laid out the way rngdle's
`/u/<name>/badges/<id>` lays it out: the emoji, the name, the description, then
a three-column card of rarity, EP value and probability. Everything below that upstream is the signed-in half
(level, times earned, lifetime EP from the badge, roll history), so it is not
here. Spot-checked against the live page: `pronic` reads EPIC / 100,000 EP /
0.10% on both. A slug that names nothing falls back to the map.

The pills link the way rngdle's own `BadgePill` does — it wraps itself in a link
when given an href, and adds `hover:opacity-80 transition-opacity cursor-pointer`
when it has one.

The 16 sets are rngdle's, transcribed from the same page chunk `tools/refresh.cjs`
scrapes the engine from. Only the *names* are copied — labels, emoji, EP and
rarity are looked up in the vendored engine at runtime, so they cannot drift
from it.

Two things the sets alone don't cover, both pinned by `tools/check.cjs`:

- **59 of the 233 badges are in no set at all.** They are perfectly rollable, so
  a map has to carry them; they get a final `No Set` card, which is this
  sandbox's own and not rngdle's.
- **`BOOB` is named by Calculator Words but no longer exists** — it became
  `BOOB_8008`, `BOOB_58008` and `BOOB_80085`. Unresolvable ids are dropped
  rather than drawn as blank pills, which is why that set shows 4 and rngdle
  shows 5. The check asserts that `BOOB` is the *only* such id, so if rngdle
  renames anything else it fails instead of quietly shrinking a set.

### Compact layout

A toggle beside the title switches the map between **Official** — the `/sets`
layout above — and **Compact**, which is rngdle_solver's `/badges` index
redrawn in this site's furniture. One card per badge: emoji, name (linking to
its page), rarity pill, the rule, `+EP`, rngdle's own share-of-rolls figure,
and for the 168 badges in a family, who outranks whom (`outranked by`,
`ties with`, `outranks`, each a jump to that card). Over the top, the solver's
toolbar: a search over name, id, rule and rarity, one chip per tier with its
count, and a sort (EP either way, rarest or commonest first, A–Z).

Two things are deliberately not the solver's. Its cards carry a rarity-coloured
left edge; here the pill is the only colour, as it is everywhere else on the
site. And its examples come from a generated file; here they are the three
lowest numbers that earn each badge, read out of the same `badge-table.bin.gz`
the Analysis tab uses, fetched only when this layout is first opened and filled
in under the cards once it lands. The solver's history panel and "newly added"
banner describe its own port and have no counterpart here.

The choice is kept in `localStorage` (`badges-mode`), so the tab reopens the
way it was left, and it is in the URL too: **`/badges?layout=compact`** opens
the compact layout for anyone, whatever they last used, and the address bar
reads that whenever compact is showing (plain `/badges` when it is not), so
what you copy is what you were looking at. A `?layout=` in a link wins over
the remembered choice but does not replace it — the Badges tab still comes
back the way you left it. The compact page widens to 64rem — the cards are
18rem minimum, so that is three across on a desktop.

## Profiles

Fourth page (`/u`, then `/u/<name>`) — rngdle's own URL for a player. It draws
a real player's rolls in the shape rngdle's `/u/<name>` puts them: total EP, the
best roll, the badge collection with its star levels, and the roll history.

**Only the numbers come from rngdle.** `/api/rolls?u=<name>` in `worker.js`
proxies rngdle's public rolls API (which sends no CORS header, so the page
cannot call it itself) and returns nothing but `number`, `totalScore`,
`badgeCount`, `rolledAt`, `heartCount` and `poem`. Every figure on the page — EP, tier,
which badges, how many times, what level — is recomputed locally from the
numbers with the vendored engine. The proxy walks 100 rolls a page, stops at
2,000, sends an identifying user-agent and caches for five minutes.

**The star levels are Fibonacci minus one.** rngdle computes them server-side,
so they are in no chunk to copy. Derived instead: pair every pill's star count
on a 100-roll profile against the number of times that badge was actually
earned, and the thresholds fall out as `1, 2, 4, 7, 12, 20, 33, 54, 88, …`.
That reproduced all 82 star counts on that profile exactly, and the finished
page matches rngdle's own on all 83 badges — same badges, same slugs, same
levels — with the same total EP, best roll and roll history.

A copy button sits next to the name (lucide's `copy`, swapping to their `check`
for a moment the way the Share button does) and puts a plain-text summary on the
clipboard: the seven tier counts with their percentile bands, then total rolls,
longest streak of consecutive UTC days, badges collected, total EP, and the best
roll with its date. The band names are derived from rngdle's own
`CARD_PERCENTILE_THRESHOLDS` rather than typed in — uncommon starts where common
ends, which is "Top 50%" — and `tools/check.cjs` pins the seven strings that fall
out. All seven tiers are always listed, zeroes included.

Rolls with a poem show it the way rngdle does: lowercase monospace under the
number, with the heart count pinned right and a bare spacer holding that
position on the rolls without one. The heart is a readout, not a control —
liking needs an account. Poems are other players' writing, so they go in as
`textContent`, never markup.

Three things on rngdle's page are not in the API and are not invented here: the
display-name colour, the favourite-badge row, and the real "member since" date.
The page shows the first roll in the history instead and says so — for the
profile this was built against, that happens to be the same day.

### Several players at once

The search box takes more than one name — `alice, bob, carol`, or one per
line, or `@`-prefixed; anything that is not a username character separates
them — and routes to **`/u/alice,bob,carol`**, which is rngdle_solver's URL
for its combined view. Every name is fetched side by side through the same
proxy, and the rolls are pooled into one profile page: total EP and the badge
collection are the group's, the best roll says whose it was, and the roll
history interleaves everyone's rolls newest first with the owner on each. A
**Players** table above the history gives each player their own line — rolls,
EP, badges, streak, best roll — best collection first. The copyable summary
opens with the players and calls the streak "Combined", since it is the
longest run of days on which *someone* rolled; both are the solver's wording.

One bad name does not sink the rest: it is reported in a note over the page
and the others are pooled without it, as the solver does. At most ten players
go in one view — each is its own walk of rngdle's API — and names past that
are named in the same note.

### Roll history layouts

An Official / Compact switch sits by the Roll History heading. Official is
rngdle's own roll cards, as above. Compact is the solver's rolls table — date,
player (on a pooled view), number, tier, EP, badge count — in this site's
furniture: rngdle's rarity pill for the tier, the number linking into the
sandbox. Its last column carries the two things a card row has room for and a
table row does not, the heart count and a `✎` whose tooltip is the poem.
Either layout is drawn only when first shown. The choice is remembered
(`rolls-mode`) and put in the URL — `/u/alice?layout=compact` — exactly as the
Badges tab's is, with the same Back behaviour.

## Other

Ninth tab (`/other`). The engine in `src/` had a second life as a site of its
own - the "solver" - and most of it has been ported here: its calculator is the Sandbox, *Analyze all scores*
is Analysis, its `/badges` is the compact Badges layout, its `/grid` is Grid, its
`/u` is Profiles, and two of its `/beta` lab tools are Neighbours and Luck. What
had not been ported had no way in. This tab is that way in: one card per remaining
tool, in this site's furniture, each opening the tool on its own page in the
solver's own style. The full map, tool by tool:

| the solver (`src/`) | here |
|---|---|
| `/` calculator (click-to-type card, badge pills, contributor digits) | Sandbox, `/n/<number>` |
| `/` *Analyze all scores* panel | Analysis |
| `/badges` index (rule, EP, share, family, examples, history panel) | Badges, compact layout (no history panel) |
| `/grid` (and its *Extend to 10,000,000* mode) | Grid (no 10M mode) |
| `/u`, `/u/<a>,<b>` profiles | Profiles |
| `/beta/nearmiss` Near Misses | Neighbours |
| `/beta/luck` Luck Lab | Luck |
| `/chains` the EP graph | **Other** → `/chains` |
| `/beta/atlas`, `projections`, `spectrum`, `contact`, `pairs`, `anatomy`, `oracle`, `collection`, `boxes`, `collector`, `economy`, `species` | **Other** → `/beta/<tool>` |
| `/engine.js`, `/api`, `/api/profile`, `/api/palettes` | mounted as-is, for the tools above |
| — | EP to Number (this site's own) |

**Nothing is retyped.** `src/worker.js` imports `src/index.js` - the solver's Worker,
unchanged - and mounts it for exactly the paths it owns (`/beta/…`, `/chains`,
`/engine.js`, `/api`, `/api/profile`, the palette routes), passing this origin in as
`FRONT_END`, so the redirects the solver keeps for its retired pages (`/`, `/badges`,
`/grid`, `/u`) land back on the shell rather than anywhere else. `/beta` itself -
the solver's old lab index - is a 301 to `/other`.

The cards come the same way: `/api/other` serves the solver's own catalogue
(`legacyCatalogue()` in `src/beta.js`) - the titles, blurbs, one-line notes,
"see also" links and the little 64×40 marks its old index drew - and `other.js`
lays them out on this site's cards, with the index's "Some insights" findings
under them, each linking to the tool that measures it (two of those name tools
that were ported, and link to Neighbours and Luck instead). A tool added to
`BETA_TOOLS` shows up here with nothing to write.

Two things a legacy page does differently from a tab. It is a real page load:
the shell's router steps aside for those paths (`WORKER_PATHS` in `ep.js`), so a
click on a card is a navigation, and a cold load of `/beta/atlas` never runs the
shell at all. And it scores every number in the browser the first time - the
solver's tools read a Web Worker sweep of the live rules, cached in IndexedDB,
where this site's tabs read the shipped tables.

The Box Lab's shared palette gallery is the D1 database bound in `wrangler.toml`
(`npm run serve` has no D1, so there `/api/palettes` answers 503 and the Box Lab
runs without its gallery; `npm run dev` provisions a local one).

`tools/check.cjs` loads `src/index.js` and pins that its catalogue lists no tool
this site has ported, that every tool sits at a path `src/worker.js` forwards, and
that no path the shell routes is forwarded.

## Refreshing from upstream

When rngdle ships changes, re-scrape the two files it publishes:

```bash
node tools/refresh.cjs
```

That rewrites `vendor/` and rebuilds `style.css`. Then rebuild the two derived
indexes and verify everything agrees:

```bash
node tools/build-ep-table.cjs
node tools/check.cjs
```

If rngdle renames a module id, `engine-shim.js` (`load(10163)` / `load(5641)` /
`load(47558)`)
needs updating too.

The legacy tools need no refresh: they are `src/`, in this repo. After a change
there, `node tools/check.cjs` re-checks the catalogue.

## Layout

| file | what |
|---|---|
| `site/index.html` | page shell, markup copied from rngdle |
| `app.js` | the sandbox page |
| `extra.css` | fonts, rngdle's styled-jsx keyframes, a few utilities its bundle omits |
| `style.css` | built: `extra.css` + `vendor/rngdle.css` |
| `ep.js` | the EP -> Number page, and the routing for all twelve views |
| `analysis.js` | the Analysis page |
| `grid.js` | the Grid page |
| `neighbours.js` | the Neighbours page |
| `luck.js` | the Luck page |
| `badges.js` | the Badges map and the per-badge page |
| `profile.js` | the Profiles page |
| `other.js` | the Other tab: the legacy tools' gallery |
| `src/worker.js` | the `/api/rolls` proxy and the legacy mount; everything else falls through to the assets |
| `src/index.js` etc. | the engine and the legacy tools - the root README |
| `ep-table.bin.gz` | precomputed EP for every number, built by `tools/` |
| `badge-table.bin.gz` | precomputed badge bitsets, one row per badge, same build |
| `engine-shim.js` | Turbopack runtime shim, shared by page and tools |
| `vendor/` | upstream files, unmodified |
| `wrangler.toml` | Cloudflare Workers config (custom domain, assets, D1) |
| `tools/` | refresh, table build, dist build, checks |
| `site/rngdle.html` | ProtoType Studios' RNGdle calculator, kept as reference; not shipped |

Not affiliated with RNGdle.
