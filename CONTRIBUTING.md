# Contributing

## Setup & dev loop

```bash
npm install          # installs wrangler
npm run dev          # wrangler dev server (http://localhost:8787)
npm run serve        # plain-Node dev server (same worker, no wrangler hotkey loop)
npm test             # badge-logic test harness
npm run deploy       # publish to Cloudflare (runs the generator via predeploy)
```

Wrangler is always invoked through npm scripts / `npx wrangler` — never a global
install.

## Before any commit or deploy

If a badge `test`, EP value, `FAMILIES` entry, or the badge list changed, run
`npm run gen` (full 1,000,001-number scan, ~25 s) and commit the regenerated files
**in the same commit** as the change:

- `src/examples.gen.js` — per-badge example numbers, used by `/badges`
- `src/probabilities.gen.js` — "% of numbers earn this", used in tooltips + `/badges`
- `research/badge-tally.json` — diffable per-badge earn/score tally of the whole range

Never hand-edit `*.gen.js` files.

## Invariants

- Badge rules are at **full parity with rngdle.com**. Don't "simplify" a `test` or
  the prod-ported `p*` helpers without re-checking parity (see README "Rules").
- There is no second copy of the rules: `/engine.js` is generated from the badge
  table via `Function.prototype.toString()`, so badge `test`s must stay
  self-contained (no closing over module-level helpers that aren't shipped).
- `FAMILY_NAMES` in `src/index.js` is index-aligned with `FAMILIES` — keep them in
  sync.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): summary in imperative mood
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`.

Scopes are optional but preferred; the ones in use: `card` (the click-to-type
number card on `/`), `badges` (`/badges` index), `grid`, `analysis`, `profiles`
(`/u`), `engine`, `gen` (generator/snapshots), `research`.

Examples:

```
feat(card): even-spacing hover spreads all digits evenly apart
fix(card): align invisible input's text metrics with drawn digits
chore(gen): regenerate snapshots after EP rebalance
docs: add contributing guide
```

Regenerated `*.gen.js` / tally diffs ride along in the commit that caused them —
they don't get their own commit.

History before 2026-07-21 predates this convention ("Beta card: …"-style
subjects); don't rewrite it.
