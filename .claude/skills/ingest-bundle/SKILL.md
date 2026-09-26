---
name: ingest-bundle
description: Ingest a new rngdle.com bundle into this repo - snapshot the live scoring chunk, port every badge / EP / rule / family change into src/index.js at full parity, refresh the vendored engine and its indexes, regenerate, verify, commit. Use when rngdle ships changes, when asked to check for new badges, update from prod, refresh the engine, or when tools/check.cjs or parity starts failing because upstream moved.
---

# Ingest a new rngdle bundle

rngdle.com ships its whole scoring model client-side in one Turbopack chunk. This repo
keeps two copies of it in step: `site/vendor/rngdle-engine.js` (run byte for byte by the
front end) and `src/index.js` (a hand-ported engine at full parity, which the legacy
tools, `/engine.js` and the generators use). Ingesting a bundle means filing it, finding
what moved, porting that into `src/index.js`, and re-deriving everything downstream.

Work through the steps in order. Each has a check; don't move on while one fails.

## 1. Snapshot

```bash
npm run snapshot                      # or: node tools/snapshot.cjs --from <chunk> --date YYYY-MM-DD
```

- Files the chunk as `research/rngdle-<date>` and its exports as JSON under
  `research/rngdle-dump-<date>/` (`SCORED_BADGES`, `BADGE_DEFINITIONS` with check
  sources and `tests.match / reject` vectors, `SCORE_PERCENTILES`, `RARITY`, `manifest`).
- Prints and writes `DIFF.md`: **Upstream** (what changed since the previous snapshot)
  and **Repo** (what `src/index.js` disagrees with). The Repo section is the to-do list.
- "unchanged" means the live chunk is byte-identical to the last snapshot: stop and say so.
- If the Upstream section is empty (or only minifier noise: a swapped `||` operand, the
  same body re-lettered) and Repo says "none", skip to step 5.
- If it dies with "no module exports BADGE_DEFINITIONS", rngdle restructured: read the
  chunk by hand (`research/extract.mjs <term> <radius>` greps it) and fix
  `tools/prod-bundle.cjs` before anything else.

## 2. Port the engine (`src/index.js`)

For every line in the Repo section:

- **MISSING badge** - add `[id, label, emoji, ep, test]` to `BADGES` and the description to
  `DESCRIPTIONS`. Put the new batch under its own `// --- <date> batch ---` comment at the
  end of `BADGES`, keeping prod's `BADGE_DEFINITIONS` order *within a family* (a tie on EP
  goes to the first defined). The `test` gets the context `c` built at the top of
  `compute()`: `c.n`, `c.s` (decimal string, no leading zeros), `c.len`, `c.d` (digits),
  `c.counts`, `c.distinct`, `c.sum`, `c.prod`, `c.maxCount`, `c.has(sub)`, `c.cnt(digit)`,
  `c.withCount(k)`, `c.countExact(k)`, `c.runs`. Transcribe prod's `check(n, str)` from
  `BADGE_DEFINITIONS.json`; don't paraphrase it. A check that calls a prod util helper
  gets that helper ported verbatim as a `p*` function next to the others (`pHasSequence`,
  `pSplitParts`, ...) **and** added to the `named[]` list in `engineModuleSource()`, or
  `/engine.js` and the browser sweep ship without it. Tests must stay self-contained
  beyond those helpers: they are shipped via `Function.prototype.toString()`.
- **EXTRA badge** (retired upstream) - copy `[id, label, emoji, ep, description]` into the
  new `BADGE_HISTORY` entry's `retired` list *first*, then delete it from `BADGES`,
  `DESCRIPTIONS` and `FAMILIES`. Grep `test/test.mjs` for the id: fixtures encode rules.
- **score / label / emoji / description** - change the value. A score change usually
  means the rule changed too; check the CHECK lines in the Upstream section.
- **FAMILY** - edit `FAMILIES` (arrays of ids) and keep `FAMILY_NAMES` index-aligned; a
  new family is a new row in both. Membership must match prod as a set; order inside a
  row is the tie-break order, so follow prod's definition order.
- **CARD_TIERS** - paste the derived array and update the date in its comment. These are
  cut at percentiles of total EP, so they move whenever any badge moves.
- **RULES sample mismatch** - the rule itself differs. Use the badge's `tests.match` /
  `tests.reject` vectors and `node tools/parity.cjs --quick` to close in; the mismatch
  lines say which side has which badge.

Always add one `BADGE_HISTORY` entry for the bundle (date, a note in the voice of the
existing ones, `added` ids, `retired` rows), even when nothing came or went - the
2026-09-05 entry is the rule-only precedent. Nothing else needs bumping:
`BADGE_ADDED` / `badgeAdded()` derive from the list.

Check after porting:

```bash
node tools/parity.cjs --quick         # 0 mismatches on 1 in 97 numbers, ~2 s
node tools/parity.cjs                 # then the whole range, ~1 min
node research/badge-history.mjs       # BADGE_HISTORY agrees with git (dates are commit dates)
```

## 3. Regenerate

```bash
npm run gen                           # examples.gen.js, probabilities.gen.js, badge-tally.json (~5 s)
npm test                              # fixtures in test/test.mjs - update any that encoded a changed rule
npm run test:supersession             # only if FAMILIES or an EP changed (~2 min)
```

Never hand-edit a `*.gen.js` file. The `badge-tally.json` diff is the review artifact:
a new badge appears as a new row, a rule change as a changed count.

## 4. Front end: `site/`

```bash
npm run refresh                       # vendor the chunk + stylesheet, rebuild style.css
npm run ep-table                      # ep-table.bin.gz + badge-table.bin.gz (~3 min)
npm run check                         # the deploy gate
```

`tools/check.cjs` pins values from the vendored engine and will fail on a real change.
Each pin is a fact about the new bundle, so update it to the new value rather than
loosening it:

- `assert.strictEqual(defined.size, 233)` and the `unsorted.length` count - the badge
  total and how many are in no set of `site/badges.js`. A new badge belongs in a set
  there (`BADGE_SETS`, hand-copied from rngdle's Badges page) or in the unsorted count.
- `getPercentileForScore(34066)` and `analyzeNumber(1000000).totalScore` - re-read them
  from the new bundle: `node -e "const b=require('./tools/prod-bundle.cjs').loadBundle();
  console.log(b.ENGINE.getPercentileForScore(34066), b.ENGINE.analyzeNumber(1000000).totalScore)"`.
- The `CASES` table of live rolls - a roll whose badges changed needs its new count/tier.
- Module ids in `site/engine-shim.js` (`load(10163)` etc.) if the snapshot's `modules`
  line differs from them; `app.js`'s reveal schedule if rngdle re-timed the card.

The "Added" dates, the "Newly added" banner and the history panel on `/badges` all
derive from `BADGE_HISTORY`, so the entry from step 2 is what lights them up.

## 5. Commit

One commit per bundle, Conventional Commits, scope `engine`:

```
feat(engine): track prod's <date> bundle - <what moved, one line>
```

It carries together: `src/index.js`, the three regenerated files, `site/vendor/`,
`site/style.css`, both `.bin.gz` indexes, any `site/badges.js` / `tools/check.cjs` /
`test/test.mjs` updates. Paste the Upstream section of `DIFF.md` into the body. The
`research/` blobs stay gitignored; the dated bundle file is the only copy, so don't
delete old ones - `tools/parity.cjs --bundle` and `research/diff-bundles.mjs` replay them.

If nothing changed but the vendored copy (Repo "none"), the commit is
`chore(site): re-vendor rngdle's <date> bundle` with just `site/` files.

## Then

- `npm run test:deploy` before deploying if a legacy page's client changed.
- Deploy: `npm run deploy` (runs gen + check + build).
- Note anything non-obvious about the batch (a rule prod got "wrong", a tie-break, a
  dead badge) in the `BADGE_HISTORY` note or README "Rules" - that is where the next
  ingest will look.
