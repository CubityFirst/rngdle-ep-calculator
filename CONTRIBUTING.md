# Contributing

## Setup & dev loop

```bash
npm install          # installs wrangler
npm run serve        # plain-Node dev server: site/ from disk + the Worker (http://127.0.0.1:8787)
npm run dev          # wrangler dev: serves dist/, so run npm run build after editing site/; has a local D1
npm run check        # tools/check.cjs - engine, indexes, markup, legacy catalogue
npm run build        # tools/build-dist.cjs - assemble dist/ from site/
npm test             # badge-logic test harness
npm run test:browser # real-browser smoke test of /chains and the /beta tools
npm run test:deploy  # the same, against the esbuild bundle - run before deploying
npm run test:supersession  # /beta's family rule vs research/badge-tally.json (~2 min)
npm run test:gallery # the /beta/boxes gallery's routes, against schema.sql
npm run test:gallery-ui    # the same gallery in a browser, against a real D1
npm run deploy       # publish to Cloudflare (gen-snapshot first; wrangler runs check + build)
```

The repo is one Worker in three parts - `site/` (the front end), `src/index.js` and
friends (the engine and the legacy tools), `src/worker.js` (the entry point) - see
CLAUDE.md for the map and the rules that follow from it. `site/README.md` documents
the front end page by page.

`tools/check.cjs` is the deploy gate: wrangler's build runs it, so a stale EP index,
a duplicate top-level name across the page scripts, or a legacy tool the site has
already ported all fail the deploy rather than shipping.

`test:browser` loads every legacy page at desktop and phone widths, waits for its
sweep, and then drives its controls, failing on any console error, any horizontal
overflow, or any control that does nothing. It skips itself (exit 0) when
playwright-core is not installed.

`test:gallery` runs the gallery's routes against `schema.sql` through a node:sqlite
stand-in, so every query it checks is the query production runs. It also replays each
statement the Worker issued through `EXPLAIN QUERY PLAN` and fails on a full table scan
or a temp B-tree - D1 bills rows read, so a query that quietly stopped using its index
costs more per call for ever without breaking, slowing down, or saying anything.

`test:gallery-ui` covers the half of the gallery that only exists in the browser: the
cursor paging, the hearts and the sort tabs. It needs a database to do anything, so it
starts `wrangler dev` against a throwaway one (`--persist-to` a temp directory, seeded
and then deleted) - your own local gallery is never touched. Like `test:browser`, it
skips itself with exit 0 when playwright-core or wrangler cannot be started.

`test:supersession` matters because `/beta/economy` and `/beta/collector` re-implement
the family rule in a Web Worker, over the sweep bitmask rather than through `compute()`.
A mistake there would be invisible - the numbers would still look plausible - so the
check runs both implementations over the whole range and compares them against the
committed tally. Run it after touching `FAMILIES`, a badge's EP, or either copy of the
supersession logic.

**Run `npm run test:deploy` before any deploy that touches a legacy page's client code.**
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

- `src/examples.gen.js` - per-badge example numbers, read by the /beta tools
- `src/probabilities.gen.js` - "% of numbers earn this", read by the /beta tools
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
- New UI goes in `site/`. A tool ported there comes out of `BETA_TOOLS` / `RENDERERS`
  so the Other tab stops listing it (`npm run check` enforces this).

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): summary in imperative mood
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`.

Scopes are optional but preferred; the ones in use: `site` (the front end as a whole),
or a tab - `roll`, `ep`, `analysis`, `grid`, `neighbours`, `luck`, `badges`,
`profiles`, `other`; `engine` (the badge table, EP values, families, history,
`/engine.js`), `beta` (the `/beta` lab in `src/beta.js`), `chains`, `api`, `gallery`
(the Box Lab's D1 gallery), `gen` (generator/snapshots), `tools`, `research`.
Older history uses `card` for the calculator that became the Roll tab, and `sandbox` for the Roll tab itself.

Examples:

```
feat(other): list the legacy tools from the engine's own catalogue
feat(engine): track prod's 2026-09-05 bundle - Void Depth swallows the zero ladders
fix(beta): keep the atlas picking pass off the main thread
chore(gen): regenerate snapshots after EP rebalance
docs: add contributing guide
```

Regenerated `*.gen.js` / tally diffs ride along in the commit that caused them -
they don't get their own commit.

History before 2026-07-21 predates this convention ("Beta card: …"-style
subjects); don't rewrite it.
