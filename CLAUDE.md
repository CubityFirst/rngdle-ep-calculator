# rngdle_solver

## Before any commit or deploy

If a badge `test`, EP value, `FAMILIES` entry, or badge list changed, run
`npm run gen` first (full 1,000,001-number scan, ~25 s) and commit the regenerated
files with the change:

- `src/examples.gen.js` (per-badge example numbers, used by `/badges`)
- `src/probabilities.gen.js` ("% of numbers earn this", used in tooltips + `/badges`)
- `research/badge-tally.json` (diffable per-badge earn/score tally of the whole range)

`npm run deploy` runs the generator automatically via `predeploy`, but the resulting
diff still has to be committed. Never hand-edit `*.gen.js` files.

## Other invariants

- Badge rules are at full parity with rngdle.com; don't "simplify" a `test` or the
  prod-ported `p*` helpers without re-checking parity (see README "Rules").
- `FAMILY_NAMES` in `src/index.js` is index-aligned with `FAMILIES` - keep them in sync.
- Wrangler is invoked via npm scripts / `npx wrangler`, never a global install.
