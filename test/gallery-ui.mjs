// Browser test for the Box Lab gallery (/beta/boxes) against a real D1.
//
//   node test/gallery-ui.mjs
//
// test/gallery.mjs covers the routes; test/browser.mjs covers the lab's pages. Neither
// covered the gallery's client, because it only does anything when there is a database
// behind it and `node serve.mjs` has no bindings - browser.mjs can therefore only check
// that the section degrades quietly. So the paging, the hearts and the sort tabs, which
// are the parts a person actually touches, had no test at all. This is that test.
//
// It runs `wrangler dev` against a throwaway database: `--persist-to` a temp directory,
// seeded from schema.sql and thrown away at the end, so a developer's own local gallery
// is never read, written or emptied by running this.
//
// Skips with exit 0 when playwright-core or wrangler cannot be started, so it never
// blocks anyone - same bargain test/browser.mjs makes.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The project's own wrangler, run through node. This is the same local install
// `npx wrangler` resolves to - never a global one - reached directly because Node
// refuses to spawn npx.cmd without a shell on Windows (EINVAL), and going through a
// shell would put every path here at the mercy of quoting.
const WRANGLER = join('node_modules', 'wrangler', 'bin', 'wrangler.js');
const PAGE_SIZE = 24;   // LIMITS.page in src/gallery.js
const SEEDED = 30;      // enough for a second page, not enough for a third

// --- finding playwright ----------------------------------------------------
// Usually not a project dependency; the machine has it globally via an npx cache whose
// folder name is a hash. Look in the obvious places and give up quietly.
function findDir(root, name, depth) {
  if (depth < 0 || !existsSync(root)) return null;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === name) return join(root, e.name);
    const hit = findDir(join(root, e.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

async function loadPlaywright() {
  try { return (await import('playwright-core')).default ?? await import('playwright-core'); } catch {}
  try { return (await import('playwright')).default ?? await import('playwright'); } catch {}
  const dir = findDir(join(homedir(), 'AppData/Local/npm-cache/_npx'), 'playwright-core', 3);
  if (!dir) return null;
  try {
    const mod = await import(pathToFileURL(join(dir, 'index.js')).href);
    return mod.default ?? mod;
  } catch { return null; }
}

// The installed playwright-core often wants a newer browser build than the machine has;
// fall back to the newest chromium actually present.
function findChromium() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter(n => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe',
      'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, b, exe);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const freePort = () => new Promise(done => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); });
});

// --- the throwaway database ------------------------------------------------

// likes and created both cycle over a small range, so rows tie on likes, on created and
// therefore on the hot rank too. Ties are exactly what a keyset cursor gets wrong if its
// sort key is not unique, so the gallery should be paged over a list full of them.
function seedSql() {
  const base = 1771000000000;
  const rows = [];
  for (let i = 0; i < SEEDED; i++) {
    const design = {
      word: 'W' + i, bd: '#f59e0b', from: '#fde68a', via: '#fffbeb', to: '#fca5a5',
      ink: '#7c2d12', glow: '#f97316', glowSize: 26, glowAlpha: 55, shimmer: false,
      sparkles: 0, spark: '#ffffff', sparkShadow: false, spill: false, sparkShape: 'star',
      sparkMotion: 'twinkle', seed: i, holo: false, ring: false, pulse: false,
      radius: 12, borderW: 3, angle: 135, breathe: 30, inkStyle: 'solid', lo: 1000 + i,
    };
    rows.push('INSERT INTO palettes (id,name,author,note,tiers,tier_count,created,author_key,likes,hidden)'
      + ` VALUES ('seed${String(i).padStart(3, '0')}','Palette ${i}','tester','','`
      + `${JSON.stringify(design)}',1,${base + (i % 5) * 1000},'seedkey',${i % 4},0);`);
  }
  return rows.join('\n');
}

const d1 = (state, file) => execFileSync(process.execPath,
  [WRANGLER, 'd1', 'execute', 'rngdle', '--local', '--persist-to', state, '--file', file],
  { stdio: 'pipe', windowsHide: true });

// --- checks ----------------------------------------------------------------

let bad = 0;
const check = (name, ok, extra) => {
  if (ok) { console.log('  ok   ' + name); return; }
  bad++;
  console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`);
};

const state = mkdtempSync(join(tmpdir(), 'rngdle-gallery-ui-'));
let server = null;
let browser = null;
let skipped = null;

// wrangler dev runs workerd as a child process, so the whole tree has to go. Killing
// only the parent leaves workerd alive holding the database files open, and the temp
// directory then cannot be removed - one leaked state directory per run.
function stopServer(proc) {
  if (!proc) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); return; }
    catch { /* fall through to the ordinary kill */ }
  }
  try { proc.kill(); } catch { /* already gone */ }
}

// Every exit runs through here, so a skip cleans up as thoroughly as a pass does.
// process.exit() inside the run below would not - it does not run finally blocks.
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  stopServer(server);
  for (let i = 0; i < 20; i++) {
    try { rmSync(state, { recursive: true, force: true }); return; }
    catch { await new Promise(r => setTimeout(r, 300)); }
  }
  console.log(`  note: could not remove ${state}`);
}

async function run() {
  const pw = await loadPlaywright();
  if (!pw) return (skipped = 'no playwright-core');
  if (!existsSync(WRANGLER)) return (skipped = 'no local wrangler');

  const seedFile = join(state, 'seed.sql');
  writeFileSync(seedFile, seedSql());
  try {
    d1(state, 'schema.sql');
    d1(state, seedFile);
  } catch {
    return (skipped = 'could not prepare a local D1');
  }

  const port = await freePort();
  server = spawn(process.execPath,
    [WRANGLER, 'dev', '--local', '--port', String(port), '--persist-to', state],
    { stdio: 'ignore', windowsHide: true });

  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(base + '/api?n=1')).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!up) return (skipped = 'wrangler dev did not start');

  console.log('gallery-ui');

  const exe = findChromium();
  browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  const ids = () => page.$$eval('#gal .gc [data-like]', els => els.map(e => e.dataset.like));
  const hearts = sel => page.textContent(sel).then(t => t.replace(/\D/g, ''));
  const waitText = (sel, was) => page.waitForFunction(
    ([s, w]) => document.querySelector(s).textContent.replace(/\D/g, '') !== w,
    [sel, was], { timeout: 10000 });

  await page.goto(base + '/beta/boxes', { waitUntil: 'networkidle' });
  await page.waitForSelector('#gal .gc', { timeout: 15000 });

  // --- paging, which is the whole point of a cursor ------------------------
  const first = await ids();
  check('the first page fills', first.length === PAGE_SIZE, String(first.length));
  check('there is more to ask for', await page.isVisible('#gal-more'));

  await page.click('#gal-more');
  await page.waitForFunction(n => document.querySelectorAll('#gal .gc').length > n,
    PAGE_SIZE, { timeout: 15000 });
  const both = await ids();
  check('the next page appends the rest', both.length === SEEDED, String(both.length));
  check('no palette is handed out twice', new Set(both).size === both.length,
    `${both.length} cards, ${new Set(both).size} distinct`);
  check('the first page is untouched underneath', both.slice(0, PAGE_SIZE).join() === first.join());
  check('the button goes once the list is exhausted', !(await page.isVisible('#gal-more')));

  // --- hearts --------------------------------------------------------------
  // The number on the button has to be the number the server settled on, not a guess
  // the page made locally.
  const btn = `#gal [data-like="${both[0]}"]`;
  const before = await hearts(btn);
  await page.click(btn);
  await waitText(btn, before);
  const on = await hearts(btn);
  check('hearting counts up', Number(on) === Number(before) + 1, `${before} -> ${on}`);
  check('and the button reads as hearted', await page.$eval(btn, e => e.classList.contains('on')));
  await page.click(btn);
  await waitText(btn, on);
  check('un-hearting counts back down', (await hearts(btn)) === before);

  // --- sort tabs -----------------------------------------------------------
  // Switching sort starts a new list. The page in flight for the old one must not be
  // appended to it, which is what the generation counter in boxesClient is for.
  await page.click('#gsort [data-v="new"]');
  await page.waitForFunction(n => document.querySelectorAll('#gal .gc').length === n,
    PAGE_SIZE, { timeout: 15000 });
  const fresh = await ids();
  check('switching sort starts one page over', fresh.length === PAGE_SIZE, String(fresh.length));
  check('and orders them differently', fresh.join() !== first.join());
  check('with nothing carried over twice', new Set(fresh).size === fresh.length);

  // --- own hearts on a fresh load ------------------------------------------
  // /api/palettes-liked now runs alongside the list rather than ahead of it, so the
  // repaint when it lands second is what makes this pass.
  await page.click(`#gal [data-like="${fresh[0]}"]`);
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#gal .gc', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#gal [data-like].on').length > 0,
    null, { timeout: 10000 }).catch(() => {});
  check("a caller's own heart comes back filled",
    (await page.$$eval('#gal [data-like].on', e => e.length)) >= 1);

  check('nothing logged an error', errors.length === 0, errors.slice(0, 3).join(' | '));
}

try {
  await run();
} finally {
  await cleanup();
}

if (skipped) console.log(`gallery-ui: skipped (${skipped})`);
else console.log(bad ? `\n${bad} failed` : '\nall clean');
process.exit(bad ? 1 : 0);
