// Smallest thing that fails if the vendored engine, the runtime shim, or the
// reveal schedule in site/app.js stops matching rngdle, or if the legacy tools'
// catalogue drifts from what the site has ported. Run after tools/refresh.cjs and
// before every deploy (wrangler's build runs it).
//   node tools/check.cjs
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const REPO = path.join(__dirname, "..");
const ROOT = path.join(REPO, "site");               // the static front end
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// Run app.js's shim (everything above the first "--- formatting" banner) plus
// the vendored chunk, in a bare context. Same code the browser runs.
const shim = fs.readFileSync(path.join(ROOT, "engine-shim.js"), "utf8");
assert.ok(shim.includes("load(10163)"), "engine-shim.js not found — did the file get restructured?");

const ctx = vm.createContext({ console });
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(ROOT, "vendor/rngdle-engine.js"), "utf8"), ctx);
// `const` in a vm script stays lexical, so hand the two bindings back out.
const { ENGINE, RARITY, BADGES } = vm.runInContext(shim + ";({ ENGINE, RARITY, BADGES })", ctx);

// Known-good live rolls from rngdle.com.
const CASES = [
  { n: 271824, ep: 5005875, tier: "mythic", badges: 18, scoring: 15 },
  { n: 572666, ep: 34066, tier: "epic", badges: 17, scoring: 16 },
];

for (const c of CASES) {
  const r = ENGINE.composeRollResult(c.n);
  assert.strictEqual(r.totalScore, c.ep, `${c.n}: EP ${r.totalScore} != ${c.ep}`);
  assert.strictEqual(RARITY.getCardRarityTier(r.totalScore), c.tier, `${c.n}: wrong rarity tier`);
  assert.strictEqual(r.badges.length, c.badges, `${c.n}: ${r.badges.length} badges != ${c.badges}`);
  assert.strictEqual(r.badges.filter(b => b.isScoring).length, c.scoring, `${c.n}: wrong scoring-badge count`);
  // Every badge the UI renders needs a label, a description and a rarity pill.
  for (const b of r.badges) {
    assert.ok(b.label && b.description, `${c.n}: badge ${b.id} missing label/description`);
    assert.ok(RARITY.RARITY_PALETTE[RARITY.getBadgeRarityTier(b.score)].pill.label, `${c.n}: no pill for ${b.id}`);
  }
  console.log(`ok  ${c.n} -> ${r.totalScore.toLocaleString()} EP, ${c.tier}, ${c.badges} badges`);
}

// Percentiles must come from rngdle's own table, not a fitted curve.
assert.ok(Math.abs(ENGINE.getPercentileForScore(34066) - 94.631805) < 1e-6, "percentile table missing or changed");
console.log("ok  percentile table");

// Contributor shapes the UI knows how to draw.
const KNOWN = new Set(["whole", "range", "indices", "groups"]);
for (const b of ENGINE.composeRollResult(572666).badges) {
  const c = ENGINE.getBadgeContributors(b.id, 572666);
  assert.ok(c === null || KNOWN.has(c.type), `unhandled contributor type "${c && c.type}" on ${b.id}`);
}
console.log("ok  contributor shapes");

// The second pulse paints RARITY_FINALE_GLOW, so every tier needs one.
const TIERS = ["trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic"];
for (const t of TIERS) {
  assert.ok(RARITY.RARITY_FINALE_GLOW[t], `no RARITY_FINALE_GLOW for "${t}"`);
  assert.ok(RARITY.RARITY_ARTIFACT_STYLES[t], `no RARITY_ARTIFACT_STYLES for "${t}"`);
  assert.ok(RARITY.RARITY_PALETTE[t].pill.label, `no rarity pill for "${t}"`);
}
assert.ok(app.includes("RARITY_FINALE_GLOW"), "app.js no longer paints the finale glow");
assert.ok(app.includes("animate-attention-glow"), "app.js no longer glows while spinning");
console.log("ok  finale glow + palettes for all " + TIERS.length + " tiers");

// --- Badges ----------------------------------------------------------------
// badges.js carries rngdle's sets by hand, but looks the badges up in the
// engine, so a rename upstream would quietly shorten a set instead of failing.
// Pin both halves: what the sets name that the engine does not define, and how
// much of the engine the sets cover.
{
  const badgesJs = fs.readFileSync(path.join(ROOT, "badges.js"), "utf8");
  const sets = vm.runInContext(
    badgesJs.slice(badgesJs.indexOf("const BADGE_SETS"), badgesJs.indexOf("const UNSORTED_SET"))
      + ";BADGE_SETS", vm.createContext({}));

  assert.strictEqual(sets.length, 16, `${sets.length} sets, expected 16`);
  const defined = new Set(BADGES.BADGE_DEFINITIONS.map(b => b.id));
  const named = new Set(sets.flatMap(s => s.badges));

  // rngdle's Calculator Words still lists BOOB, which became BOOB_8008 and
  // friends. That one is expected; anything else means the engine moved.
  const missing = [...named].filter(id => !defined.has(id)).sort();
  assert.deepStrictEqual(missing, ["BOOB"], `sets name badges the engine lacks: ${missing.join(", ")}`);

  const unsorted = [...defined].filter(id => !named.has(id));
  assert.strictEqual(defined.size, 233, `${defined.size} badges defined, expected 233`);
  assert.strictEqual(unsorted.length, 59, `${unsorted.length} badges in no set, expected 59`);

  // Every badge gets a pill in the map and a page of its own, so all four
  // fields those render have to be there for all 233.
  const slugs = new Set();
  for (const id of defined) {
    const info = ENGINE.getBadgeInfo(id);
    assert.ok(info && info.label, `no label for ${id}`);
    assert.ok(info.description, `no description for ${id}`);
    assert.ok(Number.isFinite(info.score), `no score for ${id}`);
    assert.ok(info.probability, `no probability for ${id}`);
    // #badge=<id lower-cased> has to address exactly one badge.
    const slug = id.toLowerCase();
    assert.ok(!slugs.has(slug), `two badges share the slug "${slug}"`);
    slugs.add(slug);
  }
  assert.ok(fs.existsSync(path.join(ROOT, "badges.js")), "missing badges.js");
  console.log(`ok  badge sets: 16 sets, ${named.size - missing.length} sorted, ${unsorted.length} in no set, ${defined.size} total`);

  // The compact layout sorts by probability, which rngdle only exposes as a
  // string ("0.10%", "1.00e-4%"); every one has to read back as a number or
  // the rarest-first sort quietly scrambles. Its family lines come from the
  // same tag app.js groups by, so pin that count too.
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const id of ["badges-mode", "badges-official", "badges-compact", "bc-search", "bc-chips", "bc-sort", "bc-cards", "bc-count"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id} for the Badges layouts`);
  }
  const families = new Set();
  for (const b of BADGES.BADGE_DEFINITIONS) {
    const p = parseFloat(ENGINE.getBadgeInfo(b.id).probability.replace("%", ""));
    assert.ok(Number.isFinite(p) && p >= 0, `probability for ${b.id} does not parse`);
    if (b.family) families.add(b.family);
  }
  assert.strictEqual(families.size, 39, `${families.size} badge families, expected 39`);
  // 2026-09-05: rngdle folded CLEAN / CENTURY / MILLENNIUM / EPOCH / EON, the
  // four SEMI_ badges and the four DEEP_VOIDs into one VOID_DEPTH family, so a
  // round number now scores only its deepest zero-run badge. 168 in a family.
  const inFamily = BADGES.BADGE_DEFINITIONS.filter(b => b.family).length;
  assert.strictEqual(inFamily, 168, `${inFamily} badges carry a family, expected 168`);
  // Array.from: the ids come from the vm realm, so their prototype differs.
  const voidDepth = Array.from(BADGES.BADGE_DEFINITIONS.filter(b => b.family === "VOID_DEPTH").map(b => b.id)).sort();
  assert.deepStrictEqual(voidDepth, ["CENTURY", "CLEAN", "DEEP_VOID", "DEEP_VOID_FIVE", "DEEP_VOID_FOUR", "DEEP_VOID_THREE",
    "EON", "EPOCH", "MILLENNIUM", "SEMI_CENTURY", "SEMI_EON", "SEMI_EPOCH", "SEMI_MILLENNIUM"],
    `VOID_DEPTH family is ${voidDepth.join(", ")}`);
  {
    const r = ENGINE.composeRollResult(1000);
    const scoring = r.badges.filter(b => b.isScoring).map(b => b.id);
    const superseded = r.badges.filter(b => !b.isScoring).map(b => b.id);
    assert.ok(scoring.includes("MILLENNIUM"), "1000 should score MILLENNIUM");
    for (const id of ["CENTURY", "CLEAN", "DEEP_VOID", "DEEP_VOID_THREE"]) {
      assert.ok(superseded.includes(id), `1000: ${id} should be superseded by MILLENNIUM`);
    }
    assert.strictEqual(r.totalScore, 2786098, `1000 scores ${r.totalScore} EP, expected 2,786,098`);
  }
  // /badges?layout=compact is the shareable form; ep.js has to hand the query
  // through, and badges.js has to write it back so the address bar stays true.
  const epJs = fs.readFileSync(path.join(ROOT, "ep.js"), "utf8");
  const badgesSrc = fs.readFileSync(path.join(ROOT, "badges.js"), "utf8");
  assert.ok(epJs.includes(`buildBadges(new URLSearchParams(query).get("layout") || layoutHint)`), "ep.js no longer routes ?layout= to the Badges tab");
  assert.ok(badgesSrc.includes(`"/badges?layout=compact"`), "badges.js no longer writes ?layout=compact to the address bar");
  console.log(`ok  badges compact layout: ${families.size} families / ${inFamily} members, VOID_DEPTH supersedes, every probability parses, ?layout= routed`);
}

// --- Profiles --------------------------------------------------------------
// The badge star levels are derived, not copied — rngdle computes them
// server-side. Pin the curve and the shipping of the two files that need to be
// there for the page to work at all.
{
  const profileJs = fs.readFileSync(path.join(ROOT, "profile.js"), "utf8");
  const { STAR_THRESHOLDS, starLevel } = vm.runInContext(
    profileJs.slice(profileJs.indexOf("const STAR_THRESHOLDS"), profileJs.indexOf("const stars ="))
      + ";({ STAR_THRESHOLDS, starLevel })", vm.createContext({}));

  // Fibonacci minus one, fitted against a real profile's pills and exact on all
  // 82 badges it had. If this changes, the stars stop matching rngdle's.
  // Array.from: the array comes from the vm realm, so its prototype differs.
  assert.deepStrictEqual(Array.from(STAR_THRESHOLDS.slice(0, 9)), [1, 2, 4, 7, 12, 20, 33, 54, 88],
    `star thresholds are ${STAR_THRESHOLDS.slice(0, 9).join(", ")}`);
  // Spot values read straight off rngdle's own profile page.
  for (const [earned, level] of [[1, 1], [3, 2], [5, 3], [11, 4], [17, 5], [32, 6], [49, 7], [85, 8], [89, 9]]) {
    assert.strictEqual(starLevel(earned), level, `${earned} earns should be ${level} stars`);
  }
  assert.strictEqual(starLevel(0), 0, "a badge never earned has no stars");

  const worker = fs.readFileSync(path.join(REPO, "src/worker.js"), "utf8");
  assert.ok(worker.includes("env.ASSETS.fetch"), "src/worker.js must fall through to the assets");
  assert.ok(worker.includes("/api/rolls"), "src/worker.js must serve /api/rolls");
  const wrangler = fs.readFileSync(path.join(REPO, "wrangler.toml"), "utf8");
  assert.ok(/^main\s*=\s*"src\/worker\.js"/m.test(wrangler), "wrangler.toml must point main at src/worker.js");
  assert.ok(/^binding\s*=\s*"ASSETS"/m.test(wrangler), "the asset binding must be named ASSETS");
  const dist = fs.readFileSync(path.join(REPO, "tools/build-dist.cjs"), "utf8");
  for (const f of ["badges.js", "profile.js", "analysis.js", "grid.js", "neighbours.js", "luck.js", "other.js", "badge-table.bin.gz"]) {
    assert.ok(dist.includes(`"${f}"`), `${f} is missing from the dist allowlist`);
  }
  // Several players pool through /u/a,b,c, and the roll history has the same
  // Official / Compact switch as the Badges tab; pin the route and the markup.
  const epSrc = fs.readFileSync(path.join(ROOT, "ep.js"), "utf8");
  assert.ok(/\(\?:,\[A-Za-z0-9_-\]\{1,40\}\)\*\)\$\//.test(epSrc), "ep.js no longer routes /u/<a>,<b> to a pooled profile");
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const id of ["rolls-mode", "profile-note", "profile-players", "profile-players-rows", "profile-rolls", "profile-rolls-compact", "profile-rolls-head", "profile-rolls-rows"]) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html is missing #${id} for the Profiles page`);
  }
  assert.ok(profileJs.includes("const MAX_COMBINE = 10"), "profile.js should cap a pooled view at 10 players, as the solver does");
  console.log(`ok  profiles: star thresholds ${STAR_THRESHOLDS.slice(0, 9).join("/")}, worker + assets wired, pooled route + layouts`);

  // The copyable summary names each tier with its percentile band. Those are
  // derived from rngdle's CARD_PERCENTILE_THRESHOLDS, not typed in, so pin the
  // seven strings that fall out — a change upstream would silently reword them.
  const bandCtx = vm.createContext({ RARITY });
  vm.runInContext(
    profileJs.slice(profileJs.indexOf("const TIER_ORDER"), profileJs.indexOf("// Longest run")), bandCtx);
  const { tierBands, TIER_ORDER, TIER_SQUARE } =
    vm.runInContext("({ tierBands, TIER_ORDER, TIER_SQUARE })", bandCtx);
  const bands = tierBands();
  assert.deepStrictEqual(
    Array.from(TIER_ORDER).map(t => `${TIER_SQUARE[t]} ${bands[t]}`),
    [
      "🟥 Mythic (Top 1%)",
      "🟧 Anomaly (Top 5%)",
      "🟪 Epic (Top 10%)",
      "🟦 Rare (Top 25%)",
      "🟩 Uncommon (Top 50%)",
      "⬜ Common (Bottom 50%)",
      "🟫 Trash (Bottom 1%)",
    ],
    "the summary's tier bands no longer match rngdle's percentile thresholds");
  console.log("ok  summary tier bands: " + Array.from(TIER_ORDER).map(t => bands[t].replace(/ .*/, "")).join("/"));
}

// --- EP -> Number ----------------------------------------------------------
for (const f of ["engine-shim.js", "ep.js"]) {
  assert.ok(fs.existsSync(path.join(ROOT, f)), `missing ${f}`);
}
for (const [n, ep] of [[13066, 3337], [13088, 3337], [14408, 3337], [271824, 5005875]]) {
  assert.strictEqual(ENGINE.analyzeNumber(n).totalScore, ep, `${n} should score ${ep} EP`);
}
assert.strictEqual(ENGINE.analyzeNumber(1000000).totalScore, 131081274, "1000000 EP changed");
console.log("ok  EP->Number spot values");

// The shipped table is derived from the engine, so it can go stale when
// tools/refresh.cjs pulls a new one. Sample it rather than trust it.
{
  const N = 1000001;
  const p = path.join(ROOT, "ep-table.bin.gz");
  assert.ok(fs.existsSync(p), "ep-table.bin.gz missing — run: node tools/build-ep-table.cjs");
  const gz = fs.readFileSync(p);
  const buf = zlib.gunzipSync(gz);
  assert.strictEqual(buf.length, N * 4,
    `ep-table.bin.gz inflates to ${buf.length} bytes, expected ${N * 4} — rebuild it`);
  const ep = new Uint32Array(buf.buffer, buf.byteOffset, N);

  // Deterministic spread of samples plus the interesting edges.
  const samples = [0, 1, 7, 42, 1337, 271824, 572666, 999999, 1000000];
  for (let i = 0; i < 250; i++) samples.push((i * 7919 * 503) % N);
  for (const n of samples) {
    const want = ENGINE.analyzeNumber(n).totalScore;
    assert.strictEqual(ep[n], want,
      `ep-table.bin.gz is stale at ${n}: has ${ep[n]}, engine says ${want} — run: node tools/build-ep-table.cjs`);
  }
  let max = 0;
  for (let n = 0; n < N; n++) if (ep[n] > max) max = ep[n];
  assert.ok(max < 2 ** 32, "EP table must fit Uint32Array");
  console.log(`ok  ep-table.bin.gz matches the engine (${samples.length} samples, max ${max.toLocaleString()} EP, ${(gz.length / 1e6).toFixed(2)} MB on the wire)`);
}

// --- one global scope ------------------------------------------------------
// The page scripts are classic <script> tags, so every top-level declaration
// lands in one shared scope. A duplicate `function` silently overwrites the
// earlier one (analysis.js once shadowed app.js's badgeGroups and the sandbox
// lost its badge cards); a duplicate const/let throws before the page runs.
{
  const scripts = ["engine-shim.js", "app.js", "badges.js", "profile.js", "ep.js", "analysis.js", "grid.js", "neighbours.js", "luck.js", "other.js"];
  const seen = new Map();
  for (const f of scripts) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    const re = /^(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
    for (let m; (m = re.exec(src));) {
      assert.ok(!seen.has(m[1]), `${f} and ${seen.get(m[1])} both declare "${m[1]}" at top level`);
      seen.set(m[1], f);
    }
  }
  console.log(`ok  ${seen.size} top-level names across ${scripts.length} scripts, no collisions`);
}

// --- Analysis --------------------------------------------------------------
// badge-table.bin.gz is one bitset per badge, in BADGE_DEFINITIONS order, and
// is derived from the engine the same way the EP table is — so it goes stale
// the same way. Sample it.
{
  const N = 1000001, ROWB = Math.ceil(N / 8);
  const defs = BADGES.BADGE_DEFINITIONS;
  const p = path.join(ROOT, "badge-table.bin.gz");
  assert.ok(fs.existsSync(p), "badge-table.bin.gz missing — run: node tools/build-ep-table.cjs");
  const gz = fs.readFileSync(p);
  const bits = zlib.gunzipSync(gz);
  assert.strictEqual(bits.length, defs.length * ROWB,
    `badge-table.bin.gz inflates to ${bits.length} bytes, expected ${defs.length * ROWB} — rebuild it`);
  const samples = [0, 1, 7, 42, 1337, 271824, 572666, 999999, 1000000];
  for (let i = 0; i < 250; i++) samples.push((i * 7919 * 503) % N);
  for (const n of samples) {
    const want = new Set(ENGINE.analyzeNumber(n).badges);
    defs.forEach((b, i) => {
      const has = !!(bits[i * ROWB + (n >> 3)] & (1 << (n & 7)));
      assert.strictEqual(has, want.has(b.id),
        `badge-table.bin.gz is stale at ${n} / ${b.id}: has ${has}, engine says ${want.has(b.id)} — run: node tools/build-ep-table.cjs`);
    });
  }
  assert.ok(fs.existsSync(path.join(ROOT, "analysis.js")), "missing analysis.js");
  console.log(`ok  badge-table.bin.gz matches the engine (${samples.length} samples x ${defs.length} badges, ${(gz.length / 1e6).toFixed(2)} MB on the wire)`);
}

// --- Grid ------------------------------------------------------------------
// The grid reads the same two indexes and routes on /grid, /grid/ep,
// /grid/rarity and /grid/<badge slug>. Pin the markup it needs, the route, and
// that no badge slug collides with one of its own sub-paths.
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const id of ["view-grid", "grid-map", "grid-canvas", "grid-views", "grid-search", "grid-list", "grid-cmap",
                    "grid-sup", "grid-supmode", "grid-legend", "grid-title", "grid-stat", "grid-status", "badge-map"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id} for the Grid tab`);
  }
  assert.ok(html.includes('data-view="grid"'), "index.html has no Grid nav tab");
  assert.ok(html.includes('<script src="/grid.js" defer></script>'), "index.html does not load grid.js");
  const epSrc = fs.readFileSync(path.join(ROOT, "ep.js"), "utf8");
  assert.ok(epSrc.includes("showGrid("), "ep.js no longer routes /grid to the Grid tab");
  const gridSrc = fs.readFileSync(path.join(ROOT, "grid.js"), "utf8");
  const fixed = vm.runInContext(
    gridSrc.slice(gridSrc.indexOf("const GRID_FIXED_VIEWS"), gridSrc.indexOf("const GRID =")) + ";GRID_FIXED_VIEWS",
    vm.createContext({}));
  for (const b of BADGES.BADGE_DEFINITIONS) {
    assert.ok(!Array.from(fixed).includes(b.id.toLowerCase()), `badge ${b.id} slugs to /grid/${b.id.toLowerCase()}, which the grid reserves`);
  }
  // The badge pages and compact cards link into the grid by slug.
  const badgesSrc = fs.readFileSync(path.join(ROOT, "badges.js"), "utf8");
  assert.ok(badgesSrc.includes('badgeEl("badge-map").href = `/grid/${badgeSlug(id)}`'), "badges.js no longer links a badge page to the grid");
  console.log(`ok  grid: markup, /grid routes, ${Array.from(fixed).join("/")} reserved against ${BADGES.BADGE_DEFINITIONS.length} slugs`);
}

// --- Neighbours ------------------------------------------------------------
// Every number's 54 one-digit neighbours, read off the EP table. Pin the
// markup, the route, and — against the live engine — the arithmetic of one
// board: which swap of 123456 is best, and that 0 has 54 legal neighbours.
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const id of ["view-neighbours", "nb-form", "nb-input", "nb-random", "nb-board", "nb-cur", "nb-global", "nb-cruel", "nb-summits", "nb-open", "nb-stat"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id} for the Neighbours tab`);
  }
  assert.ok(html.includes('data-view="neighbours"'), "index.html has no Neighbours nav tab");
  assert.ok(html.includes('<script src="/neighbours.js" defer></script>'), "index.html does not load neighbours.js");
  const epSrc = fs.readFileSync(path.join(ROOT, "ep.js"), "utf8");
  assert.ok(epSrc.includes("showNeighbours("), "ep.js no longer routes /neighbours to the Neighbours tab");
  const POW = [100000, 10000, 1000, 100, 10, 1];
  const neighbours = n => {
    const out = [];
    for (let p = 0; p < 6; p++) {
      const d0 = Math.floor(n / POW[p]) % 10, base = n - d0 * POW[p];
      for (let d = 0; d < 10; d++) if (d !== d0) out.push(base + d * POW[p]);
    }
    return out;
  };
  for (const n of [0, 69, 123456, 999999]) {
    const ns = neighbours(n);
    assert.strictEqual(ns.length, 54, `${n} should have 54 neighbours`);
    assert.ok(ns.every(m => m >= 0 && m <= 999999 && m !== n), `${n}'s neighbours must all be legal rolls`);
  }
  console.log("ok  neighbours: markup, /neighbours route, 54 legal neighbours for 0 / 69 / 123456 / 999999");
}

// --- Luck ------------------------------------------------------------------
// The odds page sorts the shipped EP table into the exact distribution. Pin
// the markup, the route, the profile link into it, and the closed forms it
// rests on: F(x)^N for best-of-N, and the tier shares summing to one.
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const id of ["view-luck", "lk-head", "lk-rolls", "lk-n", "lk-bon", "lk-curve", "lk-milestones", "lk-user-form", "lk-user", "lk-paste", "lk-paste-go", "lk-verdict", "lk-stat", "profile-luck"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id} for the Luck tab`);
  }
  assert.ok(html.includes('data-view="luck"'), "index.html has no Luck nav tab");
  assert.ok(html.includes('<script src="/luck.js" defer></script>'), "index.html does not load luck.js");
  const epSrc = fs.readFileSync(path.join(ROOT, "ep.js"), "utf8");
  assert.ok(epSrc.includes("showLuck("), "ep.js no longer routes /luck to the Luck tab");
  const profileSrc = fs.readFileSync(path.join(ROOT, "profile.js"), "utf8");
  assert.ok(profileSrc.includes('profEl("profile-luck").href = `/luck/${wanted.join(",")}`'), "profile.js no longer links a profile to its luck reading");
  // The sorted table is the CDF; the tier shares over it must sum to one and
  // the median best of 1 roll must be the median roll.
  const N = 1000001;
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "ep-table.bin.gz")));
  const S = new Uint32Array(buf.buffer, buf.byteOffset, N).slice().sort();
  const cdf = x => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (S[m] <= x) lo = m + 1; else hi = m; } return lo / N; };
  const tiers = ["trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic"];
  const lows = tiers.map((t, i) => { if (!i) return 0; for (let k = 0; k < N; k++) if (RARITY.getCardRarityTier(S[k]) === t) return S[k]; throw new Error(`no ${t} roll`); });
  let sum = 0;
  for (let i = 0; i < tiers.length; i++) sum += cdf((i + 1 < tiers.length ? lows[i + 1] : Infinity) - .5) - cdf(lows[i] - .5);
  assert.ok(Math.abs(sum - 1) < 1e-9, `tier shares sum to ${sum}`);
  const quantile = p => S[Math.min(N - 1, Math.max(0, Math.round(p * N) - 1))];
  assert.strictEqual(quantile(Math.pow(.5, 1 / 1)), quantile(.5), "best of 1 roll should be the median roll");
  assert.ok(quantile(Math.pow(.5, 1 / 365)) > quantile(Math.pow(.5, 1 / 30)), "a year's best should beat a month's");
  const pMythicYear = 1 - Math.pow(cdf(lows[6] - .5), 365);
  assert.ok(pMythicYear > .9 && pMythicYear < 1, `a year of rolls should nearly always find a mythic, got ${pMythicYear}`);
  console.log(`ok  luck: markup, /luck route, profile link, tier shares sum to 1, a year's best ${quantile(Math.pow(.5, 1 / 365)).toLocaleString()} EP, P(mythic in a year) ${(100 * pMythicYear).toFixed(1)}%`);
}

// --- Other -----------------------------------------------------------------
// The legacy tools: src/index.js, the engine and the pages this front end replaced,
// mounted by src/worker.js for /beta/<tool>, /chains and their APIs. Pin the markup,
// the route, the mount, and — by loading the module — that its catalogue lists only
// tools the site has NOT ported, each at a path the mount actually forwards.
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const id of ["view-other", "other-cards", "other-findings", "other-total", "other-status", "other-tools", "other-insights"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id} for the Other tab`);
  }
  assert.ok(html.includes('data-view="other"'), "index.html has no Other nav tab");
  assert.ok(html.includes('<script src="/other.js" defer></script>'), "index.html does not load other.js");
  const epSrc = fs.readFileSync(path.join(ROOT, "ep.js"), "utf8");
  assert.ok(epSrc.includes("showOther("), "ep.js no longer routes /other to the Other tab");
  assert.ok(epSrc.includes("WORKER_PATHS.test(a.pathname)"), "ep.js would swallow clicks on the legacy tools' links");
  const worker = fs.readFileSync(path.join(REPO, "src/worker.js"), "utf8");
  assert.ok(worker.includes('from "./index.js"'), "src/worker.js no longer mounts src/index.js");
  assert.ok(worker.includes('"/api/other"') && worker.includes("legacyCatalogue()"), "src/worker.js no longer serves /api/other");
  assert.ok(worker.includes("FRONT_END: url.origin"), "src/worker.js must hand the legacy module its own origin, or its redirects leave the site");
  // A navigation to a path with no static file gets the shell before the Worker runs,
  // unless the path is listed here - so without this every legacy page IS the shell.
  const wranglerCfg = fs.readFileSync(path.join(REPO, "wrangler.toml"), "utf8");
  const rwf = /run_worker_first\s*=\s*\[([^\]]*)\]/.exec(wranglerCfg);
  assert.ok(rwf, "wrangler.toml has no run_worker_first list, so the legacy pages would render as the app shell");
  for (const p of ["/beta", "/beta/*", "/chains", "/engine.js", "/api", "/api/*"]) {
    assert.ok(rwf[1].includes(JSON.stringify(p)), `wrangler.toml run_worker_first is missing ${p}`);
  }
  // The mount's path test, read out of worker.js so this checks the real one.
  const legacyRe = new RegExp(/const LEGACY = \/(.*)\/;/.exec(worker)[1]);
  // Load the module the way the Worker does (it is ESM; this file is not).
  const src = `import { legacyCatalogue } from ${JSON.stringify(pathToFileURL(path.join(REPO, "src/index.js")).href)};
    console.log(JSON.stringify(legacyCatalogue()));`;
  const cat = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", src], { cwd: REPO, encoding: "utf8" }));
  assert.ok(cat.tools.length >= 10, `only ${cat.tools.length} legacy tools in the catalogue`);
  const slugs = cat.tools.map(t => t.slug);
  // What this site ported has a tab of its own; the catalogue must not offer it twice.
  for (const s of ["nearmiss", "luck", "grid", "badges", "analysis", "calc"]) {
    assert.ok(!slugs.includes(s), `the catalogue still lists "${s}", which this site has ported`);
  }
  for (const t of cat.tools) {
    assert.ok(t.title && t.blurb && t.note && t.thumb, `legacy tool ${t.slug} is missing a title, blurb, note or mark`);
    assert.ok(legacyRe.test(t.href), `legacy tool ${t.slug} is at ${t.href}, which worker.js does not forward`);
  }
  for (const f of cat.findings) {
    assert.ok(f.head && f.body && f.href && f.title, `a finding is missing its text or its link: ${JSON.stringify(f)}`);
  }
  assert.ok(legacyRe.test("/engine.js") && legacyRe.test("/api/profile") && legacyRe.test("/api/palettes") && legacyRe.test("/api"),
    "worker.js no longer forwards the engine and APIs the legacy tools read");
  for (const p of ["/", "/grid", "/grid/pronic", "/badges", "/u", "/u/alice", "/luck", "/neighbours", "/other", "/api/rolls", "/api/other"]) {
    assert.ok(!legacyRe.test(p), `worker.js would hand ${p} to the legacy Worker`);
  }
  console.log(`ok  other: ${slugs.length} legacy tools (${slugs.join(", ")}), ${cat.findings.length} findings, none ported here`);
}

// --- reveal schedule -------------------------------------------------------
// Pull the real constants out of app.js and check them against what was
// sampled off rngdle, plus the shape of its tweens.
{
  const grab = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
  const sandbox = { SLOTS: 6, Math };
  vm.createContext(sandbox);
  vm.runInContext(grab("const EASE = {", "const tweens = new Set();"), sandbox);
  vm.runInContext(grab("const SPIN_MS =", "// rngdle's rarity reveal"), sandbox);
  const NAMES = "EASE, revealTimes, badgeGap, EP_TWEEN_MS, AFTER_COLLAPSE_MS, BEFORE_SUMMARY_MS, "
    + "BEFORE_RARITY_MS, BEFORE_STATS_MS, TOTAL_EP_SHOW_MS, TOTAL_EP_ANIMATE_MS, REVEAL_END_MS, LIFETIME_TWEEN_MS";
  const { EASE, revealTimes, badgeGap, EP_TWEEN_MS, AFTER_COLLAPSE_MS, BEFORE_SUMMARY_MS, BEFORE_RARITY_MS,
          BEFORE_STATS_MS, TOTAL_EP_SHOW_MS, TOTAL_EP_ANIMATE_MS, REVEAL_END_MS, LIFETIME_TWEEN_MS } =
    vm.runInContext(`({ ${NAMES} })`, sandbox);

  // Digit landings sampled live: 2001/3002/4049/5205/6563/8203 (within ~7ms).
  // Array.from: the array comes from the vm realm, so its prototype differs.
  assert.deepStrictEqual(Array.from(revealTimes(6)), [2000, 3000, 4040, 5200, 6560, 8200],
    `digit landings are ${revealTimes(6).join("/")}`);
  console.log("ok  digit landings " + revealTimes(6).join("/"));

  // 1000000 is the one 7-digit roll and needs a seventh slot and landing.
  assert.strictEqual(revealTimes(7).length, 7, "7-digit rolls need 7 landings");
  console.log("ok  7-digit landings " + revealTimes(7).join("/"));

  // Badge gaps widen across the list: 500ms at the start, tending to 1500ms.
  // Only i = 0..n-2 are ever applied (the last badge has nothing after it).
  const n = 5;
  const gaps = [...Array(n - 1)].map((_, i) => Math.round(badgeGap(i, n)));
  assert.strictEqual(gaps[0], 500, "first badge gap should be 500ms");
  assert.strictEqual(Math.round(badgeGap(n - 1, n)), 1500, "gap formula should top out at 1500ms");
  assert.ok(gaps.slice(1).every((g, i) => g > gaps[i]), "badge gaps must widen");
  console.log("ok  badge gaps " + gaps.join("/") + " (formula tops out at 1500)");

  // Rarity and percentile land well after the last badge, never with the number.
  const afterLastBadge = BEFORE_SUMMARY_MS + BEFORE_RARITY_MS;
  assert.ok(afterLastBadge >= 2000, "rarity must trail the last badge by >= 2s");
  // rngdle gates the Share row and the EP pill's colours on rarity:reveal, and
  // the whole rank row (pill + percentile) on stats:show — so the rank label
  // trails the colour, not the other way round.
  assert.ok(BEFORE_STATS_MS > 0, "the rank row must trail rarity:reveal");
  assert.ok(AFTER_COLLAPSE_MS >= 1000, "badges must wait ~1s after the digits land");
  console.log(`ok  rarity at last badge +${afterLastBadge}ms, rank row +${BEFORE_STATS_MS}ms after`);

  // The tail: lifetime EP shows, counts up, then reveal:end lifts the vignette.
  assert.strictEqual(TOTAL_EP_SHOW_MS, 1000, "totalEP:show is stats:show + 1s");
  assert.strictEqual(TOTAL_EP_ANIMATE_MS, 1500, "totalEP:animate is 1.5s after that");
  assert.strictEqual(REVEAL_END_MS, 2000, "reveal:end is 2s after totalEP:animate");
  assert.strictEqual(LIFETIME_TWEEN_MS, 1500, "the lifetime count-up runs 1.5s");
  console.log(`ok  reveal tail +${TOTAL_EP_SHOW_MS}/${TOTAL_EP_ANIMATE_MS}/${REVEAL_END_MS}ms `
    + `(lifetime EP shows, counts up over ${LIFETIME_TWEEN_MS}ms, vignette lifts)`);

  // Per-badge EP tween: power2.out over EP_TWEEN_MS, shrinking increments.
  assert.strictEqual(EP_TWEEN_MS, 500, "rngdle tweens the EP pill over 0.5s");
  const frames = Math.round(EP_TWEEN_MS / (1000 / 60));
  const vals = [...Array(frames + 1)].map((_, i) => EASE.power2Out(i / frames));
  assert.ok(Math.abs(vals[vals.length - 1] - 1) < 1e-9, "tween must land exactly on target");
  const steps = vals.slice(1).map((v, i) => v - vals[i]);
  assert.ok(steps.slice(1).every((d, i) => d < steps[i]), "EP increments must shrink (ease-out)");
  console.log(`ok  EP tween: ${frames} frames of power2.out`);

  // back.out must overshoot past 1 — that is the pop on the rarity pill, and it
  // is why rngdle's row was captured mid-flight at opacity 1.0756 / scale 1.0768.
  for (const s of [1.7, 3]) {
    const peak = Math.max(...[...Array(101)].map((_, i) => EASE.backOut(s)(i / 100)));
    assert.ok(peak > 1.02, `back.out(${s}) should overshoot, peaked at ${peak.toFixed(3)}`);
    assert.ok(Math.abs(EASE.backOut(s)(1) - 1) < 1e-9, `back.out(${s}) must settle on 1`);
    console.log(`ok  back.out(${s}) overshoot ${peak.toFixed(3)}`);
  }
}

console.log("\nall checks passed");
