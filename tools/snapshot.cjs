// Take a dated copy of rngdle.com's scoring chunk and say what changed.
//
//   node tools/snapshot.cjs                 fetch the live chunk, save it, extract, diff
//   node tools/snapshot.cjs --from <file>   ingest a chunk already on disk instead
//   node tools/snapshot.cjs --date 2026-09-05   name the snapshot (default: today)
//   node tools/snapshot.cjs --all           also keep every chunk + stylesheet of the page
//   node tools/snapshot.cjs --force         save even if nothing changed since the last one
//
// What it writes (all under research/, which is gitignored - these are raw upstream blobs):
//
//   research/rngdle-<date>                  the chunk, byte for byte. This is the file the
//                                           parity oracle replays and what tools/refresh.cjs
//                                           vendors, so a bundle only ever exists once.
//   research/rngdle-dump-<date>/            what the chunk exports, as data:
//     SCORED_BADGES.json                      id, label, description, emoji, score, probability
//     BADGE_DEFINITIONS.json                  the same ids with family, check source, test vectors
//     SCORE_PERCENTILES.json                  total EP -> percentile, prod's own distribution
//     RARITY.json                             badge / card tier thresholds and the palette
//     manifest.json                           url, size, sha256, module ids, counts, card tiers
//     DIFF.md                                 the report below, for the commit that ports it
//   research/rngdle-all-<date>/             (--all) every asset the home page loads
//
// The report has two halves: what moved upstream since the previous snapshot (badges
// added / retired / re-priced / re-ruled, family changes, percentile shifts) and what
// the repo now disagrees with (src/index.js BADGES, DESCRIPTIONS, FAMILIES, CARD_TIERS
// against the new bundle). The second half is the to-do list for the port; when it is
// empty the engine already matches and only the vendored copy + indexes need refreshing.
// The .claude/skills/ingest-bundle skill walks that port step by step.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const { loadBundle, latestBundle, previousBundle, plainDef, RESEARCH } = require("./prod-bundle.cjs");

const SITE = "https://www.rngdle.com";
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const date = opt("--date") || today();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date wants YYYY-MM-DD, got ${date}`);

const get = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
};
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const fmt = n => n.toLocaleString("en-GB");
const q = s => JSON.stringify(s);

// --- 1. get the chunk ------------------------------------------------------------------
async function fetchChunk() {
  const html = await get(SITE);
  const urls = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[\w.-]+\.(?:js|css)/g)].map(m => SITE + m[0]))];
  if (!urls.length) throw new Error("no _next/static/chunks on the home page - did rngdle move off Next.js?");
  const assets = [];
  let engine = null;
  for (const url of urls) {
    const body = await get(url);
    assets.push({ url, body });
    if (!engine && url.endsWith(".js") && body.includes("BADGE_DEFINITIONS")) engine = { url, body };
  }
  if (!engine) throw new Error("no chunk defining BADGE_DEFINITIONS - did rngdle restructure?");
  return { engine, assets, html };
}

(async () => {
  let text, url = null, assets = null, html = null;
  const from = opt("--from");
  if (from) {
    text = fs.readFileSync(from, "utf8");
    url = `file:${from}`;
  } else {
    const got = await fetchChunk();
    text = got.engine.body; url = got.engine.url; assets = got.assets; html = got.html;
  }

  // --- 2. save it, unless it is the bundle we already have ------------------------------
  const out = path.join(RESEARCH, `rngdle-${date}`);
  const last = latestBundle();
  const lastIsThis = last && path.resolve(last) === path.resolve(out);
  if (last && !lastIsThis && fs.readFileSync(last, "utf8") === text && !flag("--force")) {
    console.log(`unchanged: the live chunk is byte-identical to ${path.basename(last)} (${fmt(text.length)} b)`);
    console.log("nothing saved; pass --force to snapshot it anyway.");
    return;
  }
  fs.mkdirSync(RESEARCH, { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`${path.relative(process.cwd(), out)}  ${fmt(text.length)} b  sha256 ${sha(text).slice(0, 12)}  <- ${url}`);

  if (flag("--all") && assets) {
    const dir = path.join(RESEARCH, `rngdle-all-${date}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
    for (const a of assets) fs.writeFileSync(path.join(dir, a.url.split("/").pop()), a.body);
    console.log(`${path.relative(process.cwd(), dir)}/  ${assets.length} assets + index.html`);
  }

  // --- 3. extract ---------------------------------------------------------------------
  const cur = loadBundle(out);
  const dump = path.join(RESEARCH, `rngdle-dump-${date}`);
  fs.mkdirSync(dump, { recursive: true });
  const write = (name, data) => fs.writeFileSync(path.join(dump, name), JSON.stringify(data, null, 1) + "\n");
  write("SCORED_BADGES.json", cur.SCORED);
  write("BADGE_DEFINITIONS.json", cur.DEFS.map(plainDef));
  if (cur.PERCENTILES) write("SCORE_PERCENTILES.json", cur.PERCENTILES);
  if (cur.RARITY) {
    const r = {};
    for (const [k, v] of Object.entries(cur.RARITY)) if (typeof v !== "function") r[k] = v;
    write("RARITY.json", r);
  }
  const rollSrc = cur.ENGINE && cur.ENGINE.rollRandomNumber ? String(cur.ENGINE.rollRandomNumber) : null;
  const manifest = {
    date, url, bytes: text.length, sha256: sha(text), modules: cur.ids,
    badges: { defined: cur.DEFS.length, scored: cur.SCORED.length },
    families: new Set(cur.DEFS.map(d => d.family).filter(Boolean)).size,
    percentiles: cur.PERCENTILES ? Object.keys(cur.PERCENTILES).length : 0,
    cardTiers: cur.cardTiers(), rollRandomNumber: rollSrc,
  };
  write("manifest.json", manifest);
  console.log(`${path.relative(process.cwd(), dump)}/  ${manifest.badges.defined} badges, ${manifest.families} families, ${fmt(manifest.percentiles)} percentile breakpoints`);

  // --- 4. diff against the previous snapshot -----------------------------------------
  const lines = [];
  const say = s => { lines.push(s); console.log(s); };
  say("");
  say(`# rngdle bundle ${date}`);
  say("");
  say(`- source: ${url}`);
  say(`- modules: defs ${cur.ids.defs}, scored ${cur.ids.scored}, engine ${cur.ids.engine}, rarity ${cur.ids.rarity}, util ${cur.ids.util}`);
  say(`- ${cur.DEFS.length} badges defined, ${cur.SCORED.length} scored, ${manifest.families} families, ${fmt(manifest.percentiles)} percentile breakpoints`);
  if (rollSrc) say(`- rollRandomNumber: ${rollSrc.replace(/\s+/g, " ")}`);

  const prevFile = previousBundle(out);
  say("");
  if (!prevFile) {
    say("## Upstream: no earlier snapshot to diff against");
  } else {
    const prev = loadBundle(prevFile);
    say(`## Upstream: since ${path.basename(prevFile)}`);
    say("");
    let moved = 0;
    const pS = new Map(prev.SCORED.map(b => [b.id, b])), cS = new Map(cur.SCORED.map(b => [b.id, b]));
    const pD = new Map(prev.DEFS.map(d => [d.id, d])), cD = new Map(cur.DEFS.map(d => [d.id, d]));
    for (const [id, b] of cS) if (!pS.has(id)) {
      moved++;
      const d = cD.get(id);
      say(`- ADDED ${id} ${b.emoji} ${q(b.label)} EP ${fmt(b.score)} (${b.probability})${d && d.family ? ` family ${d.family}` : ""}`);
      say(`  - ${q(b.description)}`);
      if (d) say(`  - check: ${String(d.check).replace(/\s+/g, " ")}`);
      if (d && d.tests) say(`  - tests: match ${JSON.stringify(d.tests.match)} reject ${JSON.stringify(d.tests.reject)}`);
    }
    for (const [id, b] of pS) if (!cS.has(id)) {
      moved++;
      const d = pD.get(id);
      say(`- RETIRED ${id} ${b.emoji} ${q(b.label)} EP ${fmt(b.score)}${d && d.family ? ` family ${d.family}` : ""}`);
      say(`  - BADGE_HISTORY retired entry: [${q(id)}, ${q(b.label)}, ${q(b.emoji)}, ${b.score}, ${q(b.description)}]`);
    }
    for (const [id, b] of cS) {
      const a = pS.get(id); if (!a) continue;
      for (const k of ["label", "description", "emoji", "score", "probability"]) {
        if (a[k] !== b[k]) { moved++; say(`- CHANGED ${id}.${k}: ${q(a[k])} -> ${q(b[k])}`); }
      }
      const x = pD.get(id), y = cD.get(id);
      if (!x || !y) continue;
      if ((x.family || null) !== (y.family || null)) { moved++; say(`- FAMILY ${id}: ${x.family || "(standalone)"} -> ${y.family || "(standalone)"}`); }
      if (String(x.check) !== String(y.check)) {
        moved++;
        say(`- CHECK ${id}:`);
        say(`  - old: ${String(x.check).replace(/\s+/g, " ")}`);
        say(`  - new: ${String(y.check).replace(/\s+/g, " ")}`);
      }
      if (String(x.getContributors) !== String(y.getContributors)) { moved++; say(`- CONTRIBUTORS ${id} changed (highlighting only, EP unaffected)`); }
    }
    const order = a => a.map(d => d.id).filter(id => pD.has(id) && cD.has(id)).join();
    if (order(prev.DEFS) !== order(cur.DEFS)) { moved++; say("- ORDER of BADGE_DEFINITIONS changed (tie-breaks inside a family follow definition order)"); }
    const pT = JSON.stringify(prev.cardTiers()), cT = JSON.stringify(cur.cardTiers());
    if (pT !== cT) { moved++; say(`- CARD_TIERS ${pT} -> ${cT}`); }
    const pP = prev.PERCENTILES ? Object.keys(prev.PERCENTILES).length : 0;
    if (pP !== manifest.percentiles) say(`- percentile breakpoints ${fmt(pP)} -> ${fmt(manifest.percentiles)}`);
    if (!moved) say("- nothing: same badges, prices, rules, families and card tiers (minifier noise only)");
  }

  // --- 5. diff against the repo ------------------------------------------------------
  say("");
  say("## Repo: src/index.js against this bundle");
  say("");
  globalThis.__name = globalThis.__name || (f => f);       // esbuild keepNames shim, as the research scripts do
  const idx = await import(pathToFileURL(path.join(__dirname, "..", "src", "index.js")).href);
  let drift = 0;
  const ours = new Map(idx.BADGES.map(b => [b[0], { id: b[0], label: b[1], emoji: b[2], score: b[3] }]));
  const theirs = new Map(cur.SCORED.map(b => [b.id, b]));
  for (const [id, b] of theirs) if (!ours.has(id)) {
    drift++;
    const d = cur.DEFS.find(x => x.id === id);
    say(`- MISSING ${id}: add [${q(id)}, ${q(b.label)}, ${q(b.emoji)}, ${b.score}, test] to BADGES, ${q(b.description)} to DESCRIPTIONS${d && d.family ? `, and to the ${d.family} family` : ""}`);
  }
  for (const [id] of ours) if (!theirs.has(id)) { drift++; say(`- EXTRA ${id}: not in prod any more - retire it (copy it into BADGE_HISTORY first)`); }
  for (const [id, b] of theirs) {
    const o = ours.get(id); if (!o) continue;
    for (const k of ["label", "emoji", "score"]) if (o[k] !== b[k]) { drift++; say(`- ${id}.${k}: ours ${q(o[k])}, prod ${q(b[k])}`); }
    // Descriptions are compared modulo typography: the repo spells prod's em dashes and
    // ellipses in ASCII on purpose, and that is not drift.
    const plain = t => String(t).replace(/—|–/g, "-").replace(/…/g, "...").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
    if (idx.DESCRIPTIONS && idx.DESCRIPTIONS[id] !== undefined && plain(idx.DESCRIPTIONS[id]) !== plain(b.description)) {
      drift++; say(`- ${id}.description: ours ${q(idx.DESCRIPTIONS[id])}, prod ${q(b.description)}`);
    }
  }
  // Families: prod names them, we number them; compare as sets of member sets.
  const prodFam = new Map();
  for (const d of cur.DEFS) if (d.family) (prodFam.get(d.family) || prodFam.set(d.family, []).get(d.family)).push(d.id);
  const key = ids => [...ids].sort().join();
  const ourFam = new Map(idx.FAMILIES.map((m, i) => [key(m), idx.FAMILY_NAMES ? idx.FAMILY_NAMES[i] : `#${i}`]));
  for (const [name, ids] of prodFam) if (!ourFam.has(key(ids))) {
    drift++;
    const near = idx.FAMILIES.find(m => m.some(id => ids.includes(id)));
    say(`- FAMILY ${name} = [${ids.join(", ")}]${near ? ` (ours nearest: [${near.join(", ")}])` : " (no counterpart in FAMILIES)"}`);
  }
  const prodKeys = new Set([...prodFam.values()].map(key));
  for (const [k, name] of ourFam) if (!prodKeys.has(k)) { drift++; say(`- FAMILY ${q(name)} [${k.split(",").join(", ")}] has no prod counterpart`); }
  // site/engine-shim.js instantiates the vendored chunk by module id, and a rebuild
  // renumbers them: catch that here, before `npm run refresh` makes check.cjs fail.
  const shimPath = path.join(__dirname, "..", "site", "engine-shim.js");
  if (fs.existsSync(shimPath)) {
    const shimIds = [...fs.readFileSync(shimPath, "utf8").matchAll(/\bload\((\d+)\)/g)].map(m => Number(m[1]));
    const bundleIds = new Set(Object.values(cur.ids).filter(Boolean));
    const stale = shimIds.filter(id => !bundleIds.has(id));
    if (stale.length) {
      drift++;
      say(`- SHIM: site/engine-shim.js loads module ${stale.join(", ")}; this bundle numbers them ` +
        `engine ${cur.ids.engine}, rarity ${cur.ids.rarity}, util ${cur.ids.util}, defs ${cur.ids.defs} - update the load() ids before npm run refresh`);
    }
  }
  const want = cur.cardTiers(), have = idx.CARD_TIERS;
  if (want && JSON.stringify(want) !== JSON.stringify(have)) { drift++; say(`- CARD_TIERS: ours ${JSON.stringify(have)}, from this bundle ${JSON.stringify(want)}`); }
  // Rules: a fast strided sample; tools/parity.cjs does the whole range.
  let bad = 0, shownN = [];
  for (let n = 0; n <= 1000000; n += 97) {
    const a = idx.compute(n), p = cur.score(n);
    const ourSet = a.badges.filter(b => b.ep > 0).map(b => b.id).sort().join();
    if (a.totalEP !== p.totalScore || ourSet !== [...p.scoringIds].sort().join()) { bad++; if (shownN.length < 8) shownN.push(n); }
  }
  if (bad) { drift++; say(`- RULES: ${bad} of ${fmt(Math.floor(1000000 / 97) + 1)} sampled numbers score differently (e.g. ${shownN.join(", ")}) - run node tools/parity.cjs for the full list`); }
  if (!drift) say("- none: BADGES, DESCRIPTIONS, FAMILIES, CARD_TIERS, the shim's module ids and a 10,310-number rule sample all agree");

  say("");
  say("## Next");
  say("");
  say(drift
    ? "- fix the drift above (the ingest-bundle skill in .claude/skills says where each item lives), then:"
    : "- the engine already matches; refresh the vendored copy and its indexes:");
  say("- `npm run refresh && npm run ep-table && npm run check`");
  say("- `node tools/parity.cjs` (full range, ~1 min), `npm run gen`, `npm test`");
  fs.writeFileSync(path.join(dump, "DIFF.md"), lines.join("\n").trimStart() + "\n");
  console.log(`\nreport: ${path.relative(process.cwd(), path.join(dump, "DIFF.md"))}`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
