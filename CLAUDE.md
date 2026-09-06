# rngdle_solver

## What this repo is now

The badge engine and the legacy tools behind **rngdle.tools** (`G:\Scripts\rngdle.tools`),
which is the front end. This Worker no longer renders a calculator, `/badges`, `/grid` or
`/u`: those paths 301 to rngdle.tools (`FRONT_END` / `FRONT_END_PATHS` in `src/index.js`).
It still serves `/engine.js`, `/api`, `/api/profile`, `/chains`, `/beta/<tool>` and the
Box Lab's `/api/palettes` - and rngdle.tools serves exactly those too, by copying
`src/*.js` + `schema.sql` into its `legacy/` directory (`node tools/sync-legacy.js` over
there) and mounting this module on its own Worker with `env.FRONT_END` set to its origin.

- New UI goes in rngdle.tools, not here. Don't add HTML pages to this Worker.
- After a commit here that touches `src/` or `schema.sql`, re-run rngdle.tools'
  `node tools/sync-legacy.js` and commit its `legacy/` - it is a byte-for-byte copy, never
  edited there, and Workers Builds clones that repo alone.
- Links emitted by the legacy pages point at the new front end's paths (`/n/<number>`,
  `/badges/<slug>`, `/grid/<slug>`, `/other`), which resolve on rngdle.tools' origin.

## Before any commit or deploy

If a badge `test`, EP value, `FAMILIES` entry, or badge list changed, run
`npm run gen` first (full 1,000,001-number scan, ~5 s on 16 cores) and commit the regenerated
files with the change:

- `src/examples.gen.js` (per-badge example numbers, read by the /beta tools)
- `src/probabilities.gen.js` ("% of numbers earn this", read by the /beta tools)
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
- Every badge-set change needs one `BADGE_HISTORY` entry in `src/index.js` (date, note,
  `added` ids, `retired`). Before deleting a badge from `BADGES`, copy its
  `[id, label, emoji, ep, description]` into that entry's `retired` list - once it is out
  of `BADGES` and `DESCRIPTIONS`, `BADGE_HISTORY` is the only record it ever existed.
  `BADGE_ADDED` / `badgeAdded()` derive from the list, so nothing else needs bumping.
  `node research/badge-history.mjs` re-derives the whole timeline from git and exits
  non-zero if the committed list has drifted.
- `src/beta.js` (the `/beta` lab) must not import from `src/index.js` - index.js imports
  it, so an edge back would be a cycle. Everything it needs arrives through `betaCtx()`.
  New tools need a `BETA_TOOLS` entry *and* a `RENDERERS` entry or the route 404s; a tool
  rendered elsewhere carries an `href` instead (`/chains`). Every `BETA_TOOLS` entry is a
  card on rngdle.tools' Other tab through `legacyCatalogue()`, so give it a `THUMBS` mark.
- A tool that gets ported to rngdle.tools comes *out* of `BETA_TOOLS` and `RENDERERS`
  (as `nearmiss` and `luck` did) - rngdle.tools' `tools/check.js` fails if the catalogue
  still lists something it has a tab for.
- Wrangler is invoked via npm scripts / `npx wrangler`, never a global install.
- `HOT_RANK` in `src/gallery.js` and the `palettes_hot` index in `schema.sql` must spell
  the same expression character for character - SQLite only uses an expression index
  when the `ORDER BY` matches it exactly, so changing `HEART_DAYS` on one side alone
  silently drops the default sort back to reading and sorting every visible row.
  `node test/gallery.mjs` catches this: it replays every statement the Worker issued
  through `EXPLAIN QUERY PLAN` and fails on a full scan or a temp B-tree.
- `schema.sql` is all `IF NOT EXISTS`, so it is also the migration - after adding an
  index, re-apply it (`npx wrangler d1 execute rngdle --file=schema.sql --remote`) or
  production keeps the old plan. Deploying the Worker does not touch the database. The
  database is on the cubityfir.st account; rngdle.tools deploys to a different one and
  has no binding yet (its `wrangler.jsonc` has the steps), so its gallery answers 503.
