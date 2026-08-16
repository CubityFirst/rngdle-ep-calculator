// Verify the /beta supersession algorithm against research/badge-tally.json.
//
//   node test/supersession.mjs
//
// /beta/economy and /beta/collector both need to know not just which badges a number
// EARNS but which one actually SCORES, and they work that out in a Web Worker from the
// sweep's bitmask - a second implementation of the family rule, separate from compute().
// A mistake there would be invisible: the numbers would still look plausible.
//
// So: replicate the worker's algorithm here (family index per badge, strict > for the
// max so the first of an EP tie wins, exactly as in beta.js) and compare the earn/score
// counts it produces over the whole range against the committed tally, which
// gen-snapshot.mjs produced from compute(). Two implementations, one answer.
//
// Takes a couple of minutes - it runs the real scorer over all 1,000,001 numbers - so it
// is deliberately not part of `npm test`. Run it after touching FAMILIES, a badge's EP,
// or the supersession code in either place.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BADGES, FAMILIES, compute } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { tally } = JSON.parse(readFileSync(join(root, 'research/badge-tally.json'), 'utf8'));

const idToIdx = new Map(BADGES.map((b, i) => [b[0], i]));
const FAM = new Int16Array(BADGES.length).fill(-1);
FAMILIES.forEach((fam, f) => {
  for (const id of fam) {
    const i = idToIdx.get(id);
    if (i !== undefined) FAM[i] = f;
  }
});
const EP = Float64Array.from(BADGES, b => b[3]);

const earn = new Float64Array(BADGES.length);
const score = new Float64Array(BADGES.length);
const top = new Int32Array(FAMILIES.length);

for (let n = 0; n <= 1000000; n++) {
  // compute() supplies the earned set (superseded members included, EP zeroed); the
  // loop below is the worker's rule applied to it, so a disagreement can only be in
  // the supersession logic, not in the badge tests. Reset per number exactly as the
  // worker does - a typed array starts at 0, not -1, so this is not optional.
  top.fill(-1);
  for (const b of compute(n).badges) {
    const i = idToIdx.get(b.id);
    earn[i]++;
    const f = FAM[i];
    if (f < 0) { score[i]++; continue; }
    if (top[f] < 0 || EP[i] > EP[top[f]]) top[f] = i;
  }
  for (let f = 0; f < top.length; f++) if (top[f] >= 0) score[top[f]]++;
  if (n % 100000 === 0) process.stderr.write(`  ${(n / 10000).toFixed(0)}%\r`);
}

let bad = 0;
for (const [id, i] of idToIdx) {
  const t = tally[id];
  if (!t) { console.log(`MISSING from the tally: ${id}`); bad++; continue; }
  if (t.earn !== earn[i] || t.score !== score[i]) {
    console.log(`MISMATCH ${id}: tally earn=${t.earn} score=${t.score}, ` +
      `worker rule earn=${earn[i]} score=${score[i]}`);
    bad++;
  }
}

console.log(bad
  ? `\n${bad} badges disagree - the /beta supersession rule and research/badge-tally.json ` +
    'have diverged. If the badge table changed, run `npm run gen` first.'
  : `\nall ${idToIdx.size} badges agree with research/badge-tally.json on earn and score.`);
process.exit(bad ? 1 : 0);
