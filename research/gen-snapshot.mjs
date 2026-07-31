// Full-range snapshot generator. Runs every number 0..1,000,000 through the badge
// engine ONCE and writes two committed artifacts:
//
//   src/examples.gen.js         - first 3 numbers that EARN each badge (used by /badges)
//   src/probabilities.gen.js    - exact share of all 1,000,001 inputs earning each badge
//                                 (shown as "X% of numbers" in tooltips and on /badges)
//   research/badge-tally.json   - per badge: how many numbers EARN it, and how many
//                                 numbers it SCORES on (>0 EP after family supersession).
//                                 A limited, diffable snapshot of the whole range - a
//                                 rule/EP change shows up as a tally diff in review,
//                                 without storing per-number data.
//
// Run `npm run gen` (also runs automatically via predeploy) whenever a badge test,
// EP value, or FAMILIES entry changes, and commit the updated files.
//
// The sweep is split across worker threads: every number is independent, so the range is
// cut into chunks handed out on demand (more chunks than workers, so a slow chunk can't
// leave a core idle) and the per-badge tallies are summed at the end. This file runs as
// BOTH the main thread and the workers - see isMainThread below - so the scoring logic
// exists exactly once. Set GEN_WORKERS=1 to sweep serially (e.g. when profiling).
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { engineModuleSource, BADGES, FAMILIES } from '../src/index.js';

const N_MAX = 1000000;
const PER_BADGE = 3;
const CHUNK = 25000;                          // ~40 chunks over the range
const WORKERS = Math.max(1, Math.min(
  Number(process.env.GEN_WORKERS) || availableParallelism() - 1,
  Math.ceil((N_MAX + 1) / CHUNK)));

// ---------------------------------------------------------------------------
// Sweep (runs on every thread)
// ---------------------------------------------------------------------------

const { computeLean, BADGE_META } = await import('data:text/javascript,' + encodeURIComponent(engineModuleSource()));

// Family supersession on earned indices (same max-EP-wins, first-on-tie as compute()).
const idToIdx = new Map(BADGES.map((b, i) => [b[0], i]));
const EP = BADGES.map(b => b[3]);
const SUP_INDEX = FAMILIES.map(g => g.map(id => idToIdx.get(id)).filter(i => i !== undefined));
const famOf = new Int16Array(BADGES.length).fill(-1);
SUP_INDEX.forEach((g, fi) => g.forEach(i => { famOf[i] = fi; }));

// Tally [lo, hi] inclusive. Returns counts plus the first PER_BADGE earners *in this
// chunk*; the main thread stitches chunk examples back together in range order.
function sweep(lo, hi) {
  const earn = new Uint32Array(BADGES.length);   // numbers that earn the badge
  const score = new Uint32Array(BADGES.length);  // numbers where it scores >0 EP
  const examples = BADGES.map(() => []);
  const famTop = new Int32Array(SUP_INDEX.length);
  for (let n = lo; n <= hi; n++) {
    const { earned } = computeLean(n); // ascending badge-index order
    famTop.fill(-1);
    for (let j = 0; j < earned.length; j++) {
      const i = earned[j];
      earn[i]++;
      if (examples[i].length < PER_BADGE) examples[i].push(n);
      const f = famOf[i];
      if (f < 0) { score[i]++; continue; }        // standalone badges always score
      const top = famTop[f];
      if (top < 0 || EP[i] > EP[top]) famTop[f] = i; // strict > keeps the first of a tie
    }
    for (let f = 0; f < famTop.length; f++) if (famTop[f] >= 0) score[famTop[f]]++;
  }
  return { earn, score, examples };
}

if (!isMainThread) {
  parentPort.on('message', ({ lo, hi, chunk }) => {
    const r = sweep(lo, hi);
    parentPort.postMessage({ chunk, ...r }, [r.earn.buffer, r.score.buffer]);
  });
} else {

// ---------------------------------------------------------------------------
// Main thread: farm out chunks, merge, write
// ---------------------------------------------------------------------------

const t0 = Date.now();
const earnCount = new Uint32Array(BADGES.length);
const scoreCount = new Uint32Array(BADGES.length);
const chunkExamples = [];                     // chunkExamples[chunk][badgeIdx] = [n, ...]
const bounds = [];
for (let lo = 0; lo <= N_MAX; lo += CHUNK) bounds.push([lo, Math.min(lo + CHUNK - 1, N_MAX)]);

if (WORKERS === 1) {
  for (const [chunk, [lo, hi]] of bounds.entries()) {
    const r = sweep(lo, hi);
    merge(chunk, r);
    progress(chunk + 1);
  }
} else {
  await new Promise((resolve, reject) => {
    let next = 0, done = 0;
    const pool = Array.from({ length: WORKERS }, () => new Worker(new URL(import.meta.url)));
    const feed = w => { if (next < bounds.length) { const c = next++; w.postMessage({ lo: bounds[c][0], hi: bounds[c][1], chunk: c }); } };
    for (const w of pool) {
      w.on('message', r => {
        merge(r.chunk, r);
        progress(++done);
        if (done === bounds.length) { pool.forEach(x => x.terminate()); resolve(); }
        else feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
}

function merge(chunk, r) {
  for (let i = 0; i < earnCount.length; i++) { earnCount[i] += r.earn[i]; scoreCount[i] += r.score[i]; }
  chunkExamples[chunk] = r.examples;
}
function progress(done) {
  if (done % 8 === 0 || done === bounds.length)
    console.log(`${done}/${bounds.length} chunks (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// Chunk examples in range order -> the first PER_BADGE earners overall.
const examples = BADGES.map(() => []);
for (const per of chunkExamples)
  for (let i = 0; i < examples.length; i++)
    for (const n of per[i]) { if (examples[i].length >= PER_BADGE) break; examples[i].push(n); }

const missing = BADGE_META.filter((_, i) => examples[i].length === 0).map(b => b.id);
if (missing.length) throw new Error('No examples found for: ' + missing.join(', '));

// --- src/examples.gen.js ---------------------------------------------------
const exLines = BADGE_META.map((b, i) => `  ${b.id}: [${examples[i].join(',')}],`);
writeFileSync(new URL('../src/examples.gen.js', import.meta.url),
`// AUTO-GENERATED by research/gen-snapshot.mjs (npm run gen) - DO NOT EDIT.
// First ${PER_BADGE} numbers in 0..1,000,000 that EARN each badge (pre-supersession
// membership, matching the /grid highlight views), keyed by badge id.
/* eslint-disable */
export const EXAMPLES = {
${exLines.join('\n')}
};
`);

// --- research/badge-tally.json ----------------------------------------------
const tally = {};
BADGE_META.forEach((b, i) => { tally[b.id] = { earn: earnCount[i], score: scoreCount[i] }; });
writeFileSync(new URL('badge-tally.json', import.meta.url), JSON.stringify({
  range: `0..${N_MAX}`,
  numbers: N_MAX + 1,
  badges: BADGES.length,
  note: 'earn = numbers earning the badge; score = numbers where it scores >0 EP after family supersession. Regenerate with `npm run gen`.',
  tally,
}, null, 1) + '\n');

// --- src/probabilities.gen.js -------------------------------------------------
const probLines = BADGE_META.map((b, i) =>
  `  ${b.id}: ${Number((earnCount[i] / (N_MAX + 1) * 100).toFixed(4))},`);
writeFileSync(new URL('../src/probabilities.gen.js', import.meta.url),
`// AUTO-GENERATED by research/gen-snapshot.mjs (npm run gen) - DO NOT EDIT.
// Exact share of all ${(N_MAX + 1).toLocaleString('en-US')} inputs (0..${N_MAX.toLocaleString('en-US')}) that EARN each
// badge, as a percent, keyed by badge id.
/* eslint-disable */
export const PROBABILITIES = {
${probLines.join('\n')}
};
`);

console.log(`Wrote src/examples.gen.js + src/probabilities.gen.js + research/badge-tally.json (${BADGES.length} badges, ${WORKERS} worker${WORKERS === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(1)}s).`);
console.log('If these files changed, commit them together with the rule change.');

}
