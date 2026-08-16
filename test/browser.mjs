// Browser smoke test for the /beta lab.
//
//   node test/browser.mjs            # serves src/ (fast, what `npm run serve` does)
//   node test/browser.mjs --bundle   # serves the esbuild output, i.e. what deploy runs
//   BASE=http://127.0.0.1:8787 node test/browser.mjs   # test a server you already have
//
// Two passes over every tool page:
//   1. load     - the sweep finishes, nothing logs an error, and the page does not
//                 scroll horizontally at desktop OR phone width
//   2. interact - the controls actually do something and still log nothing
//
// `--bundle` is the one that matters before a deploy. The tools ship their client code
// to the browser via fn.toString(), and esbuild's keepNames rewrites those functions to
// call __name(), a helper that only exists inside the bundle - so a page can work
// perfectly from src/ and be broken in production. Serving the real bundle is the only
// way to see it. (src/beta.js ships a no-op __name shim to make it work; this is what
// proves the shim is still there.)
//
// Skips with exit 0 when playwright-core is not installed, so it never blocks anyone.

import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const BUNDLE = process.argv.includes('--bundle');
const OUT = join(tmpdir(), 'rngdle-browser-test-dist');

// --- finding playwright ----------------------------------------------------
// It is usually not a project dependency here, but the machine has it globally via an
// npx cache whose folder name is a hash that changes. Look in the obvious places and
// give up quietly rather than failing a run that was never going to work.
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
  const cache = join(homedir(), 'AppData/Local/npm-cache/_npx');
  const dir = findDir(cache, 'playwright-core', 3);
  if (!dir) return null;
  try {
    const mod = await import(new URL('index.js', `file:///${join(dir, '/').replace(/\\/g, '/')}`).href);
    return mod.default ?? mod;
  } catch { return null; }
}

// The installed playwright-core often wants a newer browser build than the machine
// has; fall back to the newest chromium actually present.
function findChromium() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter(n => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, b, exe);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

// --- the pages and what to poke on them ------------------------------------
const PAGES = ['/beta', '/beta/atlas', '/beta/projections', '/beta/spectrum', '/beta/contact',
  '/beta/pairs', '/beta/oracle', '/beta/nearmiss', '/beta/luck', '/beta/collector',
  '/beta/anatomy', '/beta/economy', '/beta/species'];

const INTERACTIONS = {
  '/beta/pairs': [
    ['metric', p => p.selectOption('#metric', 'cond').then(() => p.textContent('#leghi'))],
    ['cluster order', p => p.selectOption('#order', 'cluster').then(() => p.waitForTimeout(900))
      .then(() => p.$eval('#list .item', e => e.textContent.trim()))],
    ['search', p => p.fill('#q', 'pair').then(() => p.textContent('#lcount'))],
    ['pick badge', p => p.click('#list .item').then(() => p.$eval('#side .sh-name b', e => e.textContent))],
  ],
  '/beta/spectrum': [
    ['sort', p => p.selectOption('#sort', 'spread').then(() => 'ok')],
    ['brightness', p => p.selectOption('#norm', 'abs').then(() => 'ok')],
    ['click stripe', async p => {
      const [x, y] = await p.$eval('#spec', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + 40]; });
      await p.mouse.click(x, y);
      return p.$eval('#detail .dn b', e => e.textContent);
    }],
  ],
  // mouse.move, not hover(): playwright's actionability check does not settle on SVG
  // circles inside a scaled viewBox, though elementFromPoint hits them fine.
  '/beta/economy': [
    ['hover point', async p => {
      const [x, y] = await p.$eval('#chart .pt', e => {
        const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
      });
      await p.mouse.move(x, y);
      await p.waitForTimeout(200);
      return p.$eval('#tip b', e => e.textContent);
    }],
  ],
  '/beta/oracle': [
    ['lock best', p => p.click('#greedy').then(() => p.waitForTimeout(600)).then(() => p.textContent('#pattern'))],
    ['metric', p => p.selectOption('#metric', 'top').then(() => p.$eval('#board .cell.live em', e => e.textContent))],
    ['click cell', p => p.click('#board .cell.live').then(() => p.waitForTimeout(600)).then(() => p.textContent('#pattern'))],
    ['guaranteed', p => p.$eval('#sure h2', e => e.textContent.trim())],
    ['reset', p => p.click('#reset').then(() => p.waitForTimeout(600)).then(() => p.textContent('#pattern'))],
  ],
  // The player lookup is deliberately not exercised: it calls rngdle's public API, and
  // a test suite has no business hammering someone else's server. The pasted-rolls path
  // runs the same scoring code.
  '/beta/luck': [
    ['rolls slider', async p => {
      await p.$eval('#rolls', e => { e.value = '500'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      return p.textContent('#rollsv');
    }],
    ['analyse rolls', async p => {
      await p.fill('#paste', '696969, 123456, 42, 999999, 100000');
      await p.click('#paste-go');
      await p.waitForTimeout(250);
      return p.$eval('#verdict .vhead b', e => e.textContent);
    }],
  ],
  '/beta/collector': [
    ['rolls slider', async p => {
      await p.$eval('#nrolls', e => { e.value = '100'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      return p.textContent('#nrollsv');
    }],
  ],
  '/beta/species': [
    ['lookup', async p => {
      await p.fill('#find', '696969');
      await p.click('#find-form button');
      await p.waitForTimeout(1800);
      return p.$eval('#found .fh', e => e.textContent.replace(/\s+/g, ' ').trim());
    }],
    ['badge set', p => p.$eval('#found .pills', e => e.children.length + ' badge pills')],
  ],
  '/beta/anatomy': [
    ['metric', p => p.selectOption('#metric', 'top').then(() => p.$eval('#panels .panel h2', e => e.textContent.trim()))],
  ],
  '/beta/contact': [
    ['search', p => p.fill('#q', 'power').then(() => p.textContent('#count'))],
    ['order', p => p.selectOption('#sort', 'rate').then(() => p.$eval('#sheet .tl', e => e.textContent.trim()))],
    ['cluster maps', async p => {
      await p.selectOption('#sort', 'similar');
      await p.waitForFunction(() => !document.getElementById('sort').disabled, null, { timeout: 20000 });
      return p.$eval('#sheet .tl', e => e.textContent.trim());
    }],
  ],
  '/beta/nearmiss': [
    ['random', p => p.click('#rand').then(() => p.textContent('#title .tn'))],
    ['click neighbour', p => p.click('#board .cell:not(.self)').then(() => p.waitForTimeout(400))
      .then(() => p.textContent('#title .tn'))],
    ['type a number', p => p.fill('#n', '80085').then(() => p.click('#go button'))
      .then(() => p.textContent('#title .tn'))],
  ],
  '/beta/atlas': [
    ['colour', p => p.selectOption('#mode', '2').then(() => 'ok')],
    ['height source', p => p.selectOption('#hsrc', 'count').then(() => 'ok')],
    ['detail', p => p.selectOption('#res', '250').then(() => 'ok')],
    ['badge overlay', async p => {
      await p.fill('#badge', 'Palindrome');
      await p.$eval('#badge', e => e.dispatchEvent(new Event('change', { bubbles: true })));
      await p.waitForTimeout(2500);
      return p.textContent('#badgenote');
    }],
    ['fly to', async p => {
      await p.fill('#gn', '696969');
      await p.click('#goto button');
      await p.waitForTimeout(250);
      return p.$eval('#read .rd-n', e => e.textContent);
    }],
    ['peak', p => p.click('#peaks .peak').then(() => p.waitForTimeout(250))
      .then(() => p.$eval('#read .rd-n', e => e.textContent))],
  ],
  '/beta/projections': [
    ['digits', p => p.click('[data-l="1"]').then(() => p.waitForTimeout(1200)).then(() => 'ok')],
    ['hilbert', p => p.click('[data-l="2"]').then(() => p.waitForTimeout(1200)).then(() => 'ok')],
    ['by score', p => p.click('[data-l="4"]').then(() => p.waitForTimeout(1200)).then(() => 'ok')],
    ['colour', p => p.selectOption('#mode', '1').then(() => 'ok')],
    ['badge overlay', async p => {
      await p.fill('#badge', 'Divisible by Three');
      await p.$eval('#badge', e => e.dispatchEvent(new Event('change', { bubbles: true })));
      await p.waitForTimeout(2500);
      return p.textContent('#badgenote');
    }],
  ],
};

// --- server ----------------------------------------------------------------
async function startServer() {
  if (process.env.BASE) return { base: process.env.BASE, stop() {} };
  let mod;
  if (BUNDLE) {
    console.log('building the deploy bundle…');
    rmSync(OUT, { recursive: true, force: true });
    execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', OUT],
      { stdio: 'pipe', shell: process.platform === 'win32' });
    mod = await import(new URL(`file:///${join(OUT, 'index.js').replace(/\\/g, '/')}`).href);
  } else {
    mod = await import('../src/index.js');
  }
  const worker = mod.default;
  const server = http.createServer(async (req, res) => {
    const r = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method }));
    res.statusCode = r.status;
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { base: `http://127.0.0.1:${server.address().port}`, stop: () => server.close() };
}

// --- run -------------------------------------------------------------------
const pw = await loadPlaywright();
if (!pw) {
  console.log('playwright-core not found - skipping the browser test.');
  process.exit(0);
}

const { base, stop } = await startServer();
console.log(`serving ${BUNDLE ? 'the deploy bundle' : 'src/'} on ${base}\n`);

const browser = await pw.chromium.launch({
  executablePath: findChromium(),
  // Software WebGL, so /beta/atlas and /beta/projections work without a real GPU.
  args: ['--enable-unsafe-swiftshader'],
});
let bad = 0;

// Pass 1: every page, at two widths, cold sweep the first time in each context.
for (const size of [{ name: 'desktop', width: 1440, height: 950 }, { name: 'phone', width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  for (const path of PAGES) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));
    await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const ready = await waitReady(page);
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      text: document.body.innerText.replace(/\s+/g, ' ').trim().length,
      wide: [...document.querySelectorAll('body *')]
        .filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 2)
        .slice(0, 3).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')),
    }));
    const ok = ready && !errs.length && m.scrollW <= m.clientW + 2 && m.text > 120;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${size.name.padEnd(7)} ${path.padEnd(19)} text=${m.text}` +
      (errs.length ? `\n       errors: ${errs.join(' | ')}` : '') +
      (m.wide.length ? `\n       overflowing: ${m.wide.join(', ')}` : ''));
    await page.close();
  }
  await ctx.close();
}

// Pass 2: the controls.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
for (const [path, steps] of Object.entries(INTERACTIONS)) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 160)));
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitReady(page);
  console.log(`\n${path}`);
  for (const [label, fn] of steps) {
    try {
      console.log(`  ok   ${label.padEnd(16)} -> ${String(await fn(page)).slice(0, 64)}`);
    } catch (e) {
      bad++;
      console.log(`  FAIL ${label.padEnd(16)} -> ${String(e.message).split('\n')[0].slice(0, 100)}`);
    }
  }
  if (errs.length) { bad++; console.log(`  CONSOLE: ${errs.join(' | ')}`); }
  await page.close();
}

await browser.close();
stop();
console.log(bad ? `\n${bad} problems` : '\nall clean');
process.exit(bad ? 1 : 0);

// The tools hide their overlay once the sweep and their own derivation are done, which
// is the only reliable "this page is finished" signal they have.
async function waitReady(page) {
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => {
      const ov = document.getElementById('ov');
      return !ov || ov.classList.contains('done');
    })) { await page.waitForTimeout(400); return true; }
    await page.waitForTimeout(1000);
  }
  return false;
}
