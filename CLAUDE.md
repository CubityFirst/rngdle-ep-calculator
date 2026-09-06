# rngdle_solver

## What this repo is

One Cloudflare Worker, deployed at rng.cubityfir.st (rngdle.tools moves here later):

- `site/` - the front end, a static single-page site in rngdle's own furniture around
  rngdle's own vendored engine (`site/vendor/`). Documented in `site/README.md`.
- `src/index.js` + `beta.js`, `gallery.js`, `ui.js` - the badge engine (full parity with
  rngdle.com) and the legacy tools the front end has no tab for: `/chains`, `/beta/<tool>`,
  `/engine.js`, `/api`, `/api/profile`, the D1 palette gallery.
- `src/worker.js` - the entry point (`wrangler.toml` main): `/api/rolls`, `/api/other`,
  the legacy mount, and the asset binding for everything else.
- `tools/*.cjs` - `check.cjs` (run before every deploy; wrangler's build runs it),
  `build-dist.cjs` (site/ -> dist/), `refresh.cjs` (re-vendor rngdle's bundle),
  `build-ep-table.cjs` (the two shipped indexes).

Rules that follow from that:

- New UI goes in `site/`, not in `src/`. Don't add HTML pages to the legacy module.
- A tool ported into `site/` comes *out* of `BETA_TOOLS` / `RENDERERS` in `src/beta.js`
  (as `nearmiss` and `luck` did) - `tools/check.cjs` fails if the Other tab's catalogue
  still lists something the site has a tab for.
- Links emitted by the legacy pages point at the front end's paths (`/n/<number>`,
  `/badges/<slug>`, `/grid/<slug>`, `/other`); `src/index.js` 301s its retired pages
  (`/`, `/badges`, `/grid`, `/u`, `/beta`) to the same origin (`FRONT_END_PATHS`).
- The legacy paths are listed in `run_worker_first` in `wrangler.toml`. Without that a
  browser navigation to `/beta/atlas` gets the app shell (curl does not show this).
- `tools/*.cjs` are CommonJS on purpose (the package is `"type": "module"`).
- `npm run serve` serves `site/` from disk; `npm run dev` (wrangler) serves `dist/`, so
  after editing `site/` under wrangler run `npm run build` or the change is invisible.
- The rngdle.tools repo is frozen; it carries a note. Don't develop there.

## Before any commit or deploy

If a badge `test`, EP value, `FAMILIES` entry, or badge list changed, run
`npm run gen` first (full 1,000,001-number scan, ~5 s on 16 cores) and commit the regenerated
files with the change:

- `src/examples.gen.js` (per-badge example numbers, read by the /beta tools)
- `src/probabilities.gen.js` ("% of numbers earn this", read by the /beta tools)
- `research/badge-tally.json` (diffable per-badge earn/score tally of the whole range)

`npm run deploy` runs the generator automatically via `predeploy`, but the resulting
diff still has to be committed. Never hand-edit `*.gen.js` files.

When rngdle ships a new bundle: `npm run refresh`, `npm run ep-table`, `npm run check`
(see `site/README.md`, "Refreshing from upstream"), and commit `site/vendor/`, the two
`.bin.gz` indexes and `site/style.css` together.

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
  card on the Other tab through `legacyCatalogue()`, so give it a `THUMBS` mark.
- The page scripts in `site/` are classic `<script>` tags sharing one global scope; a
  duplicate top-level name silently overwrites (`tools/check.cjs` scans for this).
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
