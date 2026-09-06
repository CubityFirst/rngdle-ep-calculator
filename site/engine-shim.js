/* ---------------------------------------------------------------------------
   Turbopack runtime shim — just enough to instantiate rngdle's own badge
   engine (vendor/rngdle-engine.js is rngdle's chunk, byte-for-byte). Running the
   real engine instead of a reimplementation is what makes this sandbox exact.
   Shared by the page (app.js) and the tools/ scripts.
   --------------------------------------------------------------------------- */
const factories = new Map(), namespaces = new Map(), started = new Set();
for (const args of (globalThis.TURBOPACK || [])) {
  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] === "number" && typeof args[i + 1] === "function") factories.set(args[i], args[++i]);
  }
}
const ns = id => namespaces.get(id) || (namespaces.set(id, {}), namespaces.get(id));
let aliases = null;
function ownerOf(id) {
  if (factories.has(id)) return id;
  if (!aliases) {
    aliases = new Map();
    for (const [mid, f] of factories) for (const m of String(f).matchAll(/\],(\d+)\)/g)) aliases.set(Number(m[1]), mid);
  }
  return aliases.get(id);
}
function load(id) {
  const owner = ownerOf(id);
  if (!started.has(owner)) {
    started.add(owner);
    factories.get(owner)({
      i: load,
      s: (spec, nsId) => {
        const t = ns(nsId === undefined ? owner : nsId);
        for (let i = 0; i < spec.length; ) {
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
}
const ENGINE = load(10163);   // analyzeNumber, composeRollResult, getPercentileForScore, rollRandomNumber
const RARITY = load(5641);    // RARITY_PALETTE, RARITY_ARTIFACT_STYLES, getCardRarityTier, getBadgeRarityTier
const DIGITS = load(47558);   // findEquation, for the EQUATION badge's own diagram
const BADGES = load(67711);   // BADGE_DEFINITIONS — every badge, for the Badges map


