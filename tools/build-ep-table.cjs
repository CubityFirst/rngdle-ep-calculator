// Generates the two precomputed indexes the site ships, from one sweep of the
// vendored engine over every number in 0..1000000:
//
//   ep-table.bin.gz     the EP total of every number, as a flat little-endian
//                       Uint32Array (4MB, ~2.1MB gzipped). The EP -> Number
//                       page fetches and inflates it instead of brute-forcing
//                       in the browser, which took 15s on 12 cores and minutes
//                       on a phone.
//   badge-table.bin.gz  which badges every number earns, as one bitset per
//                       badge: bit n of row i is set when number n earns badge i
//                       (i = its index in BADGE_DEFINITIONS; superseded badges
//                       count as earned, as they do on rngdle's card). Rows are
//                       ceil(1000001 / 8) = 125001 bytes, so the file inflates to
//                       233 x 125001 = 29MB. It is written badge-major rather than
//                       number-major because that is what compresses: a badge's
//                       row is a sparse or periodic bit pattern, and the whole
//                       thing gzips to a few MB where the per-number layout would
//                       not. The Analysis tab filters straight off these rows.
//
// Re-run this whenever tools/refresh.cjs pulls a new engine — tools/check.cjs
// fails if either table and the engine disagree.
//   node tools/build-ep-table.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..", "site");   // the static front end
const EP_OUT = path.join(ROOT, "ep-table.bin.gz");
const BADGE_OUT = path.join(ROOT, "badge-table.bin.gz");
const N = 1000001;
const ROWB = Math.ceil(N / 8);   // bytes per badge row in the badge table

const ctx = vm.createContext({ console });
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(ROOT, "vendor/rngdle-engine.js"), "utf8"), ctx);
const { ENGINE, BADGES } = vm.runInContext(
  fs.readFileSync(path.join(ROOT, "engine-shim.js"), "utf8") + ";({ ENGINE, BADGES })", ctx);

const badgeIndex = new Map(BADGES.BADGE_DEFINITIONS.map((b, i) => [b.id, i]));
const NB = badgeIndex.size;

const started = Date.now();
const ep = new Uint32Array(N);
const bits = new Uint8Array(NB * ROWB);
let max = 0;
for (let n = 0; n < N; n++) {
  const r = ENGINE.analyzeNumber(n);
  const v = r.totalScore;
  if (v > 0xffffffff) throw new Error(`EP ${v} for ${n} overflows Uint32`);
  ep[n] = v;
  if (v > max) max = v;
  for (const id of r.badges) {
    const i = badgeIndex.get(id);
    if (i === undefined) throw new Error(`${n} earns ${id}, which BADGE_DEFINITIONS does not list`);
    bits[i * ROWB + (n >> 3)] |= 1 << (n & 7);
  }
  if (n % 100000 === 0) process.stdout.write(`\r  ${(n / N * 100).toFixed(0)}%`);
}

// Little-endian on purpose: every browser this ships to is LE, and the client
// reads it straight into a Uint32Array with no byte swapping.
if (Buffer.from(Uint32Array.of(1).buffer)[0] !== 1) {
  throw new Error("this machine is big-endian; the table would load byte-swapped");
}
// Gzipped, not raw: Cloudflare (and most CDNs) only auto-compress by
// content-type and skip application/octet-stream, so a 4MB .bin ships as 4MB.
// The page inflates it with DecompressionStream, which also keeps this working
// on any host. gzip not brotli because DecompressionStream has no brotli.
fs.writeFileSync(EP_OUT, zlib.gzipSync(Buffer.from(ep.buffer), { level: 9 }));
fs.writeFileSync(BADGE_OUT, zlib.gzipSync(Buffer.from(bits.buffer), { level: 9 }));

const distinct = new Set(ep).size;
const mb = f => (fs.statSync(f).size / 1e6).toFixed(2);
process.stdout.write("\r");
console.log(`ep-table.bin.gz     ${mb(EP_OUT)} MB (${(N * 4 / 1e6).toFixed(2)} MB inflated)`);
console.log(`  ${N.toLocaleString()} numbers, ${distinct.toLocaleString()} distinct totals, max ${max.toLocaleString()} EP`);
console.log(`badge-table.bin.gz  ${mb(BADGE_OUT)} MB (${(bits.length / 1e6).toFixed(2)} MB inflated)`);
console.log(`  ${NB} badges x ${ROWB.toLocaleString()} bytes`);
console.log(`  built in ${((Date.now() - started) / 1000).toFixed(0)}s`);
