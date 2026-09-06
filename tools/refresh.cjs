// Re-fetch the two upstream files this sandbox vendors, then rebuild style.css.
// Chunk filenames are content-hashed, so discover them from the live page.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "site");   // the static front end
const SITE = "https://www.rngdle.com";

const get = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
};

(async () => {
  const html = await get(SITE);
  const urls = [...html.matchAll(/\/_next\/static\/chunks\/[\w.-]+\.(?:js|css)/g)].map(m => SITE + m[0]);

  // The engine chunk is the one defining BADGE_DEFINITIONS; the style bundle is
  // the CSS file carrying the theme tokens.
  let engine = null, css = null;
  for (const url of urls) {
    const body = await get(url);
    if (!engine && url.endsWith(".js") && body.includes("BADGE_DEFINITIONS")) engine = body;
    if (!css && url.endsWith(".css") && body.includes("--site-bg")) css = body;
  }
  if (!engine) throw new Error("no chunk defining BADGE_DEFINITIONS — did rngdle restructure?");
  if (!css) throw new Error("no stylesheet defining --site-bg");

  fs.writeFileSync(path.join(ROOT, "vendor/rngdle-engine.js"), engine);
  fs.writeFileSync(path.join(ROOT, "vendor/rngdle.css"), css);
  fs.writeFileSync(
    path.join(ROOT, "style.css"),
    fs.readFileSync(path.join(ROOT, "extra.css"), "utf8") + css
  );
  console.log(`vendor/rngdle-engine.js  ${engine.length}b`);
  console.log(`vendor/rngdle.css        ${css.length}b`);
  console.log("style.css rebuilt.\n");
  console.log("The EP index is derived from the engine, so it is now stale:");
  console.log("  node tools/build-ep-table.cjs   # ~3 min");
  console.log("  node tools/check.cjs            # verifies the two agree");
})();
