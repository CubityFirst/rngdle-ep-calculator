// Assembles dist/ from site/ — exactly the files the site needs at runtime, nothing
// else. An explicit allowlist rather than an ignore list: this gets published, and
// site/ also holds rngdle.html (a reference page) and a README that should not ship.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "site");   // the static front end
const DIST = path.join(__dirname, "..", "dist");

const FILES = [
  "index.html",
  "app.js",
  "ep.js",
  "badges.js",
  "profile.js",
  "analysis.js",
  "grid.js",
  "neighbours.js",
  "luck.js",
  "other.js",
  "engine-shim.js",
  "style.css",              // already contains vendor/rngdle.css
  "ep-table.bin.gz",
  "badge-table.bin.gz",
  "vendor/rngdle-engine.js",
];

// Empty dist/ rather than remove it: a running `wrangler dev` holds the
// directory open on Windows, and rmSync on the directory itself fails with
// EPERM while its contents can still be replaced.
fs.mkdirSync(DIST, { recursive: true });
for (const entry of fs.readdirSync(DIST)) fs.rmSync(path.join(DIST, entry), { recursive: true, force: true });
let total = 0;
for (const rel of FILES) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) throw new Error(`missing ${rel} — run tools/build-ep-table.cjs?`);
  const dst = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  const size = fs.statSync(dst).size;
  total += size;
  console.log(`  ${rel.padEnd(26)} ${(size / 1024).toFixed(0).padStart(6)} KB`);
}
console.log(`dist/ ready — ${FILES.length} files, ${(total / 1e6).toFixed(2)} MB uncompressed`);
