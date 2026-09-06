// Browser smoke test for the legacy tools: /chains and the /beta lab.
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
import { BADGES } from '../src/index.js';
import { EXAMPLES } from '../src/examples.gen.js';
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
const PAGES = ['/chains', '/beta/atlas', '/beta/projections', '/beta/spectrum', '/beta/contact',
  '/beta/pairs', '/beta/oracle', '/beta/collection',
  '/beta/collector', '/beta/anatomy', '/beta/economy', '/beta/species', '/beta/boxes'];

const INTERACTIONS = {
  // The Box Lab draws no data of its own - it restyles one number - so what is worth
  // holding here is that every control still changes what is on screen, that prod's
  // seven tiers stay read-only, and that the gallery stays quiet on a dev server with
  // no D1 binding.
  '/beta/boxes': [
    ['boxes render', async p => {
      const m = await p.evaluate(() => ({
        strips: document.querySelectorAll('.pv').length,
        per: document.querySelector('.pv')?.children.length,
        real: [...new Set([...document.querySelectorAll('.sfig.real figcaption, .bx.real .bx-word')]
          .map(e => e.textContent.replace(/[\d,].*$/, '')))],
      }));
      if (!m.strips) throw new Error('no preview strips');
      if (m.per !== 8) throw new Error(`want prod's 7 plus yours, strip drew ${m.per}`);
      if (m.real.length !== 1) throw new Error(`the number should land in exactly one tier, got ${m.real.join('/')}`);
      return `${m.strips} strips x ${m.per}, lands in ${m.real[0]}`;
    }],
    // Prod's seven are reference. Nothing on the page may offer to repaint them.
    ['prod tiers are read-only', async p => {
      const m = await p.evaluate(() => {
        const dials = [...document.querySelectorAll('#editor input')];
        return {
          stray: document.querySelectorAll('.edr, .edx, #ed-add, #ed-reset, #pal').length,
          dials: dials.length,
          nonDesign: dials.filter(i => i.id && i.id.slice(0, 2) !== 'd-' && i.id.slice(0, 4) !== 'pub-').length,
        };
      });
      if (m.stray) throw new Error(`${m.stray} leftover per-tier editor controls`);
      if (m.dials < 10) throw new Error(`only ${m.dials} inputs in the designer`);
      if (m.nonDesign) throw new Error(`${m.nonDesign} inputs that are neither a dial nor a publish field`);
      return `${m.dials} inputs, no per-tier editing`;
    }],
    ['theme swaps the tokens', async p => {
      const before = await p.evaluate(() => getComputedStyle(document.querySelector('.pv')).backgroundColor);
      await p.click('#theme button[data-v="light"]');
      await p.waitForTimeout(150);
      const after = await p.evaluate(() => getComputedStyle(document.querySelector('.pv')).backgroundColor);
      if (before === after) throw new Error('light/dark painted the same background');
      await p.click('#theme button[data-v="dark"]');
      return `${before} -> ${after}`;
    }],
    ['style toggles add strips', async p => {
      const n = await p.$$eval('.pv', e => e.length);
      await p.click('.pick[data-k="halo"]');
      await p.waitForTimeout(150);
      const m = await p.$$eval('.pv', e => e.length);
      if (m <= n) throw new Error(`turning a style on did not add a strip (${n} -> ${m})`);
      return `${n} -> ${m} strips`;
    }],
    ['a number re-lands', async p => {
      await p.fill('#n', '');
      await p.type('#n', '999999');
      await p.waitForTimeout(700);
      const m = await p.evaluate(() => ({
        read: document.getElementById('read').textContent.replace(/\s+/g, ' ').trim(),
        n: document.querySelector('.sbx-n')?.textContent,
      }));
      if (m.n !== '999999') throw new Error(`the scoring box shows ${m.n}`);
      if (!/EP/.test(m.read)) throw new Error('the readout never scored it');
      return m.read.slice(0, 42);
    }],
    ['a dial reaches every strip', async p => {
      await p.fill('#d-word', 'ICEBOUND');
      await p.waitForTimeout(300);
      const words = await p.$$eval('.pv .sfig figcaption', e => e.map(x => x.textContent));
      if (!words.some(w => /ICEBOUND/.test(w))) throw new Error(`renamed tier never appeared: ${words.join(', ')}`);
      const css = await p.textContent('#ed-out');
      if (!/tier-icebound/.test(css)) throw new Error('the export did not pick up the new name');
      return 'ICEBOUND reached ' + words.filter(w => /ICEBOUND/.test(w)).length + ' strip(s)';
    }],
    ['glow dial moves the readout', async p => {
      await p.$eval('#d-size', e => { e.value = '48'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.waitForTimeout(250);
      const v = await p.textContent('#d-size-v');
      if (v !== '48px') throw new Error(`glow readout says ${v}`);
      return v;
    }],
    // The extras stack: breathing, the spinning ring and the pulse all animate the
    // same element, which only works because the animation list is composed in JS
    // rather than assembled from CSS classes that would overwrite each other.
    ['effects stack on one box', async p => {
      for (const id of ['d-holo', 'd-ring', 'd-pulse']) await p.check('#' + id);
      await p.$eval('#d-sparkles', e => { e.value = '10'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.selectOption('#d-ink-style', 'gradient');
      await p.waitForTimeout(350);
      const m = await p.evaluate(() => {
        const box = document.querySelector('#d-stage .sbx');
        return {
          anim: getComputedStyle(box).animationName,
          sparks: box.querySelectorAll('.sbx-sparks i').length,
          holo: !!box.querySelector('.sbx-holo'),
          ring: box.classList.contains('fx-ring'),
          ink: box.querySelector('.sbx-n').className,
        };
      });
      const want = ['sbx-breathe', 'sbx-ring', 'sbx-pulse'];
      for (const a of want) if (!m.anim.includes(a)) throw new Error(`${a} missing from "${m.anim}"`);
      if (m.sparks !== 10) throw new Error(`${m.sparks} sparkles, wanted 10`);
      if (!m.holo) throw new Error('no holographic layer');
      if (!m.ring) throw new Error('no spinning border');
      if (!/ink-gradient/.test(m.ink)) throw new Error(`digit style did not apply: ${m.ink}`);
      return `${m.anim} + ${m.sparks} sparkles`;
    }],
    // Scatter comes from the design's seed, so the same design has to look identical
    // wherever it is drawn - otherwise a published rarity would not match its preview.
    ['sparkle scatter is deterministic', async p => {
      const stage = () => p.$$eval('#d-stage .sbx-sparks i', e => e.map(x => x.style.left).join(','));
      const before = await stage();
      await p.click('#d-reseed');
      await p.waitForTimeout(300);
      const after = await stage();
      if (before === after) throw new Error('rescatter changed nothing');
      const strip = await p.$$eval('.pv:last-of-type .sfig:last-child .sbx-sparks i',
        e => e.map(x => x.style.left).join(','));
      if (strip !== after) throw new Error('the strip and the stage scattered differently');
      return after.split(',').length + ' sparkles, stage and strip agree';
    }],
    // Each shape has to produce real geometry. A typo in a clip-path polygon does not
    // throw - the declaration is dropped and the particle silently becomes a square.
    ['every particle shape has geometry', async p => {
      await p.$eval('#d-sparkles', e => { e.value = '8'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      const shapes = await p.$$eval('#d-shape option', o => o.map(x => x.value));
      if (shapes.length < 8) throw new Error(`only ${shapes.length} shapes offered`);
      const flat = [];
      for (const sh of shapes) {
        await p.selectOption('#d-shape', sh);
        await p.waitForTimeout(60);
        const ok = await p.evaluate(() => {
          const cs = getComputedStyle(document.querySelector('#d-stage .sbx-sparks i'));
          return (cs.clipPath && cs.clipPath !== 'none') || cs.borderRadius !== '0px'
            || cs.borderTopWidth !== '0px';
        });
        if (!ok) flat.push(sh);
      }
      if (flat.length) throw new Error(`shapes with no geometry: ${flat.join(', ')}`);
      return `${shapes.length} shapes, all shaped`;
    }],
    // Each motion must bind its own keyframes; a missing @keyframes leaves the
    // previous animation running and the dial looks broken only in motion.
    ['every particle motion binds keyframes', async p => {
      const motions = await p.$$eval('#d-motion option', o => o.map(x => x.value));
      const seen = new Set();
      for (const mo of motions) {
        await p.selectOption('#d-motion', mo);
        await p.waitForTimeout(60);
        const name = await p.$eval('#d-stage .sbx-sparks i', e => getComputedStyle(e).animationName);
        if (!name || name === 'none') throw new Error(`${mo} bound no animation`);
        seen.add(name);
      }
      if (seen.size !== motions.length) {
        throw new Error(`${motions.length} motions share only ${seen.size} keyframes: ${[...seen].join(', ')}`);
      }
      return `${motions.length} motions, ${seen.size} distinct keyframes`;
    }],
    ['angle and border width reach the box', async p => {
      await p.$eval('#d-angle', e => { e.value = '300'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.$eval('#d-border', e => { e.value = '7'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.waitForTimeout(200);
      const m = await p.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('#d-stage .sbx'));
        return { bw: cs.borderTopWidth, deg: (cs.backgroundImage.match(/([\d.]+)deg/) || [])[1] };
      });
      if (m.bw !== '7px') throw new Error(`border width is ${m.bw}`);
      if (m.deg !== '300') throw new Error(`gradient angle is ${m.deg}`);
      return `${m.deg}deg, ${m.bw} border`;
    }],
    // A preset restyles the box; it must not rename what the author is designing.
    ['presets restyle without renaming', async p => {
      await p.fill('#d-word', 'KEEPME');
      await p.waitForTimeout(150);
      const before = await p.inputValue('#d-bd');
      await p.click('[data-preset="void"]');
      await p.waitForTimeout(250);
      const m = await p.evaluate(() => ({
        bd: document.getElementById('d-bd').value,
        word: document.getElementById('d-word').value,
        shape: document.getElementById('d-shape').value,
      }));
      if (m.word !== 'KEEPME') throw new Error(`the preset clobbered the name: ${m.word}`);
      if (m.bd === before) throw new Error('the preset changed nothing');
      return `${before} -> ${m.bd}, ${m.shape} particles, name kept`;
    }],
    ['randomise keeps the name', async p => {
      // Read the name rather than expecting a literal: an earlier check leaving a
      // different one behind is not this check's failure.
      const wasName = await p.inputValue('#d-word');
      const before = await p.inputValue('#d-bd');
      await p.click('#d-random');
      await p.waitForTimeout(300);
      const after = await p.inputValue('#d-bd');
      const name = await p.inputValue('#d-word');
      if (before === after) throw new Error('randomise changed nothing');
      if (name !== wasName) throw new Error(`randomise clobbered the name: ${wasName} -> ${name}`);
      return `${before} -> ${after}, name kept`;
    }],
    // Without a D1 binding the dev server has no gallery. That has to read as an
    // explained empty state rather than a broken one - and, because this harness
    // fails a page on any console error, it has to happen without a failed request.
    ['gallery degrades quietly', async p => {
      const msg = await p.textContent('#gal-msg');
      const cards = await p.$$eval('.gc', e => e.length);
      if (!msg.trim()) throw new Error('empty gallery said nothing at all');
      if (cards) throw new Error(`${cards} cards with no database`);
      return msg.slice(0, 44);
    }],
    ['publish needs a name', async p => {
      await p.fill('#pub-name', '');
      await p.click('#pub-go');
      await p.waitForTimeout(150);
      const msg = await p.textContent('#pub-msg');
      if (!/name/i.test(msg)) throw new Error(`expected a naming complaint, got "${msg}"`);
      return msg;
    }],
  ],
  '/beta/pairs': [
    ['metric', p => p.selectOption('#metric', 'cond').then(() => p.textContent('#leghi'))],
    ['cluster order', p => p.selectOption('#order', 'cluster').then(() => p.waitForTimeout(900))
      .then(() => p.$eval('#list .item', e => e.textContent.trim()))],
    ['search', p => p.fill('#q', 'pair').then(() => p.textContent('#lcount'))],
    ['pick badge', p => p.click('#list .item').then(() => p.$eval('#side .sh-name b', e => e.textContent))],
  ],
  '/beta/spectrum': [
    // A real cross-check, not just "the control did something": the panel's first
    // earner comes from decoding the sweep bitmask in the worker, and examples.gen.js
    // has the same answer from an independent full scan through compute(). If the bit
    // decoding were off by anything these would not line up - and every other tool
    // here decodes the same way.
    ['first earners', async p => {
      const checks = ['PALINDROME', 'DIVISIBLE_BY_THREE', 'PAIR', 'DEEP_VOID', 'NICE', 'PRIME']
        .map(id => [id, BADGES.find(b => b[0] === id), EXAMPLES[id]])
        .filter(([, b, ex]) => b && ex && ex.length);
      for (const [id, b, ex] of checks) {
        // goto() to the same document with only a different hash does not navigate, so
        // the page never re-boots and never applies the selection. Reload explicitly.
        await p.goto(base + '/beta/spectrum#' + encodeURIComponent(b[1]), { waitUntil: 'domcontentloaded' });
        await p.reload({ waitUntil: 'domcontentloaded' });
        await waitReady(p);
        const got = await p.$eval('#detail .drange a', e => e.textContent.replace(/\D/g, ''));
        if (Number(got) !== ex[0]) throw new Error(`${id}: page says ${got}, examples.gen.js says ${ex[0]}`);
      }
      return `${checks.length} badges match examples.gen.js`;
    }],
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
    ['dominance', p => p.$eval('#domtiers', e => e.children.length + ' tier rows')],
    ['hover point', async p => {
      const [x, y] = await p.$eval('#chart .pt', e => {
        const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
      });
      await p.mouse.move(x, y);
      await p.waitForTimeout(200);
      return p.$eval('#tip b', e => e.textContent);
    }],
    ['click point', async p => {
      const [x, y] = await p.$eval('#chart .pt', e => {
        const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
      });
      await p.mouse.click(x, y);
      await p.waitForTimeout(400);
      const u = new URL(p.url());
      if (!u.pathname.startsWith('/badges')) throw new Error('did not navigate: ' + u.pathname);
      return u.pathname + u.hash;
    }],
  ],

  '/beta/oracle': [
    ['lock best', p => p.click('#greedy').then(() => p.waitForTimeout(600)).then(() => p.textContent('#pattern'))],
    ['metric', p => p.selectOption('#metric', 'top').then(() => p.$eval('#board .cell.live em', e => e.textContent))],
    ['click cell', p => p.click('#board .cell.live').then(() => p.waitForTimeout(600)).then(() => p.textContent('#pattern'))],
    ['guaranteed', p => p.$eval('#sure h2', e => e.textContent.trim())],
    ['reset', p => p.click('#reset').then(() => p.waitForTimeout(600)).then(() => p.textContent('#pattern'))],
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
  // The username path is deliberately not exercised: it calls rngdle's public API, and
  // a test suite has no business hammering someone else's server. Pasted rolls
  // exercise the same engine scoring and the same rendering.
  '/beta/collection': [
    ['score rolls', async p => {
      await p.fill('#paste', '696969, 123456, 100000, 777777, 42');
      await p.click('#paste-go');
      await p.waitForFunction(() => document.getElementById('out').classList.contains('on'),
        null, { timeout: 20000 });
      return p.$eval('#stats .stat .v', e => e.textContent + ' badges');
    }],
    ['order', p => p.selectOption('#group', 'missing').then(() => p.$eval('#grid .cb', e => e.textContent.trim()))],
    ['next up', p => p.$eval('#next', e => e.children.length + ' rows')],
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
  // The calculator renders nothing without a number; 999999 has plenty of superseded
  // badges, which is what its checks are about.
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
