// Load a saved rngdle.com scoring chunk and hand back what it exports.
//
// rngdle ships its whole scoring model client-side, in one Turbopack chunk (the one
// tools/refresh.cjs vendors as site/vendor/rngdle-engine.js and tools/snapshot.cjs
// files as research/rngdle-<date>). This module runs that chunk in a bare vm context
// with a minimal Turbopack runtime - the same trick as site/engine-shim.js - and finds
// the modules by what they EXPORT rather than by id, because a rebuild renumbers
// module ids (the June bundle used 47558/82713/67711/10584; later ones differ).
//
//   const { loadBundle, latestBundle } = require("./prod-bundle.cjs");
//   const b = loadBundle(latestBundle());
//   b.DEFS            BADGE_DEFINITIONS: [{ id, family, check, getContributors, tests, ... }]
//   b.SCORED          SCORED_BADGES:     [{ id, label, description, emoji, score, probability }]
//   b.PERCENTILES     SCORE_PERCENTILES: { totalEP: percentile }
//   b.ENGINE          analyzeNumber / composeRollResult / rollRandomNumber / ...
//   b.RARITY          getCardRarityTier / getBadgeRarityTier / RARITY_PALETTE / ...
//   b.score(n)        prod's own analyzeNumber(n), as { totalScore, earned, scoringIds }
//   b.cardTiers()     CARD_TIERS as src/index.js spells them, derived from PERCENTILES
//
// Everything here is read-only over the saved file: nothing is fetched.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RESEARCH = path.join(__dirname, "..", "research");
const BUNDLE_RE = /^rngdle-(\d{4}-\d{2}-\d{2})$/;

// The card tiers are cut at round percentiles of total EP (rngdle's
// CARD_PERCENTILE_THRESHOLDS); each cutoff is the smallest EP at or above that percentile.
const CARD_PERCENTILE_THRESHOLDS = [
  [1, "trash"], [50, "common"], [75, "uncommon"], [90, "rare"], [95, "epic"], [99, "anomaly"],
];

/** Every saved bundle under research/, oldest first, as { file, date }. */
function listBundles() {
  if (!fs.existsSync(RESEARCH)) return [];
  return fs.readdirSync(RESEARCH)
    .map(f => ({ file: path.join(RESEARCH, f), date: (BUNDLE_RE.exec(f) || [])[1] }))
    .filter(b => b.date && fs.statSync(b.file).isFile())
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Path of the newest saved bundle, or null. */
function latestBundle() {
  const all = listBundles();
  return all.length ? all[all.length - 1].file : null;
}

/** The saved bundle just before `file` (by date), or null. */
function previousBundle(file) {
  const all = listBundles();
  const i = all.findIndex(b => path.resolve(b.file) === path.resolve(file));
  return i > 0 ? all[i - 1].file : null;
}

// --- a Turbopack runtime just big enough for the scoring chunk -----------------------
// Mirrors site/engine-shim.js: collect (id, factory) pairs from the chunk's
// TURBOPACK.push([...]) call, instantiate on demand, and resolve `e.s(spec, id)`
// re-exports whose id is not a factory of its own (aliases).
function makeRuntime(chunkText, file) {
  const ctx = vm.createContext({ console });
  vm.runInContext(chunkText, ctx, { filename: file });
  const pushed = vm.runInContext("globalThis.TURBOPACK || []", ctx);

  const factories = new Map();
  for (const args of pushed) {
    for (let i = 0; i < args.length; i++) {
      if (typeof args[i] === "number" && typeof args[i + 1] === "function") factories.set(args[i], args[++i]);
    }
  }
  if (!factories.size) throw new Error(`${file}: no Turbopack module factories found - not a rngdle chunk?`);

  const namespaces = new Map(), started = new Set();
  const ns = id => namespaces.get(id) || (namespaces.set(id, {}), namespaces.get(id));
  // A module may export into a namespace id it does not own (`e.s(spec, 5641)` inside
  // module 10163's factory): those ids are aliases of the factory that defines them.
  const aliases = new Map();
  for (const [mid, f] of factories) for (const m of String(f).matchAll(/\],(\d+)\)/g)) aliases.set(Number(m[1]), mid);
  const ownerOf = id => (factories.has(id) ? id : aliases.get(id));
  const load = id => {
    const owner = ownerOf(id);
    if (owner === undefined) throw new Error(`module ${id} is not in this chunk`);
    if (!started.has(owner)) {
      started.add(owner);
      factories.get(owner)({
        i: load,
        r: load,
        s: (spec, nsId) => {
          const t = ns(nsId === undefined ? owner : nsId);
          for (let i = 0; i < spec.length;) {
            const name = spec[i];
            const isConst = spec[i + 1] === 0;
            const get = isConst ? (v => () => v)(spec[i + 2]) : spec[i + 1];
            Object.defineProperty(t, name, { get, enumerable: true, configurable: true });
            i += isConst ? 3 : 2;
          }
        },
      });
    }
    return ns(id);
  };

  // Find the module (by id) that exports `name`. The export name appears verbatim in
  // the factory source (`e.s(["analyzeNumber",()=>x,...],10163)`), so only candidates
  // are instantiated; a module that needs browser globals is skipped, not fatal.
  // The export may land in the owner's namespace or in one of its aliases, and a
  // factory that throws after its e.s() call has still published its exports.
  const find = name => {
    const needle = JSON.stringify(name);
    for (const [id, f] of factories) {
      if (!String(f).includes(needle)) continue;
      try { load(id); } catch { /* partial module - check what it exported anyway */ }
      const ids = [id, ...[...aliases].filter(([, mid]) => mid === id).map(([aid]) => aid)];
      for (const nid of ids) {
        const ex = namespaces.get(nid);
        try { if (ex && ex[name] !== undefined) return { id: nid, exports: ex }; } catch { /* getter needs a browser */ }
      }
    }
    return null;
  };
  return { factories, load, find };
}

/**
 * Load one saved bundle. `file` defaults to the newest research/rngdle-<date>.
 * Throws with a plain message if the chunk no longer carries BADGE_DEFINITIONS.
 */
function loadBundle(file = latestBundle()) {
  if (!file) throw new Error("no saved bundle - run: node tools/snapshot.cjs");
  const text = fs.readFileSync(file, "utf8");
  const rt = makeRuntime(text, file);

  const need = name => {
    const m = rt.find(name);
    if (!m) throw new Error(`${path.basename(file)}: no module exports ${name} - did rngdle restructure?`);
    return m;
  };
  const defs = need("BADGE_DEFINITIONS");
  const scored = need("SCORED_BADGES");
  const pct = rt.find("SCORE_PERCENTILES");
  const engine = rt.find("analyzeNumber");
  const rarity = rt.find("getCardRarityTier");
  const util = rt.find("findEquation");

  const DEFS = defs.exports.BADGE_DEFINITIONS;
  const SCORED = scored.exports.SCORED_BADGES;
  const PERCENTILES = pct ? pct.exports.SCORE_PERCENTILES : null;
  const ENGINE = engine ? engine.exports : null;
  const RARITY = rarity ? rarity.exports : null;

  const scoreMap = new Map(SCORED.map(b => [b.id, b.score]));
  const familyMap = new Map(DEFS.filter(d => d.family).map(d => [d.id, d.family]));

  // Replay of prod's analyzeNumber from the definitions alone: check every badge, then
  // within a family only the highest score survives, first defined winning a tie
  // (prod's `t > r.score`). Used when the engine module cannot be instantiated.
  const replay = n => {
    const str = String(n);
    const earned = [];
    for (const d of DEFS) {
      let ok = false;
      try { ok = d.check(n, str); } catch { ok = false; }
      if (ok) earned.push(d.id);
    }
    const winner = new Map(), standalone = [];
    for (const id of earned) {
      const sc = scoreMap.get(id) ?? 0, fam = familyMap.get(id);
      if (!fam) { standalone.push(id); continue; }
      const cur = winner.get(fam);
      if (!cur || sc > cur.score) winner.set(fam, { id, score: sc });
    }
    const scoringIds = new Set([...standalone, ...[...winner.values()].map(x => x.id)]);
    let totalScore = 0;
    for (const id of scoringIds) totalScore += scoreMap.get(id) ?? 0;
    return { number: n, totalScore, earned, scoringIds };
  };

  // Prod's own scorer when it loads: analyzeNumber(n) is { number, badges (every earned
  // id), scoringBadges (the ids left after family supersession), totalScore }.
  const idOf = b => (typeof b === "string" ? b : b.id);
  const score = ENGINE ? (n => {
    const r = ENGINE.analyzeNumber(n);
    const earned = r.badges.map(idOf);
    const scoringIds = new Set((r.scoringBadges || r.badges.filter(b => b.score > 0)).map(idOf));
    return { number: n, totalScore: r.totalScore, earned, scoringIds };
  }) : replay;

  const cardTiers = () => {
    if (!PERCENTILES) return null;
    const entries = Object.entries(PERCENTILES).map(([ep, p]) => [Number(ep), p]).sort((a, b) => a[0] - b[0]);
    return CARD_PERCENTILE_THRESHOLDS.map(([t, name]) => {
      const hit = entries.find(([, p]) => p >= t);
      return [hit ? hit[0] : null, name];
    });
  };

  return {
    file, date: (BUNDLE_RE.exec(path.basename(file)) || [])[1] || null, text,
    ids: { defs: defs.id, scored: scored.id, percentiles: pct && pct.id, engine: engine && engine.id,
      rarity: rarity && rarity.id, util: util && util.id },
    DEFS, SCORED, PERCENTILES, ENGINE, RARITY, score, replay, cardTiers, load: rt.load,
  };
}

/** A definition as plain data: function sources instead of functions, for JSON/diffs. */
function plainDef(d) {
  const out = {};
  for (const [k, v] of Object.entries(d)) out[k] = typeof v === "function" ? String(v) : v;
  return out;
}

module.exports = { loadBundle, listBundles, latestBundle, previousBundle, plainDef, CARD_PERCENTILE_THRESHOLDS, RESEARCH };
