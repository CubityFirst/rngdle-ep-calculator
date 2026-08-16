# Contributing

## Setup & dev loop

```bash
npm install          # installs wrangler
npm run dev          # wrangler dev server (http://localhost:8787)
npm run serve        # plain-Node dev server (same worker, no wrangler hotkey loop)
npm test             # badge-logic test harness
npm run test:browser # real-browser smoke test of the /beta tools
npm run test:deploy  # the same, against the esbuild bundle - run before deploying
npm run test:supersession  # /beta's family rule vs research/badge-tally.json (~2 min)
npm run deploy       # publish to Cloudflare (runs the generator via predeploy)
```

`test:browser` loads every `/beta` page at desktop and phone widths, waits for its
sweep, and then drives its controls, failing on any console error, any horizontal
overflow, or any control that does nothing. It skips itself (exit 0) when
playwright-core is not installed.

`test:supersession` matters because `/beta/economy` and `/beta/collector` re-implement
the family rule in a Web Worker, over the sweep bitmask rather than through `compute()`.
A mistake there would be invisible - the numbers would still look plausible - so the
check runs both implementations over the whole range and compares them against the
committed tally. Run it after touching `FAMILIES`, a badge's EP, or either copy of the
supersession logic.

**Run `npm run test:deploy` before any deploy that touches a page's client code.**
The tools ship their client to the browser via `Function.prototype.toString()`, and
esbuild's `keepNames` rewrites those functions to call `__name()` - a helper that only
exists inside the bundle. A page can therefore work perfectly from `src/` and be broken
in production. `src/beta.js` ships a no-op `__name` shim to prevent that; the bundle run
is what proves it is still there.

Wrangler is always invoked through npm scripts / `npx wrangler` - never a global
install.

## Before any commit or deploy

If a badge `test`, EP value, `FAMILIES` entry, or the badge list changed, run
`npm run gen` (full 1,000,001-number scan, ~5 s on 16 cores) and commit the regenerated files
**in the same commit** as the change:

- `src/examples.gen.js` - per-badge example numbers, used by `/badges`
- `src/probabilities.gen.js` - "% of numbers earn this", used in tooltips + `/badges`
- `research/badge-tally.json` - diffable per-badge earn/score tally of the whole range

Never hand-edit `*.gen.js` files.

## Invariants

- Badge rules are at **full parity with rngdle.com**. Don't "simplify" a `test` or
  the prod-ported `p*` helpers without re-checking parity (see README "Rules").
- There is no second copy of the rules: `/engine.js` is generated from the badge
  table via `Function.prototype.toString()`, so badge `test`s must stay
  self-contained (no closing over module-level helpers that aren't shipped).
- `FAMILY_NAMES` in `src/index.js` is index-aligned with `FAMILIES` - keep them in
  sync.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): summary in imperative mood
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`.

Scopes are optional but preferred; the ones in use: `card` (the click-to-type
number card on `/`), `badges` (`/badges` index), `grid`, `analysis`, `profiles`
(`/u`), `beta` (the `/beta` lab in `src/beta.js`), `engine`, `gen`
(generator/snapshots), `research`.

Examples:

```
feat(card): even-spacing hover spreads all digits evenly apart
fix(card): align invisible input's text metrics with drawn digits
chore(gen): regenerate snapshots after EP rebalance
docs: add contributing guide
```

Regenerated `*.gen.js` / tally diffs ride along in the commit that caused them -
they don't get their own commit.

History before 2026-07-21 predates this convention ("Beta card: …"-style
subjects); don't rewrite it.
