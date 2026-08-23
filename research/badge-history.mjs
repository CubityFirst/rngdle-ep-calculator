// Recover (and re-check) the badge timeline from git.
//
//   node research/badge-history.mjs         # print the timeline + verify BADGE_HISTORY
//   node research/badge-history.mjs --json  # the same timeline as JSON
//
// BADGE_HISTORY in src/index.js is the source of truth at runtime - it is the only
// place a retired badge survives, and /badges reads it for every "Added" date. This
// script is where those entries came from: it walks every revision of src/index.js,
// pulls the badge ids out of the BADGES array, and diffs consecutive revisions, so
// the first day each id appeared (and the day any id disappeared) is recovered from
// the repository rather than remembered.
//
// It then checks the committed BADGE_HISTORY against that timeline and exits 1 on
// any drift, which makes it a useful thing to run after adding a batch. Note the
// timeline can only see what git can: a badge added and removed inside one commit
// leaves no trace, and dates are commit dates, so a batch committed the day after it
// was written reads as the later day.

import { execFileSync } from 'node:child_process';
import { BADGE_HISTORY, BADGE_PORT_DATE } from '../src/index.js';

const JSON_OUT = process.argv.includes('--json');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

// Every revision of the badge file, oldest first, as [sha, YYYY-MM-DD].
const revisions = git('log', '--reverse', '--format=%H %ad', '--date=short', '--', 'src/index.js')
  .trim().split('\n').map(line => line.trim().split(' '));

/** The set of badge ids defined in one revision of src/index.js, or null if unreadable. */
function idsAt(sha) {
  let src;
  try { src = git('show', `${sha}:src/index.js`); } catch { return null; }
  const start = src.indexOf('const BADGES = [');
  if (start === -1) return null;
  const rest = src.slice(start);
  const end = rest.indexOf('\n];'); // the array always closes on its own line
  const body = rest.slice(0, end === -1 ? rest.length : end);
  const ids = new Set();
  for (const m of body.matchAll(/^\s*\[\s*'([A-Z0-9_]+)'\s*,/gm)) ids.add(m[1]);
  // A revision mid-refactor can parse to a handful of ids; those are noise, not a
  // batch that dropped 200 badges.
  return ids.size >= 50 ? ids : null;
}

const timeline = []; // [{date, sha, added, removed, total}], oldest first
let prev = null;
for (const [sha, date] of revisions) {
  const ids = idsAt(sha);
  if (!ids) continue;
  if (prev) {
    const added = [...ids].filter(id => !prev.has(id));
    const removed = [...prev].filter(id => !ids.has(id));
    if (added.length || removed.length) timeline.push({ date, sha: sha.slice(0, 7), added, removed, total: ids.size });
  } else {
    timeline.push({ date, sha: sha.slice(0, 7), added: [...ids], removed: [], total: ids.size, port: true });
  }
  prev = ids;
}

if (JSON_OUT) {
  console.log(JSON.stringify(timeline, null, 2));
  process.exit(0);
}

for (const e of timeline) {
  console.log(`${e.date}  ${e.sha}  ${String(e.total).padStart(3)} badges  +${e.added.length} -${e.removed.length}${e.port ? '  (initial port)' : ''}`);
  if (!e.port && e.added.length) console.log('    + ' + e.added.join(' '));
  if (e.removed.length) console.log('    - ' + e.removed.join(' '));
}

// --- check src/index.js against what git says -------------------------------
const problems = [];
const [port, ...batches] = timeline;
if (port.date !== BADGE_PORT_DATE) {
  problems.push(`BADGE_PORT_DATE is ${BADGE_PORT_DATE}, git says the port landed ${port.date}`);
}
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
for (const batch of batches) {
  const entry = BADGE_HISTORY.find(b => b.date === batch.date);
  if (!entry) { problems.push(`${batch.date}: git has a badge change (${batch.sha}) with no BADGE_HISTORY entry`); continue; }
  if (!same(entry.added, batch.added)) {
    problems.push(`${batch.date}: added mismatch\n    git:   ${batch.added.sort().join(' ')}\n    entry: ${[...entry.added].sort().join(' ')}`);
  }
  if (!same(entry.retired.map(r => r[0]), batch.removed)) {
    problems.push(`${batch.date}: retired mismatch\n    git:   ${batch.removed.sort().join(' ')}\n    entry: ${entry.retired.map(r => r[0]).sort().join(' ')}`);
  }
}
for (const entry of BADGE_HISTORY) {
  if (!batches.some(b => b.date === entry.date)) {
    problems.push(`${entry.date}: BADGE_HISTORY entry with no matching change in git (uncommitted batch?)`);
  }
}

console.log('');
if (problems.length) {
  console.log(`BADGE_HISTORY does not match git (${problems.length}):`);
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log(`BADGE_HISTORY matches git: ${batches.length} batch${batches.length === 1 ? '' : 'es'} since the ${port.total}-badge port on ${port.date}.`);
