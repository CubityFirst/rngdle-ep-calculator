# rngdle_solver

## Before any commit or deploy

If a badge `test`, EP value, `FAMILIES` entry, or badge list changed, run
`npm run gen` first (full 1,000,001-number scan, ~5 s on 16 cores) and commit the regenerated
files with the change:

- `src/examples.gen.js` (per-badge example numbers, used by `/badges`)
- `src/probabilities.gen.js` ("% of numbers earn this", used in tooltips + `/badges`)
- `research/badge-tally.json` (diffable per-badge earn/score tally of the whole range)

`npm run deploy` runs the generator automatically via `predeploy`, but the resulting
diff still has to be committed. Never hand-edit `*.gen.js` files.

## Commit messages

Conventional Commits (`type(scope): summary`) - types, scopes, and examples are in
CONTRIBUTING.md. Pre-2026-07-21 history uses an older style; don't rewrite it.

## Other invariants

- Badge rules are at full parity with rngdle.com; don't "simplify" a `test` or the
  prod-ported `p*` helpers without re-checking parity (see README "Rules").
- `FAMILY_NAMES` in `src/index.js` is index-aligned with `FAMILIES` - keep them in sync.
- `src/beta.js` (the `/beta` lab) must not import from `src/index.js` - index.js imports
  it, so an edge back would be a cycle. Everything it needs arrives through `betaCtx()`.
  New tools need a `BETA_TOOLS` entry *and* a `RENDERERS` entry or the route 404s.
- Wrangler is invoked via npm scripts / `npx wrangler`, never a global install.
- `HOT_RANK` in `src/gallery.js` and the `palettes_hot` index in `schema.sql` must spell
  the same expression character for character - SQLite only uses an expression index
  when the `ORDER BY` matches it exactly, so changing `HEART_DAYS` on one side alone
  silently drops the default sort back to reading and sorting every visible row.
  `node test/gallery.mjs` catches this: it replays every statement the Worker issued
  through `EXPLAIN QUERY PLAN` and fails on a full scan or a temp B-tree.
- `schema.sql` is all `IF NOT EXISTS`, so it is also the migration - after adding an
  index, re-apply it (`npx wrangler d1 execute rngdle --file=schema.sql --remote`) or
  production keeps the old plan. Deploying the Worker does not touch the database.
