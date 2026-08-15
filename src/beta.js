// /beta - the lab. Experimental data-vis + insight tools over the same badge engine
// the rest of the site uses.
//
// Everything here reads ONE data source: the shared full-range sweep in /engine.js
// (sweepShared -> { ep, cnt, bits, ROW, examples } for all 1,000,001 inputs), which
// /, /grid and /chains already populate and cache in IndexedDB. So a visitor who has
// used the site once pays nothing to open any of these, and every tool always reflects
// the live badge rules - nothing below is precomputed or committed.
//
// Layout convention, matching the rest of the site:
//   - chart/report pages use the normal document shell (pageShell, .wrap)
//   - canvas apps use the full-bleed glass shell (`full: true`), same as /grid
// Both go through betaShell() so the "beta" ribbon and the loading overlay are shared.

import { pageShell } from './ui.js';

// ---------------------------------------------------------------------------
// Tool registry - drives /beta's index, the prev/next rail and route dispatch.
// `render` is looked up from RENDERERS below (declared after the renderers exist).
// ---------------------------------------------------------------------------

// Reading order, not registry order: the three pictures of the range first, then the
// one you drive, then the two about odds, then the two written up as findings.
export const BETA_TOOLS = [
  {
    slug: 'atlas', title: 'EP Atlas', kind: '3D',
    blurb: 'The whole number line as terrain. 1,000,000 numbers laid out 1000x1000, ' +
      'height and colour from EP - the scoring landscape as a place you can fly over.',
    note: 'WebGL2 - orbit, zoom, click to land on a number.',
  },
  {
    slug: 'spectrum', title: 'Badge Spectrum', kind: '2D',
    blurb: 'Every badge as a density stripe across the full range. Digit-length rules ' +
      'step at each power of ten, modular rules band, exact badges are one lit pixel.',
    note: '230 stripes, orderable by how evenly each rule is spread.',
  },
  {
    slug: 'pairs', title: 'Badge Affinity', kind: 'Matrix',
    blurb: 'Which badges travel together. A 230x230 co-occurrence matrix over every ' +
      'number, plus the conditional odds - given this badge, what else did you get?',
    note: 'Lift, P(B|A) and Jaccard, orderable by family or by cluster.',
  },
  {
    slug: 'oracle', title: 'Digit Oracle', kind: 'Interactive',
    blurb: 'Half a number is already worth something. Lock any digits and every ' +
      'remaining choice is re-scored against the numbers that still match.',
    note: 'Mean EP behind all 60 digit-position choices, conditional on what you know.',
  },
  {
    slug: 'luck', title: 'Luck Lab', kind: 'Odds',
    blurb: 'What a roll is worth before you make it. Exact tier odds, what your best ' +
      'should look like after N rolls, and how lucky a real player actually got.',
    note: 'Closed-form best-of-N off the exact score distribution - nothing simulated.',
  },
  {
    slug: 'collector', title: 'The Collector', kind: 'Odds',
    blurb: 'How many rolls to earn all 230 badges - simulated over the real earner ' +
      'sets - against how few numbers would do it if you could pick them.',
    note: 'Exact collection curve, plus a greedy cover of the whole badge list.',
  },
  {
    slug: 'economy', title: 'Badge Economy', kind: 'Report',
    blurb: 'Every badge turns out to be priced at exactly 100 / its own odds, so all ' +
      '230 are worth the same per roll. Only supersession breaks the tie.',
    note: 'The price law, and what families cost in EP that is earned but never paid.',
  },
  {
    slug: 'species', title: 'Species', kind: 'Report',
    blurb: 'Two numbers with the same badges are the same thing to the scorer. ' +
      'Grouped that way, the range stops being a line and becomes a population.',
    note: 'Distinct badge sets, their rank-size curve, and the true one-of-a-kinds.',
  },
];

const TOOL_BY_SLUG = new Map(BETA_TOOLS.map(t => [t.slug, t]));

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

// Ribbon + overlay + the few primitives every tool page reuses. Emitted before the
// page's own CSS, so a page rule of equal specificity still wins.
const BETA_CSS = `
  .beta-tag { display:inline-block; font-size:.6rem; font-weight:800; letter-spacing:.12em;
    text-transform:uppercase; padding:.16rem .45rem; border-radius:var(--r-pill);
    color:var(--hl-lt); border:1px solid color-mix(in srgb, var(--hl) 45%, transparent);
    background:color-mix(in srgb, var(--hl) 14%, transparent); vertical-align:.15em; }

  /* One-time sweep overlay. Identical on every tool so the wait always looks the same.
     Prefixed because it is a full-screen fixed layer: a tool that happened to reuse a
     bare class name here would paint its own markup over the whole page. */
  .beta-ov { position:fixed; inset:0 0 0 var(--rail-w); z-index:30; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:.9rem; background:var(--bg); text-align:center; padding:1rem; }
  .beta-ov h2 { margin:0; font-size:1rem; font-weight:600; }
  .beta-ov .progress { width:min(340px, 70vw); }
  .beta-ov p { margin:0; color:var(--muted); font-size:.82rem; max-width:34rem; }
  .beta-ov.done { display:none; }

  /* Tool header used by the document-shell pages. */
  .tool-head { display:flex; align-items:flex-start; gap:.7rem; margin-bottom:.2rem; }
  .tool-head h1 { flex:1; min-width:0; }
  .tool-back { font-size:.8rem; color:var(--muted); text-decoration:none; white-space:nowrap;
    padding:.3rem .6rem; border:1px solid var(--border-2); border-radius:var(--r-pill); }
  .tool-back:hover { color:var(--text); border-color:var(--border-3); }`;

/**
 * Wrap a beta tool in the site shell.
 * Same options as pageShell, plus `slug` (marks the current tool, adds the back link).
 */
function betaShell(o) {
  return pageShell({
    ...o,
    nav: 'beta',
    noindex: true,
    css: `${BETA_CSS}\n${o.css || ''}`,
  });
}

// The standard overlay markup. `what` is the one-line explanation under the bar.
function overlayHTML(what) {
  return `<div class="beta-ov" id="ov">
  <h2 id="ovhead">Scoring 1,000,000 numbers…</h2>
  <div class="progress"><i id="ovbar"></i></div>
  <p id="ovtext">${what} One-time - the result is cached in this browser and shared with the other tools.</p>
</div>`;
}

// ---------------------------------------------------------------------------
// Worker plumbing
//
// Every tool follows the same shape: a dedicated Web Worker sweeps (or reads the
// cached sweep), derives whatever that tool needs, and transfers the result to the
// page, which only ever draws. So the one-time sweep AND the per-tool derivation -
// a 230x230 co-occurrence pass is ~100M operations - both stay off the main thread.
//
// Protocol, in both directions:
//   worker -> page   { type:'progress', pct, msg? }   drives the overlay
//                    { type:'ready', ... }            first payload; hides the overlay
//                    anything else                    handed to the page's onMsg
//   page   -> worker { cmd:'init' } then whatever the tool defines
// ---------------------------------------------------------------------------

// Page-side half of the protocol above, serialized into each tool page.
const BETA_BOOT_JS = `
// Boots a tool worker and resolves with its 'ready' payload. Later messages go to
// onMsg. The worker is returned on the promise so the page can keep talking to it.
// Anything in 'init' is merged into the opening message - that is how a tool hands
// the worker server-rendered data (EP per badge, family map) it would otherwise
// have to rebuild.
function betaBoot(workerSrc, onMsg, init) {
  const ov = document.getElementById('ov');
  const bar = document.getElementById('ovbar');
  const head = document.getElementById('ovhead');
  const text = document.getElementById('ovtext');
  const url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
  const w = new Worker(url, { type: 'module' });
  URL.revokeObjectURL(url);
  return new Promise((resolve, reject) => {
    w.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'progress') {
        if (m.msg && head) head.textContent = m.msg;
        if (m.pct != null && bar) bar.style.width = (Math.min(1, m.pct) * 100).toFixed(1) + '%';
        return;
      }
      if (m.type === 'ready') {
        if (ov) ov.classList.add('done');
        resolve({ worker: w, data: m });
        return;
      }
      if (m.type === 'error') { fail(new Error(m.message)); return; }
      if (onMsg) onMsg(m);
    };
    const fail = err => {
      if (head) head.textContent = 'Could not build the data set';
      if (text) text.textContent = String(err && err.message || err);
      if (bar) bar.style.background = 'var(--bad)';
      reject(err);
    };
    w.onerror = e => fail(new Error(e.message || 'worker failed'));
    w.postMessage(Object.assign({ cmd: 'init', origin: location.origin }, init || {}));
  });
}`;

// Worker-side prelude: the shared sweep, wired to the progress protocol. `frac` is
// how much of the progress bar the sweep itself owns, leaving the rest for the
// tool's own derivation (which is what the page is really waiting on).
const BETA_SWEEP_JS = `
let E = null;
async function betaSweep(origin, frac) {
  E = await import(origin + '/engine.js');
  const swept = await E.sweepShared(origin, p =>
    self.postMessage({ type: 'progress', pct: p * frac }));
  if (swept.cached) self.postMessage({ type: 'progress', pct: frac, msg: 'Reading the cached sweep…' });
  return swept;
}
// Decode one number's earned-badge indices out of the sweep bitmask into 'out',
// returning how many there were. Hot path - called 1,000,001 times per tool.
function betaEarned(bits, base, ROW, out) {
  let k = 0;
  for (let b = 0; b < ROW; b++) {
    let v = bits[base + b];
    while (v) { const lo = v & -v; out[k++] = (b << 3) + BETA_LOG2[lo]; v ^= lo; }
  }
  return k;
}
const BETA_LOG2 = (() => { const a = new Uint8Array(256); for (let i = 0; i < 8; i++) a[1 << i] = i; return a; })();`;

// Assemble a tool worker's source: the prelude plus the tool's own body (an IIFE
// built from a real function, the same trick gridWorker/chainsWorker use).
function workerSrc(fn) {
  return `var __name = (f) => f;\n${BETA_SWEEP_JS}\n(${fn.toString()})();`;
}

// ---------------------------------------------------------------------------
// /beta - the index
// ---------------------------------------------------------------------------

// A small abstract mark per tool, so the index reads as a gallery rather than a list.
// Drawn on the card's own accent, 64x40, no text.
const THUMBS = {
  atlas: `<path d="M2 30 L14 18 L22 26 L34 10 L46 22 L62 6" />
    <path d="M2 36 L14 26 L22 33 L34 20 L46 30 L62 16" opacity=".5"/>
    <path d="M2 24 L14 11 L22 19 L34 3 L46 15 L62 1" opacity=".28"/>`,
  pairs: `<rect x="4" y="4" width="9" height="9" opacity=".9"/><rect x="15" y="4" width="9" height="9" opacity=".25"/>
    <rect x="26" y="4" width="9" height="9" opacity=".55"/><rect x="37" y="4" width="9" height="9" opacity=".15"/>
    <rect x="4" y="15" width="9" height="9" opacity=".25"/><rect x="15" y="15" width="9" height="9" opacity=".9"/>
    <rect x="26" y="15" width="9" height="9" opacity=".2"/><rect x="37" y="15" width="9" height="9" opacity=".6"/>
    <rect x="4" y="26" width="9" height="9" opacity=".55"/><rect x="15" y="26" width="9" height="9" opacity=".2"/>
    <rect x="26" y="26" width="9" height="9" opacity=".9"/><rect x="37" y="26" width="9" height="9" opacity=".35"/>`,
  economy: `<circle cx="8" cy="32" r="2.5"/><circle cx="16" cy="27" r="2.5"/><circle cx="21" cy="30" r="2.5"/>
    <circle cx="28" cy="20" r="2.5"/><circle cx="34" cy="23" r="2.5"/><circle cx="41" cy="13" r="2.5"/>
    <circle cx="48" cy="16" r="2.5"/><circle cx="55" cy="7" r="2.5"/>
    <path d="M4 36 L60 4" stroke-dasharray="4 3" opacity=".5"/>`,
  spectrum: `<path d="M4 8h56M4 14h56M4 20h56M4 26h56M4 32h56" stroke-dasharray="2 5" opacity=".9"/>
    <path d="M4 11h56M4 17h56M4 23h56M4 29h56" stroke-dasharray="7 3" opacity=".35"/>`,
  species: `<circle cx="14" cy="20" r="10" opacity=".9"/><circle cx="33" cy="20" r="6" opacity=".6"/>
    <circle cx="45" cy="20" r="4" opacity=".45"/><circle cx="53" cy="20" r="2.5" opacity=".35"/>
    <circle cx="59" cy="20" r="1.5" opacity=".25"/>`,
  collector: `<path d="M4 34 C 20 34, 26 12, 40 8 S 56 5, 60 5"/>
    <circle cx="16" cy="29" r="2.2" opacity=".6"/><circle cx="28" cy="17" r="2.2" opacity=".8"/>
    <circle cx="44" cy="7" r="2.2"/><path d="M4 34h56" opacity=".25"/>`,
  luck: `<path d="M4 34 C 14 34, 18 30, 22 20 S 28 4, 33 4 S 40 12, 45 22 S 54 34, 60 34"/>
    <path d="M45 34v-8M52 34v-4" opacity=".45"/>`,
  oracle: `<rect x="4" y="6" width="10" height="28" rx="2" opacity=".3"/>
    <rect x="17" y="6" width="10" height="28" rx="2" opacity=".95"/>
    <rect x="30" y="6" width="10" height="28" rx="2" opacity=".3"/>
    <rect x="43" y="6" width="10" height="28" rx="2" opacity=".55"/>
    <path d="M19 13h6M19 20h6M19 27h6" opacity=".9"/>`,
};

export function renderBetaIndex() {
  const cards = BETA_TOOLS.map(t => `
    <a class="tool" href="/beta/${t.slug}">
      <div class="tool-thumb" aria-hidden="true"><svg viewBox="0 0 64 40" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${THUMBS[t.slug] || ''}</svg></div>
      <div class="tool-body">
        <h2>${t.title}<span class="tool-kind">${t.kind}</span></h2>
        <p>${t.blurb}</p>
        <div class="tool-note">${t.note}</div>
      </div>
    </a>`).join('');

  const css = `
  #cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(330px,100%),1fr)); gap:.8rem; }
  .tool { display:flex; flex-direction:column; text-decoration:none; color:inherit; overflow:hidden;
    border:1px solid var(--border); border-radius:var(--r-card); background:var(--surface);
    transition:border-color .12s, transform .12s, background .12s; }
  .tool:hover { border-color:var(--accent); transform:translateY(-2px); background:var(--surface-2); }
  .tool-thumb { display:flex; align-items:center; justify-content:center; height:96px;
    color:var(--accent); background:
      radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 72%),
      var(--surface-2);
    border-bottom:1px solid var(--border); }
  .tool-thumb svg { width:128px; height:80px; }
  .tool-body { padding:.8rem .95rem 1rem; display:flex; flex-direction:column; gap:.4rem; flex:1; }
  .tool-body h2 { display:flex; align-items:center; gap:.5rem; font-size:1rem; font-weight:600; margin:0; }
  .tool-kind { font-size:.6rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
    color:var(--muted); border:1px solid var(--border-2); border-radius:var(--r-pill); padding:.12rem .45rem; }
  .tool-body p { margin:0; font-size:.86rem; color:var(--dim); line-height:1.55; }
  .tool-note { margin-top:auto; padding-top:.35rem; font-size:.76rem; color:var(--faint); }

  .lead { border:1px solid var(--border); border-left:3px solid var(--hl);
    border-radius:var(--r-card); background:var(--surface); padding:.9rem 1.05rem; margin-bottom:1.3rem; }
  .lead p { margin:0; font-size:.87rem; color:var(--dim); line-height:1.6; }
  .lead p + p { margin-top:.5rem; }
  .lead b { color:var(--text); font-weight:600; }`;

  const body = `<div class="wrap">
  <h1>Beta lab <span class="beta-tag">experimental</span></h1>
  <p class="tag">Data-vis and insight tools built on the full 1,000,001-number sweep.</p>

  <section class="lead">
    <p>Each of these scores <b>every legal roll</b> - all 1,000,001 of them - in your browser, then
      looks at the result from a different angle. Nothing is precomputed on the server, so they all
      track the live badge rules exactly.</p>
    <p>The sweep runs once, is shared across every tool here (and with <a href="/grid">Grid</a> and
      <a href="/chains">Chains</a>), and is cached in this browser afterwards. Expect a few seconds
      the first time and none after that.</p>
  </section>

  <div id="cards">${cards}</div>

  <footer>
    <b>Beta</b> - these are experiments. Layout, names and routes may change, and none of them are
    linked from the main tools yet.
  </footer>
</div>`;

  return betaShell({ title: 'RNGdle - Beta lab', width: '1100px', slug: '', css, body });
}

// ---------------------------------------------------------------------------
// /beta/pairs - badge affinity.
//
// The sweep already knows, for every number, exactly which badges it earned. Counting
// how often each PAIR of badges shows up on the same number turns that into a 230x230
// matrix, and the interesting reading is not the raw count but the lift:
//
//   lift(A,B) = P(A and B) / (P(A) * P(B))
//
// 1 means the two are independent, >1 means earning A makes B more likely than chance,
// 0 means they never co-occur at all - which for two otherwise common badges says their
// rules are mutually exclusive. Families show up immediately as bright blocks, because
// a family's members are near-nested by construction.
// ---------------------------------------------------------------------------

function pairsWorker() {
  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.55);
      const bits = swept.bits, ROW = swept.ROW, N = swept.ep.length;
      const B = E.BADGE_META.length;

      // Upper triangle only (indices come out of betaEarned ascending), so the page
      // reads cell (i,j) as co[min*B + max]. The diagonal is the earn count.
      const co = new Uint32Array(B * B);
      const idx = new Int32Array(256);
      for (let n = 0; n < N; n++) {
        if ((n & 0x3ffff) === 0) {
          self.postMessage({ type: 'progress', pct: 0.55 + 0.45 * (n / N), msg: 'Counting badge pairs…' });
        }
        const k = betaEarned(bits, n * ROW, ROW, idx);
        for (let a = 0; a < k; a++) {
          const ia = idx[a] * B;
          for (let b = a; b < k; b++) co[ia + idx[b]]++;
        }
      }
      self.postMessage({ type: 'ready', co: co.buffer, B, N }, [co.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

// META[i] = [label, emoji, ep, tierKey, familyIndex]; FAMS = family display names;
// PAL = tier key -> accent colour.
function pairsClient(WORKER_SRC, META, FAMS, PAL) {
  const B = META.length;
  const $ = id => document.getElementById(id);
  const fmtN = n => n.toLocaleString();
  // Share of all numbers, at the precision the rest of the site uses for badge rates.
  const pct = p => p === 0 ? '0%' : p >= 1 ? p.toFixed(2) + '%' : p >= 0.01 ? p.toFixed(3) + '%' : p.toFixed(4) + '%';

  let CO = null, N = 0, EARN = null;
  let order = null, pos = null;              // order[slot] = badge, pos[badge] = slot
  let sel = -1, hover = -1, metric = 'lift', mode = 'family';
  const clusterCache = {};

  const cell = (i, j) => i <= j ? CO[i * B + j] : CO[j * B + i];

  // --- colour ------------------------------------------------------------
  // Sequential ramp (dark -> accent -> hot), used for the one-sided metrics.
  const SEQ = [[8, 9, 12], [23, 32, 56], [40, 82, 128], [91, 147, 214], [190, 210, 245], [255, 250, 235]];
  // Diverging ramp for lift: cool = rarer together than chance, warm = more often.
  const DIV = [[74, 132, 200], [40, 66, 96], [19, 20, 25], [96, 60, 30], [232, 146, 78], [255, 214, 160]];
  // "Never together" is not the bottom of the lift scale, it is off the scale entirely -
  // and it is also the single most common cell, so give it its own near-black rather than
  // let it flood the ramp's cool end and swamp the pairs that do co-occur.
  const NEVER = [13, 14, 19];
  const UNEARNED = [30, 18, 22];
  function ramp(stops, t) {
    t = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, x | 0), f = x - i;
    const a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  // Every metric maps to [0,1] plus a formatted readout, so the matrix, the legend and
  // the tooltip all agree without a switch in three places.
  const METRICS = {
    lift: {
      label: 'Lift', diverging: true,
      // log2 lift, clamped to +/-6 doublings - past that the colour stops meaning much.
      val: (i, j) => {
        const c = cell(i, j);
        if (!EARN[i] || !EARN[j]) return null;
        if (!c) return 0;                         // never together -> hard floor
        return (c * N) / (EARN[i] * EARN[j]);
      },
      norm: v => v == null ? null : v === 0 ? 0 : 0.5 + Math.max(-1, Math.min(1, Math.log2(v) / 6)) / 2,
      fmt: v => v == null ? '-' : v === 0 ? 'never together' : v >= 100 ? Math.round(v) + 'x' : v.toFixed(2) + 'x',
    },
    cond: {
      label: 'P(B | A)', diverging: false, asym: true,
      val: (i, j) => EARN[i] ? cell(i, j) / EARN[i] : null,
      norm: v => v == null ? null : v,
      fmt: v => v == null ? '-' : (v * 100).toFixed(v >= 0.01 ? 1 : 3) + '%',
    },
    jac: {
      label: 'Jaccard', diverging: false,
      val: (i, j) => { const c = cell(i, j), u = EARN[i] + EARN[j] - c; return u ? c / u : null; },
      norm: v => v == null ? null : v,
      fmt: v => v == null ? '-' : (v * 100).toFixed(v >= 0.01 ? 1 : 3) + '%',
    },
    count: {
      label: 'Shared numbers', diverging: false,
      val: (i, j) => cell(i, j),
      norm: v => v == null ? null : v <= 0 ? 0 : Math.log10(1 + v) / Math.log10(1 + N),
      fmt: v => v == null ? '-' : fmtN(v),
    },
  };

  // --- orderings ---------------------------------------------------------
  function orderBy(kind) {
    const all = Array.from({ length: B }, (_, i) => i);
    if (kind === 'ep') return all.sort((a, b) => META[b][2] - META[a][2] || a - b);
    if (kind === 'rate') return all.sort((a, b) => EARN[b] - EARN[a] || a - b);
    if (kind === 'alpha') return all.sort((a, b) => META[a][0].localeCompare(META[b][0]));
    if (kind === 'cluster') return cluster();
    // family: families in registry order (each internally by EP), then the standalone
    // badges by EP. Reads as the game's own taxonomy down the diagonal.
    return all.sort((a, b) => {
      const fa = META[a][4] < 0 ? 999 : META[a][4], fb = META[b][4] < 0 ? 999 : META[b][4];
      return fa - fb || META[b][2] - META[a][2] || a - b;
    });
  }

  // Average-linkage agglomerative clustering on Jaccard distance, emitting leaves in
  // merge order. 230 items, so the naive O(n^3) is a few tens of milliseconds - not
  // worth a smarter algorithm, and the result is the point: rules that fire on the
  // same numbers end up adjacent no matter which family the game filed them under.
  function cluster() {
    if (clusterCache.v) return clusterCache.v;
    const groups = [], dist = [];
    for (let i = 0; i < B; i++) groups.push([i]);
    const d0 = (i, j) => { const c = cell(i, j), u = EARN[i] + EARN[j] - c; return u ? 1 - c / u : 1; };
    for (let i = 0; i < B; i++) { dist.push(new Float32Array(B)); }
    for (let i = 0; i < B; i++) for (let j = i + 1; j < B; j++) { const v = d0(i, j); dist[i][j] = v; dist[j][i] = v; }

    const live = groups.map((_, i) => i);
    const D = dist.map(r => Float32Array.from(r));
    while (live.length > 1) {
      let bi = 0, bj = 1, best = Infinity;
      for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
        const v = D[live[a]][live[b]];
        if (v < best) { best = v; bi = a; bj = b; }
      }
      const gi = live[bi], gj = live[bj];
      const ni = groups[gi].length, nj = groups[gj].length;
      for (const g of live) {
        if (g === gi || g === gj) continue;
        const v = (D[gi][g] * ni + D[gj][g] * nj) / (ni + nj);
        D[gi][g] = v; D[g][gi] = v;
      }
      groups[gi] = groups[gi].concat(groups[gj]);
      live.splice(bj, 1);
    }
    clusterCache.v = groups[live[0]];
    return clusterCache.v;
  }

  function setOrder(kind) {
    mode = kind;
    order = orderBy(kind);
    pos = new Int32Array(B);
    order.forEach((b, i) => { pos[b] = i; });
    draw();
  }

  // --- matrix ------------------------------------------------------------
  const cv = $('mx'), ctx = cv.getContext('2d');
  const off = document.createElement('canvas');
  off.width = off.height = B;
  const octx = off.getContext('2d');
  const img = octx.createImageData(B, B);
  const BAND = 10;                              // family colour strips along both edges
  let CELL = 3, PAD = 0, SCALE = 1;             // SCALE: drawn px per CSS px (narrow screens)

  // 40 families + standalone: a repeating but locally-distinct hue set, only ever read
  // as "same block / different block", so exact hues do not matter.
  const famColour = f => f < 0 ? '#2a2d36' : `hsl(${(f * 47) % 360} 45% ${f % 2 ? 42 : 56}%)`;

  function paint() {
    const M = METRICS[metric], data = img.data;
    for (let r = 0; r < B; r++) {
      const i = order[r];
      for (let c = 0; c < B; c++) {
        const j = order[c];
        const v = M.val(i, j);
        const k = (r * B + c) * 4;
        const rgb = v == null ? UNEARNED
          : (!cell(i, j) && i !== j) ? NEVER
          : ramp(M.diverging ? DIV : SEQ, M.norm(v));
        data[k] = rgb[0]; data[k + 1] = rgb[1]; data[k + 2] = rgb[2]; data[k + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
  }

  function draw() {
    if (!CO) return;
    // clientWidth of the card minus its padding: the canvas itself must not feed into
    // this measurement, or growing it once would grow it forever.
    const card = cv.parentElement;
    const cs = getComputedStyle(card);
    const inner = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const avail = inner > 40 ? Math.min(inner, 760) : 700;
    // Below 2px a cell stops being visible at all, so on a narrow screen the matrix
    // is drawn at 2px and then scaled down by CSS rather than shrunk further.
    CELL = Math.max(2, Math.floor((avail - BAND - 2) / B));
    const side = B * CELL, total = side + BAND + 2;
    const shown = Math.min(total, avail);
    SCALE = total / shown;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = total * dpr; cv.height = total * dpr;
    cv.style.width = shown + 'px'; cv.style.height = shown + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    PAD = BAND + 2;

    paint();
    ctx.fillStyle = '#08090c'; ctx.fillRect(0, 0, total, total);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, B, B, PAD, PAD, side, side);

    // Family bands: top edge and left edge, so the block structure is readable even
    // when the ordering is not the family one.
    for (let s = 0; s < B; s++) {
      ctx.fillStyle = famColour(META[order[s]][4]);
      ctx.fillRect(PAD + s * CELL, 0, CELL, BAND);
      ctx.fillRect(0, PAD + s * CELL, BAND, CELL);
    }

    // Cross-hairs for the selected badge, and a lighter pair for the hovered one.
    const rule = (b, colour, w) => {
      if (b < 0) return;
      const s = PAD + pos[b] * CELL;
      ctx.fillStyle = colour;
      ctx.fillRect(PAD, s - w, side, CELL + w * 2);
      ctx.fillRect(s - w, PAD, CELL + w * 2, side);
    };
    if (hover >= 0 && hover !== sel) rule(hover, 'rgba(255,255,255,.14)', 0);
    if (sel >= 0) {
      const s = PAD + pos[sel] * CELL;
      ctx.strokeStyle = '#e8924e'; ctx.lineWidth = 1;
      ctx.strokeRect(PAD - .5, s - .5, side + 1, CELL + 1);
      ctx.strokeRect(s - .5, PAD - .5, CELL + 1, side + 1);
    }
    drawLegend();
  }

  function drawLegend() {
    const M = METRICS[metric], lc = $('legcv'), lx = lc.getContext('2d');
    const w = 190, h = 12, dpr = Math.min(2, window.devicePixelRatio || 1);
    lc.width = w * dpr; lc.height = h * dpr; lc.style.width = w + 'px'; lc.style.height = h + 'px';
    lx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let x = 0; x < w; x++) {
      const rgb = ramp(M.diverging ? DIV : SEQ, x / (w - 1));
      lx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
      lx.fillRect(x, 0, 1, h);
    }
    $('leglo').textContent = M.diverging ? '1/64x' : '0';
    $('legmid').textContent = M.diverging ? 'chance' : '';
    $('leghi').textContent = M.diverging ? '64x' : (metric === 'count' ? fmtN(N) : '100%');
  }

  // --- panels ------------------------------------------------------------
  const badgeChip = (b, extra) =>
    `<button type="button" class="prow" data-b="${b}">
      <span class="pe">${META[b][1]}</span>
      <span class="pl">${META[b][0]}</span>
      <span class="pv">${extra}</span>
    </button>`;

  function renderSide() {
    const box = $('side');
    if (sel < 0) {
      box.innerHTML = `<div class="card"><h2>Pick a badge</h2>
        <p class="muted small">Click a row in the matrix, or search below, to see what that badge
        travels with. The diagonal is the badge itself.</p></div>` + globalHTML();
      return;
    }
    const M = METRICS[metric];
    const rows = [];
    for (let j = 0; j < B; j++) {
      if (j === sel || !EARN[j]) continue;
      const c = cell(sel, j);
      rows.push({ j, c, lift: (c * N) / (EARN[sel] * EARN[j]), cond: c / EARN[sel] });
    }
    const together = rows.filter(r => r.c > 0);
    const byLift = together.slice().sort((a, b) => b.lift - a.lift).slice(0, 12);
    const byCond = together.slice().sort((a, b) => b.cond - a.cond).slice(0, 12);
    // "Never together" is only interesting when both badges are common enough that a
    // shared number would be expected - otherwise every rare pair would list here.
    const never = rows.filter(r => r.c === 0 && (EARN[sel] * EARN[r.j]) / N >= 1)
      .sort((a, b) => EARN[b.j] - EARN[a.j]).slice(0, 10);

    const m = META[sel];
    box.innerHTML = `
      <div class="card sel-head" style="--tc:${PAL[m[3]]}">
        <div class="sh-top"><span class="sh-emoji">${m[1]}</span>
          <div class="sh-name"><b>${m[0]}</b><span>${m[4] >= 0 ? FAMS[m[4]] + ' family' : 'standalone'}</span></div>
          <span class="pill">${m[3].toUpperCase()}</span></div>
        <div class="sh-stats">
          <div class="stat"><span class="k">Earned by</span><span class="v">${pct(100 * EARN[sel] / N)}</span>
            <span class="sub">${fmtN(EARN[sel])} numbers</span></div>
          <div class="stat"><span class="k">Pays</span><span class="v">${fmtN(m[2])}</span>
            <span class="sub">EP when it scores</span></div>
          <div class="stat"><span class="k">Travels with</span><span class="v">${fmtN(together.length)}</span>
            <span class="sub">of ${B - 1} other badges</span></div>
        </div>
        <div class="sh-links"><a href="/grid#${encodeURIComponent(m[0])}">map on /grid</a>
          <a href="/badges#${META[sel][5]}">rule</a></div>
      </div>

      <div class="card"><h2>Strongest affinity <em>by lift</em></h2>
        <p class="muted small">How much more likely than chance, given ${m[0]}.</p>
        ${byLift.map(r => badgeChip(r.j, `${r.lift >= 100 ? Math.round(r.lift) : r.lift.toFixed(1)}x`)).join('') ||
          '<p class="muted small">Never shares a number with anything.</p>'}
      </div>

      <div class="card"><h2>Most likely companions <em>P(B | A)</em></h2>
        <p class="muted small">Of the numbers that earn ${m[0]}, this share also earn…</p>
        ${byCond.map(r => badgeChip(r.j, (r.cond * 100).toFixed(r.cond >= .01 ? 1 : 2) + '%')).join('')}
      </div>

      ${never.length ? `<div class="card"><h2>Never together</h2>
        <p class="muted small">Common enough that a shared number would be expected, yet there is not one -
          the two rules exclude each other.</p>
        ${never.map(r => badgeChip(r.j, pct(100 * EARN[r.j] / N))).join('')}
      </div>` : ''}`;
  }

  // Global leaderboards, shown until a badge is picked: the headline read of the matrix.
  let globalCache = null;
  function globalHTML() {
    if (!globalCache) {
      const pairs = [];
      for (let i = 0; i < B; i++) {
        if (EARN[i] < 50) continue;
        for (let j = i + 1; j < B; j++) {
          if (EARN[j] < 50) continue;
          const c = cell(i, j);
          const exp = (EARN[i] * EARN[j]) / N;
          if (c === 0) { if (exp >= 20) pairs.push({ i, j, kind: 'x', exp }); continue; }
          pairs.push({ i, j, kind: 'a', lift: c / exp, c });
        }
      }
      const aff = pairs.filter(p => p.kind === 'a' && META[p.i][4] !== META[p.j][4])
        .sort((a, b) => b.lift - a.lift).slice(0, 10);
      const exc = pairs.filter(p => p.kind === 'x').sort((a, b) => b.exp - a.exp).slice(0, 10);
      const row = (p, v) => `<button type="button" class="prow prow-2" data-b="${p.i}">
        <span class="pl"><span class="pe">${META[p.i][1]}</span>${META[p.i][0]}
          <em>+</em><span class="pe">${META[p.j][1]}</span>${META[p.j][0]}</span>
        <span class="pv">${v}</span></button>`;
      globalCache = `
        <div class="card"><h2>Strongest cross-family affinity</h2>
          <p class="muted small">Pairs from different families that show up together far more than chance.
            Both badges earned by at least 50 numbers.</p>
          ${aff.map(p => row(p, (p.lift >= 100 ? Math.round(p.lift) : p.lift.toFixed(1)) + 'x')).join('')}
        </div>
        <div class="card"><h2>Mutually exclusive</h2>
          <p class="muted small">Pairs that never share a number despite 20+ shared numbers being expected.
            Ranked by how many were expected.</p>
          ${exc.map(p => row(p, fmtN(Math.round(p.exp)) + ' expected')).join('') ||
            '<p class="muted small">None - every common pair co-occurs at least once.</p>'}
        </div>`;
    }
    return globalCache;
  }

  // --- list + search -----------------------------------------------------
  function renderList() {
    const q = $('q').value.trim().toLowerCase();
    const items = order.filter(b => !q || META[b][0].toLowerCase().includes(q));
    $('list').innerHTML = items.map(b =>
      `<button type="button" class="item${b === sel ? ' on' : ''}" data-b="${b}">` +
      `<span class="ie">${META[b][1]}</span><span class="il">${META[b][0]}</span>` +
      `<em>${pct(100 * EARN[b] / N)}</em></button>`).join('');
    $('lcount').textContent = items.length === B ? `${B} badges` : `${items.length} of ${B}`;
  }

  function select(b) {
    sel = b;
    renderSide(); renderList(); draw();
    if (b >= 0) location.hash = encodeURIComponent(META[b][0]);
  }

  // --- events ------------------------------------------------------------
  function cellAt(ev) {
    const r = cv.getBoundingClientRect();
    // SCALE undoes the CSS downscale applied when the matrix cannot fit at 2px cells.
    const x = (ev.clientX - r.left) * SCALE - PAD, y = (ev.clientY - r.top) * SCALE - PAD;
    const c = Math.floor(x / CELL), rw = Math.floor(y / CELL);
    if (c < 0 || rw < 0 || c >= B || rw >= B) return null;
    return { i: order[rw], j: order[c] };
  }

  const tip = $('tip');
  cv.addEventListener('mousemove', ev => {
    const at = cellAt(ev);
    if (!at) { tip.style.display = 'none'; if (hover !== -1) { hover = -1; draw(); } return; }
    if (at.i !== hover) { hover = at.i; draw(); }
    const M = METRICS[metric], c = cell(at.i, at.j);
    const sameHtml = at.i === at.j
      ? `<span>${fmtN(EARN[at.i])} numbers earn it - ${pct(100 * EARN[at.i] / N)}</span>`
      : `<span>${fmtN(c)} numbers earn both</span>
         <span>${M.label}: ${M.fmt(M.val(at.i, at.j))}</span>`;
    tip.innerHTML = `<b>${META[at.i][1]} ${META[at.i][0]}</b>` +
      (at.i === at.j ? '' : `<b class="t2">${META[at.j][1]} ${META[at.j][0]}</b>`) + sameHtml;
    tip.style.display = 'block';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - tw - 8, ev.clientX + 14) + 'px';
    tip.style.top = Math.max(8, ev.clientY - th - 12) + 'px';
  });
  cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; hover = -1; draw(); });
  cv.addEventListener('click', ev => { const at = cellAt(ev); if (at) select(at.i === sel ? at.j : at.i); });

  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-b]');
    if (b) select(Number(b.dataset.b));
  });
  $('q').addEventListener('input', renderList);
  $('metric').addEventListener('change', e => { metric = e.target.value; draw(); renderSide(); });
  $('order').addEventListener('change', e => {
    const v = e.target.value;
    if (v === 'cluster' && !clusterCache.v) {
      $('order').disabled = true;
      setTimeout(() => { setOrder(v); $('order').disabled = false; renderList(); }, 16);
      return;
    }
    setOrder(v); renderList();
  });
  addEventListener('resize', draw);

  // --- boot --------------------------------------------------------------
  betaBoot(WORKER_SRC).then(({ data }) => {
    CO = new Uint32Array(data.co); N = data.N;
    EARN = new Uint32Array(B);
    for (let i = 0; i < B; i++) EARN[i] = CO[i * B + i];
    setOrder('family');
    renderList();
    const want = decodeURIComponent(location.hash.slice(1));
    const hit = want ? META.findIndex(m => m[0] === want) : -1;
    if (hit >= 0) select(hit); else renderSide();
  });
}

function renderPairs(ctx) {
  const { BADGES, FAMILIES, FAMILY_NAMES, TIER_PALETTE, tierFromScore } = ctx;
  const famOf = new Map();
  FAMILIES.forEach((fam, fi) => { for (const id of fam) famOf.set(id, fi); });
  // [label, emoji, ep, tier, familyIndex, id] - id is last because only the "rule" link
  // uses it, and the first five are what the hot rendering paths touch.
  const meta = BADGES.map(([id, label, emoji, ep]) =>
    [label, emoji, ep, tierFromScore(ep), famOf.has(id) ? famOf.get(id) : -1, id]);
  const pal = Object.fromEntries(Object.entries(TIER_PALETTE).map(([k, v]) => [k, v.accent]));

  const css = `
  .bar { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-bottom:1rem; }
  .bar label { font-size:.78rem; color:var(--muted); }
  .bar select { font-size:.85rem; padding:.4rem .5rem; }
  /* Both tracks are fr-sized (with a 0 minimum) so the matrix column's width comes from
     the grid, never from the canvas inside it - see draw()'s measurement note. */
  .cols { display:grid; grid-template-columns:minmax(0,730px) minmax(0,1fr); gap:1rem; align-items:start; }
  @media (max-width:1000px) { .cols { grid-template-columns:minmax(0,1fr); } }

  .mxcard { padding:.8rem; display:flex; flex-direction:column; gap:.6rem; align-items:center; }
  #mx { display:block; max-width:100%; cursor:crosshair; border-radius:var(--r-sm); }
  .leg { display:grid; grid-template-columns:auto auto auto; align-items:center; gap:.15rem .5rem;
    font-size:.72rem; color:var(--faint); font-variant-numeric:tabular-nums; }
  #legcv { grid-column:2; border-radius:var(--r-pill); }
  #leglo { grid-column:1; } #leghi { grid-column:3; }
  #legmid { grid-column:2; grid-row:2; text-align:center; color:var(--muted); }
  .legnote { grid-column:1 / -1; grid-row:3; display:flex; justify-content:center; gap:.9rem;
    margin-top:.15rem; color:var(--faint); }
  .legnote i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:.3rem;
    vertical-align:-1px; border:1px solid var(--border-2); }

  .picker { display:flex; flex-direction:column; gap:.4rem; width:100%; }
  #q { width:100%; }
  #list { display:flex; flex-direction:column; gap:1px; max-height:200px; overflow:auto;
    border:1px solid var(--border); border-radius:var(--r-sm); padding:.2rem; }
  .item { display:flex; align-items:center; gap:.4rem; width:100%; text-align:left;
    padding:.28rem .45rem; font-size:.8rem; font-weight:400; line-height:1.5;
    color:var(--dim); background:transparent; border:0; border-radius:var(--r-sm); }
  .item:hover { background:var(--surface-2); border:0; }
  .item.on { background:color-mix(in srgb, var(--hl) 20%, transparent); color:var(--hl-lt); }
  .item .ie { flex:0 0 auto; }
  .item .il { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .item em { flex:0 0 auto; font-style:normal; color:var(--faint); font-family:var(--mono); font-size:.72rem; }
  #lcount { font-size:.72rem; color:var(--faint); }

  #side { display:flex; flex-direction:column; gap:.7rem; }
  #side .card h2 em { font-style:normal; font-weight:500; letter-spacing:0; text-transform:none;
    color:var(--faint); font-family:var(--mono); }
  .small { font-size:.78rem; line-height:1.5; margin:-.3rem 0 .6rem; }
  .sel-head { border-left:3px solid var(--tc); }
  .sh-top { display:flex; align-items:center; gap:.55rem; margin-bottom:.7rem; }
  .sh-emoji { font-size:1.3rem; }
  .sh-name { flex:1; min-width:0; display:flex; flex-direction:column; }
  .sh-name b { font-size:1rem; font-weight:600; }
  .sh-name span { font-size:.74rem; color:var(--muted); }
  .sh-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.4rem; }
  .sh-links { display:flex; gap:.8rem; margin-top:.7rem; font-size:.78rem; }

  .prow { display:flex; align-items:center; gap:.5rem; width:100%; text-align:left; padding:.32rem .45rem;
    font-size:.82rem; font-weight:400; color:var(--dim); background:transparent; border:0;
    border-radius:var(--r-sm); }
  .prow:hover { background:var(--surface-2); border:0; color:var(--text); }
  .prow .pe { flex:0 0 auto; }
  .prow .pl { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .prow .pv { flex:0 0 auto; font-family:var(--mono); font-size:.78rem; color:var(--hl-lt);
    font-variant-numeric:tabular-nums; }
  .prow-2 .pl em { font-style:normal; color:var(--faint); margin:0 .3rem; }
  .prow-2 .pl .pe { margin-right:.25rem; }

  #tip { position:fixed; z-index:20; display:none; pointer-events:none; padding:.45rem .6rem;
    background:#06070a; border:1px solid var(--border-2); border-radius:var(--r-ctl);
    font-size:.78rem; box-shadow:0 10px 30px rgba(0,0,0,.6); }
  #tip b { display:block; font-size:.84rem; font-weight:600; }
  #tip b.t2::before { content:'+ '; color:var(--faint); }
  #tip span { display:block; color:var(--muted); font-size:.74rem; margin-top:.15rem;
    font-variant-numeric:tabular-nums; }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Badge Affinity <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">Which badges travel together, counted over every one of the 1,000,001 legal rolls.</p>

  <div class="bar">
    <label for="metric">Colour</label>
    <select id="metric">
      <option value="lift">Lift - vs. chance</option>
      <option value="cond">P(B | A) - row given column</option>
      <option value="jac">Jaccard - overlap</option>
      <option value="count">Shared numbers</option>
    </select>
    <label for="order">Order</label>
    <select id="order">
      <option value="family">Family</option>
      <option value="cluster">Cluster - by what they co-occur with</option>
      <option value="ep">EP</option>
      <option value="rate">How often earned</option>
      <option value="alpha">Name</option>
    </select>
  </div>

  <div class="cols">
    <section class="card mxcard">
      <canvas id="mx" width="700" height="700" aria-label="230 by 230 badge co-occurrence matrix"></canvas>
      <div class="leg"><span id="leglo"></span><canvas id="legcv"></canvas><span id="leghi"></span>
        <span id="legmid"></span>
        <span class="legnote"><span><i style="background:#0d0e13"></i>never together</span>
          <span><i style="background:#1e1216"></i>never earned</span></span></div>
      <div class="picker">
        <input id="q" type="search" placeholder="Find a badge…" autocomplete="off">
        <div id="list"></div>
        <div id="lcount"></div>
      </div>
    </section>
    <div id="side"></div>
  </div>

  <div id="tip"></div>
  <footer>
    <b>Lift</b> is P(A and B) / (P(A) x P(B)): 1x means the two badges are independent, 10x means
    earning one makes the other ten times likelier than chance, and <b>never together</b> means no
    number in the whole range earns both. <b>The bands</b> along the top and left edge colour each
    badge by family, so family blocks stay visible under every ordering.
  </footer>
</div>
${overlayHTML('Then counting how often each of the 26,335 badge pairs lands on the same number.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(pairsWorker))};
(${pairsClient.toString()})(__W, ${JSON.stringify(meta)}, ${JSON.stringify(FAMILY_NAMES)}, ${JSON.stringify(pal)});`;

  return betaShell({ title: 'RNGdle - Badge Affinity', width: '1180px', slug: 'pairs', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/atlas - the EP landscape as terrain.
//
// /grid already lays the range out as a 1000x1000 image (number n at x = n % 1000,
// y = n / 1000) and paints EP as brightness. Lifting that same field into the third
// dimension turns it into a place: the ridges are the multiples-of-1111 diagonals,
// the plateaus are digit-length boundaries, and the isolated spires are the handful
// of numbers carrying a mythic badge.
//
// Everything is drawn from ONE mesh with no vertex attributes at all - the vertex
// shader derives its grid position from gl_VertexID and fetches height, EP and badge
// count out of a single RGBA32F texture. So switching colour mode or exaggeration is
// a uniform change, and switching resolution only swaps the index buffer.
// ---------------------------------------------------------------------------

function atlasWorker() {
  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.9);
      // The square face of the range is 0..999,999; 1,000,000 is the one 7-digit roll
      // and has no cell, exactly as on /grid.
      const N = 1000000;
      self.postMessage({ type: 'progress', pct: 0.92, msg: 'Building the height field…' });

      const ep = new Float32Array(N);
      let max = 0, sum = 0;
      for (let i = 0; i < N; i++) { const v = swept.ep[i]; ep[i] = v; sum += v; if (v > max) max = v; }
      const cnt = new Uint8Array(N);
      cnt.set(swept.cnt.subarray(0, N));

      // The tallest points, so the tool can offer to fly you to them.
      const peaks = [];
      for (let i = 0; i < N; i++) {
        if (peaks.length < 12) { peaks.push(i); if (peaks.length === 12) peaks.sort((a, b) => swept.ep[b] - swept.ep[a]); continue; }
        if (swept.ep[i] > swept.ep[peaks[11]]) {
          peaks[11] = i;
          for (let k = 11; k > 0 && swept.ep[peaks[k]] > swept.ep[peaks[k - 1]]; k--) {
            const t = peaks[k]; peaks[k] = peaks[k - 1]; peaks[k - 1] = t;
          }
        }
      }
      self.postMessage({ type: 'ready', ep: ep.buffer, cnt: cnt.buffer, max, mean: sum / N, peaks },
        [ep.buffer, cnt.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

// TIERS = [{ name, label, accent, lo }] ascending, lo = inclusive EP floor.
function atlasClient(WORKER_SRC, TIERS) {
  const $ = id => document.getElementById(id);
  const SIDE = 1000;                                  // cells per side at full detail
  const cv = $('gl');
  const gl = cv.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
  if (!gl) {
    $('ovhead').textContent = 'WebGL2 not available';
    $('ovtext').textContent = 'This tool needs WebGL2. Everything else in the lab works without it.';
    return;
  }

  let EP = null, CNT = null, MAXEP = 1, PEAKS = [];
  let S = 1000, mode = 0, exag = 1, hsrc = 'log', showGrid = true;
  let mesh = null, tex = null, prog = null, vao = null, uni = {};
  let sel = -1, hoverCell = -1;

  // --- shaders -----------------------------------------------------------
  const VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform mat4 uMVP;
uniform sampler2D uT;        // (height 0..1, EP, badge count, -)
uniform int uS;
uniform float uY;            // vertical exaggeration, in world units
out float vH; out float vEP; out float vC; out vec2 vUV; out vec3 vN; out vec3 vP;
float hAt(ivec2 p) { return texelFetch(uT, clamp(p, ivec2(0), ivec2(uS - 1)), 0).r; }
void main() {
  int gx = gl_VertexID % uS, gy = gl_VertexID / uS;
  vec4 t = texelFetch(uT, ivec2(gx, gy), 0);
  vH = t.r; vEP = t.g; vC = t.b;
  float d = 2.0 / float(uS - 1);
  // Central differences on the four neighbours - cheap, and the only lighting cue
  // that makes the ridge structure legible at a glance.
  vec3 n = vec3((hAt(ivec2(gx - 1, gy)) - hAt(ivec2(gx + 1, gy))) * uY, 2.0 * d,
                (hAt(ivec2(gx, gy - 1)) - hAt(ivec2(gx, gy + 1))) * uY);
  vN = normalize(n);
  vUV = vec2(float(gx), float(gy)) / float(uS - 1);
  vP = vec3(vUV.x * 2.0 - 1.0, t.r * uY, vUV.y * 2.0 - 1.0);
  gl_Position = uMVP * vec4(vP, 1.0);
}`;

  const FS = `#version 300 es
precision highp float;
precision highp int;
in float vH; in float vEP; in float vC; in vec2 vUV; in vec3 vN; in vec3 vP;
uniform vec3 uTier[7];
uniform float uCut[6];
uniform int uMode;           // 0 tier, 1 height ramp, 2 badge count
uniform float uMaxC;
uniform int uGrid;
uniform int uS;
uniform vec3 uEye;
uniform vec2 uSel;           // selected cell, or (-1,-1)
out vec4 o;

vec3 tierColour(float ep) {
  vec3 c = uTier[0];
  for (int i = 0; i < 6; i++) if (ep >= uCut[i]) c = uTier[i + 1];
  return c;
}
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(.043,.055,.086), b = vec3(.09,.18,.35), c = vec3(.20,.47,.72),
       d = vec3(.55,.75,.85), e = vec3(1.0,.95,.85);
  return t < .25 ? mix(a, b, t / .25) : t < .5 ? mix(b, c, (t - .25) / .25)
       : t < .75 ? mix(c, d, (t - .5) / .25) : mix(d, e, (t - .75) / .25);
}
void main() {
  vec3 base = uMode == 0 ? tierColour(vEP)
            : uMode == 1 ? ramp(vH)
            : ramp(vC / max(uMaxC, 1.0));
  vec3 L = normalize(vec3(.45, .8, .35));
  float lam = max(dot(normalize(vN), L), 0.0);
  vec3 col = base * (.30 + .78 * lam);
  // Rim light along the silhouette, so ridges read against the background.
  vec3 V = normalize(uEye - vP);
  col += base * pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0) * .30;

  // Cell grid every 100 rows/columns, i.e. every 100,000 numbers down and every
  // 100 along - the only way to keep your bearings once the camera is tilted.
  if (uGrid == 1) {
    vec2 g = vUV * 10.0;
    vec2 w = fwidth(g);
    vec2 f = abs(fract(g - .5) - .5) / max(w, vec2(1e-5));
    float line = 1.0 - min(min(f.x, f.y), 1.0);
    col = mix(col, vec3(.75, .82, .95), line * .16);
  }
  if (uSel.x >= 0.0) {
    vec2 d = abs(vUV * float(uS - 1) - uSel);
    if (max(d.x, d.y) < 2.0) col = mix(col, vec3(1.0, .62, .25), .8);
  }
  // Distance haze towards the page background, for depth.
  float fog = clamp((length(uEye - vP) - 2.0) / 4.5, 0.0, 1.0);
  o = vec4(mix(col, vec3(.031,.035,.047), fog * .8), 1.0);
}`;

  // Picking is a second pass of the same mesh, but through a projection that blows the
  // pixel under the cursor up to fill a 1x1 framebuffer - so every other triangle is
  // clipped and the pass costs almost nothing.
  const PICK_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV; in float vH; in float vEP; in float vC; in vec3 vN; in vec3 vP;
uniform int uS;
out vec4 o;
void main() {
  vec2 c = floor(vUV * float(uS - 1) + .5);
  float id = c.y * float(uS) + c.x;
  o = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0), 255.0) / 255.0;
}`;

  function compile(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function link(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compile(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  // --- maths -------------------------------------------------------------
  function mul(a, b) {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      r[i * 4 + j] = s;
    }
    return r;
  }
  function perspective(fov, asp, near, far) {
    const f = 1 / Math.tan(fov / 2), d = near - far;
    return new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / d, -1, 0, 0, 2 * far * near / d, 0]);
  }
  function lookAt(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // --- camera ------------------------------------------------------------
  const cam = { az: 0.65, el: 0.62, dist: 3.4, tx: 0, tz: 0 };
  function eyePos() {
    const ce = Math.cos(cam.el);
    return [cam.tx + cam.dist * ce * Math.sin(cam.az), cam.dist * Math.sin(cam.el),
      cam.tz + cam.dist * ce * Math.cos(cam.az)];
  }
  function viewProj(pick) {
    const asp = cv.width / cv.height;
    let p = perspective(0.9, asp, 0.02, 40);
    if (pick) {
      // Pick matrix: scale NDC so the one pixel under the cursor fills the viewport.
      const sx = cv.width / 1, sy = cv.height / 1;
      const ox = -(2 * pick[0] / cv.width - 1) * sx, oy = -(2 * (1 - pick[1] / cv.height) - 1) * sy;
      p = mul(new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, ox, oy, 0, 1]), p);
    }
    return mul(p, lookAt(eyePos(), [cam.tx, 0.12, cam.tz], [0, 1, 0]));
  }

  // --- mesh + texture ----------------------------------------------------
  // Max-pool down from the full 1000x1000: averaging would erase the spires, which
  // are the whole point - a single mythic number must survive at every LOD.
  function buildTexture() {
    const step = SIDE / S;
    const data = new Float32Array(S * S * 4);
    const lg = v => Math.log10(1 + v);
    // Raw EP spans six orders of magnitude (a single digit scores ~186M, a typical
    // six-digit roll a few thousand), so linear height is one spike and a flat plain.
    // Log is the default; badge count is the flattest, most readable surface of the
    // three because it is bounded and roughly normal.
    const MAXC = 48;
    const height = (ep, c) => hsrc === 'count' ? Math.min(1, c / MAXC)
      : hsrc === 'lin' ? ep / MAXEP : lg(ep) / lg(MAXEP);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let best = 0, bc = 0;
        for (let dy = 0; dy < step; dy++) {
          const row = (y * step + dy) * SIDE + x * step;
          for (let dx = 0; dx < step; dx++) {
            const v = EP[row + dx];
            if (v > best) { best = v; bc = CNT[row + dx]; }
          }
        }
        const k = (y * S + x) * 4;
        data[k] = height(best, bc);
        data[k + 1] = best; data[k + 2] = bc; data[k + 3] = 0;
      }
    }
    if (!tex) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, S, S, 0, gl.RGBA, gl.FLOAT, data);
  }

  function buildMesh() {
    const q = S - 1, idx = new Uint32Array(q * q * 6);
    let k = 0;
    for (let y = 0; y < q; y++) {
      for (let x = 0; x < q; x++) {
        const a = y * S + x, b = a + 1, c = a + S, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    if (!mesh) mesh = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    return idx.length;
  }

  let indexCount = 0, pickProg = null, pickFbo = null, pickTex = null;

  function setResolution(next) {
    S = next;
    buildTexture();
    indexCount = buildMesh();
    render();
  }

  // --- render ------------------------------------------------------------
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(cv.clientWidth * dpr), h = Math.floor(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }

  function setCommon(p, mvp) {
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uMVP'), false, mvp);
    gl.uniform1i(gl.getUniformLocation(p, 'uS'), S);
    gl.uniform1f(gl.getUniformLocation(p, 'uY'), 0.55 * exag);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(p, 'uT'), 0);
  }

  let needsDraw = false;
  function render() { if (!needsDraw) { needsDraw = true; requestAnimationFrame(frame); } }
  function frame() {
    needsDraw = false;
    if (!EP || !indexCount) return;
    resize();
    gl.viewport(0, 0, cv.width, cv.height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.031, 0.035, 0.047, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const mvp = viewProj(null);
    setCommon(prog, mvp);
    gl.uniform1i(uni.mode, mode);
    gl.uniform1i(uni.grid, showGrid ? 1 : 0);
    gl.uniform1f(uni.maxc, 40);
    gl.uniform3fv(uni.eye, new Float32Array(eyePos()));
    gl.uniform2f(uni.sel, sel < 0 ? -1 : (sel % SIDE) * (S / SIDE), sel < 0 ? -1 : Math.floor(sel / SIDE) * (S / SIDE));
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
  }

  function pick(px, py) {
    if (!EP || !indexCount) return -1;
    if (!pickFbo) {
      pickTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, pickTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 1, 1);
      pickFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    const dpr = cv.width / cv.clientWidth;
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
    gl.viewport(0, 0, 1, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    setCommon(pickProg, viewProj([px * dpr, py * dpr]));
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    const buf = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (buf[0] === 255 && buf[1] === 255 && buf[2] === 255) return -1;   // background
    const id = buf[0] + buf[1] * 256 + buf[2] * 65536;
    const gx = id % S, gy = Math.floor(id / S), step = SIDE / S;
    if (gy >= S) return -1;
    // Inside a pooled cell, the number worth reporting is the one that made the peak.
    let best = -1, bv = -1;
    for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) {
      const n = (gy * step + dy) * SIDE + gx * step + dx;
      if (EP[n] > bv) { bv = EP[n]; best = n; }
    }
    return best;
  }

  // --- HUD ---------------------------------------------------------------
  const fmt = n => n.toLocaleString();
  function tierOf(ep) { let t = TIERS[0]; for (const x of TIERS) if (ep >= x.lo) t = x; return t; }

  function showCell(n) {
    const box = $('read');
    if (n < 0) { box.classList.remove('on'); return; }
    const t = tierOf(EP[n]);
    box.classList.add('on');
    box.innerHTML = `<div class="rd-top"><span class="rd-n">${fmt(n)}</span>
        <span class="pill" style="--tc:${t.accent}">${t.label}</span></div>
      <div class="rd-row"><span>EP</span><b>${fmt(Math.round(EP[n]))}</b></div>
      <div class="rd-row"><span>Badges</span><b>${CNT[n]}</b></div>
      <div class="rd-row"><span>Cell</span><b>${n % SIDE}, ${Math.floor(n / SIDE)}</b></div>
      <a class="rd-open" href="/?n=${n}">Open on the calculator &rarr;</a>`;
  }

  function flyTo(n) {
    sel = n;
    cam.tx = ((n % SIDE) / SIDE) * 2 - 1;
    cam.tz = (Math.floor(n / SIDE) / SIDE) * 2 - 1;
    cam.dist = Math.min(cam.dist, 1.1);
    showCell(n); render();
  }

  // --- interaction -------------------------------------------------------
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.shiftKey || e.button === 1 };
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan) {
      const s = cam.dist * 0.0016;
      cam.tx -= (dx * Math.cos(cam.az) - dy * Math.sin(cam.az) * Math.sin(cam.el)) * s;
      cam.tz += (dx * Math.sin(cam.az) + dy * Math.cos(cam.az) * Math.sin(cam.el)) * s;
    } else {
      cam.az -= dx * 0.006;
      cam.el = Math.max(0.05, Math.min(1.52, cam.el + dy * 0.005));
    }
    render();
  });
  cv.addEventListener('pointerup', e => {
    const wasClick = drag && drag.moved < 5;
    drag = null;
    if (!wasClick) return;
    const r = cv.getBoundingClientRect();
    const n = pick(e.clientX - r.left, e.clientY - r.top);
    sel = n; showCell(n); render();
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist = Math.max(0.25, Math.min(9, cam.dist * Math.exp(e.deltaY * 0.0012)));
    render();
  }, { passive: false });

  $('res').addEventListener('change', e => setResolution(Number(e.target.value)));
  $('mode').addEventListener('change', e => { mode = Number(e.target.value); render(); });
  $('exag').addEventListener('input', e => {
    exag = Number(e.target.value);
    $('exagv').textContent = exag.toFixed(2).replace(/0$/, '') + 'x';
    render();
  });
  $('hsrc').addEventListener('change', e => { hsrc = e.target.value; buildTexture(); render(); });
  $('grid').addEventListener('change', e => { showGrid = e.target.checked; render(); });
  $('top').addEventListener('click', () => { cam.az = 0; cam.el = 1.5; cam.dist = 2.6; cam.tx = cam.tz = 0; render(); });
  $('reset').addEventListener('click', () => {
    cam.az = 0.65; cam.el = 0.62; cam.dist = 3.4; cam.tx = cam.tz = 0; sel = -1;
    showCell(-1); render();
  });
  $('goto').addEventListener('submit', e => {
    e.preventDefault();
    const v = Math.max(0, Math.min(999999, parseInt($('gn').value.replace(/\D/g, ''), 10) || 0));
    flyTo(v);
  });
  addEventListener('resize', render);

  // --- boot --------------------------------------------------------------
  betaBoot(WORKER_SRC).then(({ data }) => {
    EP = new Float32Array(data.ep); CNT = new Uint8Array(data.cnt);
    MAXEP = data.max; PEAKS = data.peaks;

    prog = link(VS, FS);
    pickProg = link(VS, PICK_FS);
    vao = gl.createVertexArray();
    uni = {
      mode: gl.getUniformLocation(prog, 'uMode'), grid: gl.getUniformLocation(prog, 'uGrid'),
      maxc: gl.getUniformLocation(prog, 'uMaxC'), eye: gl.getUniformLocation(prog, 'uEye'),
      sel: gl.getUniformLocation(prog, 'uSel'),
    };
    gl.useProgram(prog);
    gl.uniform3fv(gl.getUniformLocation(prog, 'uTier'),
      new Float32Array(TIERS.flatMap(t => {
        const h = t.accent.slice(1);
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
      })));
    gl.uniform1fv(gl.getUniformLocation(prog, 'uCut'), new Float32Array(TIERS.slice(1).map(t => t.lo)));

    setResolution(S);
    $('peaks').innerHTML = PEAKS.slice(0, 8).map(n =>
      `<button type="button" class="peak" data-n="${n}">${fmt(n)}<em>${fmt(Math.round(EP[n]))} EP</em></button>`).join('');
    $('peaks').addEventListener('click', e => {
      const b = e.target.closest('[data-n]');
      if (b) flyTo(Number(b.dataset.n));
    });
    $('hud').classList.add('on');
  });
}

function renderAtlas(ctx) {
  const { CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE } = ctx;
  const tiers = CARD_TIER_NAMES.map((key, i) => ({
    name: key, label: TIER_PALETTE[key].label, accent: TIER_PALETTE[key].accent,
    lo: i === 0 ? 0 : CARD_TIERS[i - 1][0],
  }));

  const css = `
  body { -webkit-user-select:none; user-select:none; }
  #gl { position:fixed; top:0; left:var(--rail-w); width:calc(100% - var(--rail-w)); height:100%;
    display:block; cursor:grab; touch-action:none; }
  #gl:active { cursor:grabbing; }
  .glass { position:fixed; z-index:5; background:rgba(12,14,22,.86); border:1px solid rgba(255,255,255,.12);
    border-radius:var(--r-card); backdrop-filter:blur(6px); }

  #hud { top:12px; left:calc(var(--rail-w) + 12px); width:250px; padding:12px; display:none;
    flex-direction:column; gap:.7rem; max-height:calc(100vh - 24px); overflow:auto; }
  #hud.on { display:flex; }
  #hud h1 { font-size:14px; font-weight:650; margin:0; }
  #hud .sub { font-size:11.5px; color:var(--muted); line-height:1.5; }
  #hud a.back { font-size:11.5px; color:var(--muted); text-decoration:none; }
  #hud a.back:hover { color:var(--text); }
  .ctl { display:flex; flex-direction:column; gap:.25rem; }
  .ctl > span { font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); font-weight:600; }
  .ctl > span em { font-style:normal; color:var(--muted); font-family:var(--mono); letter-spacing:0; }
  .ctl select, .ctl input[type=range] { width:100%; }
  .ctl select { font-size:12px; padding:.35rem .45rem; background:rgba(255,255,255,.06);
    border-color:rgba(255,255,255,.14); }
  .chk { display:flex; align-items:center; gap:.45rem; font-size:12px; color:var(--dim); cursor:pointer; }
  .row2 { display:flex; gap:6px; }
  .row2 button { flex:1; font-size:12px; padding:.4rem .5rem; background:rgba(255,255,255,.06);
    border-color:rgba(255,255,255,.14); }
  #goto { display:flex; gap:6px; }
  #gn { flex:1; min-width:0; font-size:12px; padding:.35rem .45rem; background:rgba(255,255,255,.06);
    border-color:rgba(255,255,255,.14); }
  #goto button { flex:0 0 auto; font-size:12px; padding:.35rem .6rem; background:rgba(255,255,255,.06);
    border-color:rgba(255,255,255,.14); }
  #peaks { display:flex; flex-direction:column; gap:1px; }
  .peak { display:flex; justify-content:space-between; align-items:baseline; gap:.5rem; width:100%;
    padding:.28rem .4rem; font-size:12px; font-weight:400; font-family:var(--mono); color:var(--dim);
    background:transparent; border:0; border-radius:var(--r-sm); }
  .peak:hover { background:rgba(255,255,255,.08); border:0; color:var(--text); }
  .peak em { font-style:normal; font-size:11px; color:var(--faint); }

  #read { top:12px; right:12px; width:210px; padding:11px 12px; display:none; flex-direction:column; gap:.3rem; }
  #read.on { display:flex; }
  .rd-top { display:flex; align-items:center; justify-content:space-between; gap:.5rem; margin-bottom:.3rem; }
  .rd-n { font-family:var(--mono); font-size:1.05rem; font-weight:600; letter-spacing:-.02em; }
  .rd-row { display:flex; justify-content:space-between; font-size:12px; color:var(--muted); }
  .rd-row b { font-family:var(--mono); font-weight:600; color:var(--text); }
  .rd-open { margin-top:.45rem; font-size:11.5px; text-decoration:none; }

  #legend { bottom:12px; right:12px; padding:9px 12px; display:flex; flex-wrap:wrap; gap:.35rem .8rem;
    max-width:min(420px, 60vw); font-size:11.5px; color:var(--dim); }
  #legend i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:.35rem; }
  #help { bottom:12px; left:calc(var(--rail-w) + 12px); padding:7px 11px; font-size:11.5px; color:var(--muted); }
  #help b { color:var(--dim); font-weight:600; }
  @media (max-width:760px) { #legend, #help { display:none; } #hud { width:210px; } }`;

  const legend = tiers.slice().reverse().map(t =>
    `<span><i style="background:${t.accent}"></i>${t.label}</span>`).join('');

  const body = `<canvas id="gl"></canvas>
<div id="hud" class="glass">
  <div>
    <h1>EP Atlas <span class="beta-tag">beta</span></h1>
    <div class="sub">All 1,000,000 numbers as terrain - across is n mod 1000, back is n / 1000,
      up is EP.</div>
    <a class="back" href="/beta">&larr; Beta lab</a>
  </div>
  <label class="ctl"><span>Colour</span>
    <select id="mode">
      <option value="0">Card tier</option>
      <option value="1">Height</option>
      <option value="2">Badges earned</option>
    </select></label>
  <label class="ctl"><span>Height from</span>
    <select id="hsrc">
      <option value="log">EP - log scale</option>
      <option value="lin">EP - linear</option>
      <option value="count">Badges earned</option>
    </select></label>
  <label class="ctl"><span>Detail</span>
    <select id="res">
      <option value="250">250 x 250 - fast</option>
      <option value="500">500 x 500</option>
      <option value="1000" selected>1000 x 1000 - every number</option>
    </select></label>
  <label class="ctl"><span>Exaggeration <em id="exagv">1x</em></span>
    <input id="exag" type="range" min=".25" max="3" step=".05" value="1"></label>
  <label class="chk"><input id="grid" type="checkbox" checked> 100k gridlines</label>
  <div class="row2"><button type="button" id="top">Top down</button>
    <button type="button" id="reset">Reset</button></div>
  <form id="goto"><input id="gn" type="text" inputmode="numeric" placeholder="Fly to number…"
    autocomplete="off"><button type="submit">Go</button></form>
  <div class="ctl"><span>Tallest points</span><div id="peaks"></div></div>
</div>
<div id="read" class="glass"></div>
<div id="legend" class="glass">${legend}</div>
<div id="help" class="glass"><b>Drag</b> to orbit · <b>Shift-drag</b> to pan · <b>Wheel</b> to zoom ·
  <b>Click</b> a point to read it</div>
${overlayHTML('Then lifting the 1000x1000 map into a height field.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(atlasWorker))};
(${atlasClient.toString()})(__W, ${JSON.stringify(tiers)});`;

  return betaShell({
    title: 'RNGdle - EP Atlas', slug: 'atlas', full: true, css, body, script,
    viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
  });
}

// ---------------------------------------------------------------------------
// /beta/economy - what a badge is actually worth.
//
// Plotting EP against how often each badge is earned turns up something the badge
// table alone never shows: the points do not scatter around a trend, they sit ON a
// line of slope exactly -1. Every badge in the game is priced at
//
//   EP = 100 / P(earn)
//
// to within a tenth of a percent - the residual is nothing but EP being rounded to a
// whole number. So every badge, from Pair at 55% to Deep Void (5) at ten in a million,
// is worth exactly 100 EP per roll in expectation. On price alone there are no good
// badges and no bad ones.
//
// Which makes the interesting question the other one: what breaks that symmetry? Only
// supersession does. A badge that loses its family scores nothing, so its real
// expected value is 100 x (times it pays / times it is earned) - and THAT ranges from
// 100 down to zero. Measuring it needs the co-earned set for every single number,
// which is exactly what the sweep has and a per-badge rate does not.
// ---------------------------------------------------------------------------

function economyWorker() {
  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const EP = new Float64Array(ev.data.ep);       // EP per badge
      const FAM = new Int16Array(ev.data.fam);       // badge -> family index, -1 standalone
      const swept = await betaSweep(ev.data.origin, 0.6);
      const bits = swept.bits, ROW = swept.ROW, N = swept.ep.length, B = EP.length;

      const earn = new Float64Array(B);              // numbers that earn it at all
      const score = new Float64Array(B);             // numbers where it actually pays
      const nFam = 1 + FAM.reduce((m, f) => Math.max(m, f), -1);
      const top = new Int32Array(nFam);
      const idx = new Int32Array(256);

      for (let n = 0; n < N; n++) {
        if ((n & 0x3ffff) === 0) {
          self.postMessage({ type: 'progress', pct: 0.6 + 0.4 * (n / N), msg: 'Measuring what each badge really pays…' });
        }
        const k = betaEarned(bits, n * ROW, ROW, idx);
        top.fill(-1);
        for (let a = 0; a < k; a++) {
          const i = idx[a];
          earn[i]++;
          const f = FAM[i];
          if (f < 0) { score[i]++; continue; }
          // Strict >, so the first of an EP tie wins - the same rule compute() uses.
          if (top[f] < 0 || EP[i] > EP[top[f]]) top[f] = i;
        }
        for (let f = 0; f < nFam; f++) if (top[f] >= 0) score[top[f]]++;
      }
      self.postMessage({ type: 'ready', earn: earn.buffer, score: score.buffer, N },
        [earn.buffer, score.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

// META[i] = [label, emoji, ep, tier, familyIndex, id]; PAL = tier -> accent.
function economyClient(WORKER_SRC, META, FAMS, PAL) {
  const B = META.length;
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  const pctf = p => p === 0 ? '0%' : p >= 1 ? p.toFixed(2) + '%' : p >= 0.01 ? p.toFixed(3) + '%' : p.toFixed(4) + '%';

  let EARN = null, SCORE = null, N = 0, FIT = null, ROWS = [];

  // --- chart: the price law ----------------------------------------------
  const W = 720, H = 440, M = { l: 62, r: 18, t: 18, b: 46 };
  const px = v => M.l + (v - FIT.x0) / (FIT.x1 - FIT.x0) * (W - M.l - M.r);
  const py = v => H - M.b - (v - FIT.y0) / (FIT.y1 - FIT.y0) * (H - M.t - M.b);

  function chart() {
    const g = [];
    const xt = [], yt = [];
    for (let e = Math.ceil(FIT.x0); e <= Math.floor(FIT.x1); e++) xt.push(e);
    for (let e = Math.ceil(FIT.y0); e <= Math.floor(FIT.y1); e++) yt.push(e);

    for (const e of xt) {
      const x = px(e);
      // Exactly as many decimals as this decade needs: 1e-6 of the range is 0.0001%,
      // and a fixed precision would print that as either 0.0000% or 1.00000000%.
      const share = (Math.pow(10, e) * 100).toFixed(Math.max(0, -(e + 2)));
      g.push(`<line class="grid" x1="${x}" y1="${M.t}" x2="${x}" y2="${H - M.b}"/>`);
      g.push(`<text class="ax" x="${x}" y="${H - M.b + 16}" text-anchor="middle">${share}%</text>`);
    }
    for (const e of yt) {
      const y = py(e), v = Math.pow(10, e);
      g.push(`<line class="grid" x1="${M.l}" y1="${y}" x2="${W - M.r}" y2="${y}"/>`);
      g.push(`<text class="ax" x="${M.l - 8}" y="${y + 3.5}" text-anchor="end">${
        v >= 1e6 ? (v / 1e6) + 'M' : v >= 1e3 ? (v / 1e3) + 'k' : v}</text>`);
    }

    // No confidence band: the points are ON the line to four figures, so a band wide
    // enough to draw would only imply a scatter that is not there. The linear residual
    // chart below is what shows how tight the fit really is.
    g.push(`<path class="fit" d="M ${px(FIT.x0)} ${py(FIT.a + FIT.b * FIT.x0)} L ${px(FIT.x1)} ${py(FIT.a + FIT.b * FIT.x1)}"/>`);

    const maxShare = Math.max(...ROWS.map(r => r.epShare));
    for (const r of ROWS) {
      const rad = 2.2 + 7 * Math.sqrt(r.epShare / (maxShare || 1));
      g.push(`<circle class="pt${r.score === 0 ? ' dead' : ''}" data-i="${r.i}" cx="${px(r.lx).toFixed(1)}"
        cy="${py(r.ly).toFixed(1)}" r="${rad.toFixed(2)}" fill="${PAL[META[r.i][3]]}"/>`);
    }
    $('chart').innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Badge EP plotted against how often the badge is earned">
        ${g.join('')}
        <text class="axl" x="${M.l + (W - M.l - M.r) / 2}" y="${H - 6}" text-anchor="middle">share of all numbers that earn it</text>
        <text class="axl" transform="translate(14 ${M.t + (H - M.t - M.b) / 2}) rotate(-90)" text-anchor="middle">EP paid</text>
      </svg>`;
  }

  // --- tables ------------------------------------------------------------
  const row = (r, right, sub) => `<a class="erow" href="/badges#${META[r.i][5]}">
    <span class="ee">${META[r.i][1]}</span>
    <span class="el">${META[r.i][0]}${sub ? `<em>${sub}</em>` : ''}</span>
    <span class="ev">${right}</span></a>`;

  // --- chart: the residual, on a linear axis -----------------------------
  //
  // The log-log plot is convincing but forgiving - at that scale a badge could be 30%
  // off the law and still look like it is on the line. This one is the proof: EP x P
  // per badge, on an axis that spans half a percent, with one lane per rarity tier so
  // the points do not pile up.
  function residualChart() {
    const RW = 720, RH = 168, RM = { l: 84, r: 18, t: 14, b: 34 };
    const vals = ROWS.map(r => r.ev);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || 0.1;
    const x0 = lo - pad, x1 = hi + pad;
    const rx = v => RM.l + (v - x0) / (x1 - x0) * (RW - RM.l - RM.r);
    const lanes = ['trash', 'common', 'uncommon', 'rare', 'epic', 'anomaly', 'mythic'];
    const ry = t => RM.t + (lanes.indexOf(t) + 0.5) * ((RH - RM.t - RM.b) / lanes.length);

    // Five ticks across whatever range the data actually spans - which is tiny, so
    // there is no sensible round-number step to pick in advance.
    const g = [], ticks = [];
    for (let k = 0; k <= 4; k++) ticks.push(x0 + k * (x1 - x0) / 4);
    for (const t of ticks) {
      g.push(`<line class="grid" x1="${rx(t).toFixed(1)}" y1="${RM.t}" x2="${rx(t).toFixed(1)}" y2="${RH - RM.b}"/>`);
      g.push(`<text class="ax" x="${rx(t).toFixed(1)}" y="${RH - RM.b + 15}" text-anchor="middle">${t.toFixed(2)}</text>`);
    }
    g.push(`<line class="fit" x1="${rx(100)}" y1="${RM.t}" x2="${rx(100)}" y2="${RH - RM.b}"/>`);
    for (const t of lanes) {
      g.push(`<text class="ax lane" x="${RM.l - 8}" y="${(ry(t) + 3).toFixed(1)}" text-anchor="end">${t}</text>`);
    }
    for (const r of ROWS) {
      g.push(`<circle class="pt" data-i="${r.i}" cx="${rx(r.ev).toFixed(1)}" cy="${ry(META[r.i][3]).toFixed(1)}"
        r="3.2" fill="${PAL[META[r.i][3]]}"/>`);
    }
    $('resid').innerHTML = `<svg viewBox="0 0 ${RW} ${RH}" role="img"
      aria-label="EP times earn rate per badge, all within a fraction of a percent of 100">
      ${g.join('')}
      <text class="axl" x="${RM.l + (RW - RM.l - RM.r) / 2}" y="${RH - 4}" text-anchor="middle">EP x P(earn)</text>
    </svg>`;
  }

  function tables() {
    // Real expected value per roll: the 100 EP the price law promises, discounted by
    // how often a family sibling takes the payout instead.
    // score === 0 is its own card next door, so leave those out here rather than
    // list the same two badges twice.
    const taxed = ROWS.filter(r => r.earn >= 20 && r.score > 0 && r.score < r.earn)
      .sort((a, b) => a.keep - b.keep).slice(0, 14);
    const dead = ROWS.filter(r => r.earn > 0 && r.score === 0).sort((a, b) => b.earn - a.earn);
    const clean = ROWS.filter(r => r.score === r.earn).length;

    // Per family: EP its members earn on paper against EP they are actually paid. A
    // standalone badge can never lose, so the whole 6.3% comes out of these 40 rows.
    const fams = new Map();
    for (const r of ROWS) {
      const f = META[r.i][4];
      if (f < 0) continue;
      const e = fams.get(f) || { f, n: 0, gross: 0, paid: 0 };
      e.n++; e.gross += r.ep * r.earn; e.paid += r.ep * r.score;
      fams.set(f, e);
    }
    const totalLost = [...fams.values()].reduce((s, e) => s + (e.gross - e.paid), 0);
    const worst = [...fams.values()].sort((a, b) => (b.gross - b.paid) - (a.gross - a.paid)).slice(0, 12);
    const topLost = worst.length ? worst[0].gross - worst[0].paid : 1;
    $('families').innerHTML = worst.map(e => {
      const lost = e.gross - e.paid;
      return `<div class="frow">
        <span class="fl">${FAMS[e.f]}<em>${e.n} badges · ${(100 * e.paid / e.gross).toFixed(1)}% of their EP survives</em></span>
        <span class="fbar"><i style="width:${(100 * lost / topLost).toFixed(2)}%"></i></span>
        <span class="fv">${(100 * lost / totalLost).toFixed(1)}%</span></div>`;
    }).join('');

    $('taxed').innerHTML = taxed.map(r => row(r,
      (100 * r.keep).toFixed(1) + ' EP',
      `${(100 * r.keep).toFixed(1)}% of the time it is the family's top badge`)).join('') ||
      '<p class="muted small">No badge ever loses its family.</p>';
    $('dead').innerHTML = dead.length
      ? dead.map(r => row(r, fmt(r.earn) + ' wasted', `${FAMS[META[r.i][4]]} family - outranked every time`)).join('')
      : '<p class="muted small">None - every badge is the top scorer of its family somewhere.</p>';
    $('deadn').textContent = dead.length;
    $('cleann').textContent = clean;
  }

  function stats(totalEP) {
    const dead = ROWS.filter(r => r.earn > 0 && r.score === 0).length;
    const evs = ROWS.map(r => r.ev).sort((a, b) => a - b);
    const spread = evs[evs.length - 1] - evs[0];
    const mean = totalEP / N;
    // What a roll would be worth if every earned badge paid - i.e. with families
    // switched off. The gap between that and the measured mean is the whole cost.
    const gross = ROWS.reduce((s, r) => s + r.ep * r.earn, 0) / N;
    $('stats').innerHTML = `
      <div class="stat stat-lg"><span class="k">EP x P(earn)</span><span class="v">${evs[evs.length >> 1].toFixed(2)}</span>
        <span class="sub">for all ${B} badges, spread of ${spread.toFixed(2)} EP end to end</span></div>
      <div class="stat stat-lg"><span class="k">Mean EP per roll</span><span class="v">${fmt(mean)}</span>
        <span class="sub">measured over all ${fmt(N)} rolls</span></div>
      <div class="stat stat-lg"><span class="k">Lost to supersession</span><span class="v">${
        (100 * (1 - mean / gross)).toFixed(1)}%</span>
        <span class="sub">of the ${fmt(gross)} EP a roll earns on paper</span></div>
      <div class="stat stat-lg"><span class="k">Never pay out</span><span class="v">${dead}</span>
        <span class="sub">earned, but superseded every time</span></div>`;
  }

  // --- tooltip -----------------------------------------------------------
  const tip = $('tip');
  $('chart').addEventListener('mouseover', e => {
    const c = e.target.closest('[data-i]');
    if (!c) return;
    const r = ROWS[ROWS.findIndex(x => x.i === Number(c.dataset.i))];
    const m = META[r.i];
    tip.innerHTML = `<b>${m[1]} ${m[0]}</b>
      <span>${fmt(m[2])} EP · earned by ${pctf(100 * r.earn / N)} of numbers</span>
      <span>EP x P = ${r.ev.toFixed(2)}</span>
      <span>${r.score === 0 ? 'never pays - always superseded'
        : `pays on ${(100 * r.keep).toFixed(1)}% of its earns · ${(100 * r.epShare).toFixed(2)}% of all EP`}</span>`;
    tip.style.display = 'block';
    const b = c.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, b.left) + 'px';
    tip.style.top = Math.max(8, b.top - tip.offsetHeight - 8) + 'px';
  });
  $('chart').addEventListener('mouseout', e => {
    if (e.target.closest('[data-i]')) tip.style.display = 'none';
  });

  // --- boot --------------------------------------------------------------
  const ep = Float64Array.from(META, m => m[2]);
  const fam = Int16Array.from(META, m => m[4]);
  betaBoot(WORKER_SRC, null, { ep: ep.buffer, fam: fam.buffer }).then(({ data }) => {
    EARN = new Float64Array(data.earn); SCORE = new Float64Array(data.score); N = data.N;

    let totalEP = 0;
    for (let i = 0; i < B; i++) totalEP += SCORE[i] * META[i][2];

    ROWS = [];
    for (let i = 0; i < B; i++) {
      if (!EARN[i]) continue;                      // no data point without a rate
      const ep = META[i][2];
      ROWS.push({
        i, ep, earn: EARN[i], score: SCORE[i],
        ev: ep * (EARN[i] / N),                    // the price law's constant, per badge
        keep: SCORE[i] / EARN[i],                  // share of earns that actually pay
        lx: Math.log10(EARN[i] / N), ly: Math.log10(Math.max(1, ep)),
        epShare: totalEP ? (SCORE[i] * ep) / totalEP : 0,
      });
    }

    // Least squares on (log rate, log EP). The law it recovers is EP = 100 / P, but
    // fitting rather than asserting it means the page still reads correctly - and
    // visibly stops saying "law" - if the game ever rebalances away from it.
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const r of ROWS) { sx += r.lx; sy += r.ly; sxy += r.lx * r.ly; sxx += r.lx * r.lx; }
    const n = ROWS.length, b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    for (const r of ROWS) r.resid = r.ly - (a + b * r.lx);

    const xs = ROWS.map(r => r.lx), ys = ROWS.map(r => r.ly);
    FIT = { a, b, x0: Math.floor(Math.min(...xs)), x1: Math.ceil(Math.max(...xs)),
      y0: Math.floor(Math.min(...ys)), y1: Math.ceil(Math.max(...ys)) };

    $('slope').textContent = b.toFixed(3);
    $('konst').textContent = Math.pow(10, a).toFixed(1);
    chart(); residualChart(); tables(); stats(totalEP);
    $('report').classList.add('on');
  });
}

function renderEconomy(ctx) {
  const { BADGES, FAMILIES, FAMILY_NAMES, TIER_PALETTE, tierFromScore } = ctx;
  const famOf = new Map();
  FAMILIES.forEach((fam, fi) => { for (const id of fam) famOf.set(id, fi); });
  const meta = BADGES.map(([id, label, emoji, ep]) =>
    [label, emoji, ep, tierFromScore(ep), famOf.has(id) ? famOf.get(id) : -1, id]);
  const pal = Object.fromEntries(Object.entries(TIER_PALETTE).map(([k, v]) => [k, v.accent]));

  const css = `
  #report { display:none; }
  #report.on { display:block; }
  #stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(190px,100%),1fr)); gap:.6rem; margin-bottom:1.2rem; }

  .chartcard { padding:1rem 1.1rem 1.2rem; margin-bottom:1.2rem; }
  #chart svg { width:100%; height:auto; display:block; }
  .grid { stroke:var(--border); stroke-width:1; }
  .ax { fill:var(--faint); font-size:10px; font-family:var(--mono); }
  .axl { fill:var(--muted); font-size:11px; }
  .fit { stroke:var(--hl); stroke-width:1.4; stroke-dasharray:5 4; fill:none; }
  .band { fill:color-mix(in srgb, var(--hl) 7%, transparent); stroke:none; }
  .pt { cursor:pointer; fill-opacity:.85; stroke:#08090c; stroke-width:.6; }
  .pt:hover { fill-opacity:1; stroke:var(--text); stroke-width:1.2; }
  .pt.dead { fill-opacity:.18; stroke:var(--faint); stroke-width:1; }
  .ax.lane { font-family:var(--font); font-size:9.5px; letter-spacing:.05em; text-transform:uppercase; }
  .chart-note { margin:.7rem 0 0; font-size:.8rem; color:var(--muted); line-height:1.6; }
  .chart-note b { color:var(--dim); font-weight:600; }
  .swatch { display:inline-block; width:22px; border-top:1.4px dashed var(--hl); vertical-align:.25em; }

  .grid2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(330px,100%),1fr)); gap:.8rem; margin-bottom:.8rem; }
  .card > p.small { margin:-.35rem 0 .7rem; font-size:.78rem; color:var(--muted); line-height:1.55; }
  .erow { display:flex; align-items:center; gap:.55rem; padding:.34rem .3rem; text-decoration:none;
    border-radius:var(--r-sm); color:var(--dim); }
  .erow:hover { background:var(--surface-2); color:var(--text); }
  .erow .ee { flex:0 0 auto; }
  .erow .el { flex:1; min-width:0; font-size:.85rem; display:flex; flex-direction:column; }
  .erow .el em { font-style:normal; font-size:.72rem; color:var(--faint); font-family:var(--mono); }
  .erow .ev { flex:0 0 auto; font-family:var(--mono); font-size:.78rem; color:var(--hl-lt);
    font-variant-numeric:tabular-nums; }

  .frow { display:flex; align-items:center; gap:.7rem; padding:.32rem .3rem; }
  .frow .fl { flex:0 0 250px; min-width:0; font-size:.85rem; display:flex; flex-direction:column; color:var(--dim); }
  .frow .fl em { font-style:normal; font-size:.72rem; color:var(--faint); }
  .frow .fbar { flex:1; min-width:40px; height:8px; border-radius:var(--r-pill); background:var(--surface-2); overflow:hidden; }
  .frow .fbar i { display:block; height:100%; background:var(--hl); }
  .frow .fv { flex:0 0 auto; width:3.2rem; text-align:right; font-family:var(--mono); font-size:.78rem;
    color:var(--hl-lt); font-variant-numeric:tabular-nums; }
  @media (max-width:620px) { .frow .fl { flex-basis:150px; } }

  #tip { position:fixed; z-index:20; display:none; pointer-events:none; padding:.5rem .65rem; max-width:20rem;
    background:#06070a; border:1px solid var(--border-2); border-radius:var(--r-ctl); font-size:.78rem;
    box-shadow:0 10px 30px rgba(0,0,0,.6); }
  #tip b { display:block; font-size:.84rem; margin-bottom:.15rem; }
  #tip span { display:block; color:var(--muted); font-size:.74rem; line-height:1.5; }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Badge Economy <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">Every badge is priced at exactly 100 / its own odds - so what makes one worth more
    than another?</p>

  <div id="report">
    <div id="stats"></div>

    <section class="card chartcard">
      <h2>Price against rarity</h2>
      <div id="chart"></div>
      <p class="chart-note">Every badge, plotted by how often it is earned against what it pays; both axes
        logarithmic. The points do not scatter around the <span class="swatch"></span> line, they sit on it.
        The slope is <b id="slope">-</b> and the intercept <b id="konst">-</b>, which is to say every badge is
        priced at <b>EP = 100 / P(earn)</b>. Point size is the badge's share of all EP ever awarded; hollow
        points never pay out at all. Click any point for its rule.</p>
    </section>

    <section class="card chartcard">
      <h2>How exact is that?</h2>
      <div id="resid"></div>
      <p class="chart-note">The same 230 badges, but now each one's <b>EP x P(earn)</b> on a linear axis
        spanning a fraction of a percent, split into lanes by rarity. Every badge in the game lands on
        100.00, and what little spread there is comes from EP being rounded to a whole number.
        <b>So no badge is worth more than any other per roll</b> - a mythic is exactly as valuable as
        a common, it just arrives a hundred thousand times less often.</p>
    </section>

    <div class="grid2">
      <section class="card"><h2>What actually varies <em>supersession</em></h2>
        <p class="small">The one thing that breaks the flat 100 EP: within a family only the
          highest-EP earned badge scores. These are earned constantly and paid rarely, so their real
          expected value per roll is well under 100 EP. <span id="cleann">-</span> badges are never
          superseded and keep the full 100.</p>
        <div id="taxed"></div></section>
      <section class="card"><h2>Never pay out <em>(<span id="deadn">-</span>)</em></h2>
        <p class="small">Earned somewhere in the range, yet outranked by a family sibling on every single
          number that earns them. Worth exactly nothing: they can be collected, never scored.</p>
        <div id="dead"></div></section>
    </div>

    <section class="card"><h2>Which families cost the most</h2>
      <p class="small">Supersession only bites inside a family, so the entire shortfall comes out of these
        40 groups - the other 69 badges are standalone and always keep their 100 EP. Share of all EP
        earned-but-never-paid, by family.</p>
      <div id="families"></div></section>
  </div>

  <div id="tip"></div>
  <footer>
    The <b>price law</b> is not assumed - the line is a least-squares fit of log EP against log earn-rate
    over all 230 badges, and it recovers slope -1 and constant 100 on its own. <b>Earn</b> and
    <b>score</b> counts both come from the live sweep: a badge is earned when its rule matches, and
    scores only when it wins its family, so a rebalance would show up here immediately.
  </footer>
</div>
${overlayHTML('Then re-running family supersession on every number to see which badges actually pay.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(economyWorker))};
(${economyClient.toString()})(__W, ${JSON.stringify(meta)}, ${JSON.stringify(FAMILY_NAMES)}, ${JSON.stringify(pal)});`;

  return betaShell({ title: 'RNGdle - Badge Economy', width: '1000px', slug: 'economy', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/spectrum - every badge as a density stripe across the range.
//
// One row per badge, one column per block of 1,000 numbers, brightness = how many of
// that block earn it. Laid out together the rules sort themselves into visible kinds:
// digit-length rules step at 10, 100, 1,000...; "contains" rules give even wash;
// last-digit and modular rules give fine vertical banding; and the exact-value badges
// are a single lit pixel in 230,000.
//
// Per-badge stripes are cheap (one pass, no pair loop), so the sweep dominates and the
// whole thing lands about as fast as the cache can hand the sweep over.
// ---------------------------------------------------------------------------

function spectrumWorker() {
  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const BLK = 1000;                            // columns; each covers 1,000 numbers
      const swept = await betaSweep(ev.data.origin, 0.75);
      const bits = swept.bits, ROW = swept.ROW, N = swept.ep.length;
      const B = E.BADGE_META.length;

      const dens = new Uint32Array(B * BLK);
      const first = new Int32Array(B).fill(-1);
      const last = new Int32Array(B).fill(-1);
      const gap = new Int32Array(B);               // longest run of non-earners
      const byLen = new Uint32Array(B * 7);        // earners per digit length, 1..7
      const idx = new Int32Array(256);

      for (let n = 0; n < N; n++) {
        if ((n & 0x3ffff) === 0) {
          self.postMessage({ type: 'progress', pct: 0.75 + 0.25 * (n / N), msg: 'Building the stripes…' });
        }
        const k = betaEarned(bits, n * ROW, ROW, idx);
        const col = Math.min(BLK - 1, (n / 1000) | 0);
        const len = n === 0 ? 1 : Math.floor(Math.log10(n)) + 1;
        for (let a = 0; a < k; a++) {
          const i = idx[a];
          dens[i * BLK + col]++;
          byLen[i * 7 + (len - 1)]++;
          if (first[i] < 0) first[i] = n;
          else if (n - last[i] - 1 > gap[i]) gap[i] = n - last[i] - 1;
          last[i] = n;
        }
      }
      // A trailing run counts too: a badge whose last earner is early has a huge gap
      // to the end of the range, and that is exactly the interesting case.
      for (let i = 0; i < B; i++) if (last[i] >= 0 && N - 1 - last[i] > gap[i]) gap[i] = N - 1 - last[i];

      self.postMessage({ type: 'ready', dens: dens.buffer, first: first.buffer, last: last.buffer,
        gap: gap.buffer, byLen: byLen.buffer, B, BLK, N },
        [dens.buffer, first.buffer, last.buffer, gap.buffer, byLen.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

// META[i] = [label, emoji, ep, tier, familyIndex, id]
function spectrumClient(WORKER_SRC, META, FAMS, PAL) {
  const B = META.length;
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString();
  const pctf = p => p === 0 ? '0%' : p >= 1 ? p.toFixed(2) + '%' : p >= 0.01 ? p.toFixed(3) + '%' : p.toFixed(4) + '%';

  let D = null, FIRST = null, LAST = null, GAP = null, BYLEN = null, BLK = 1000, N = 0;
  let order = [], rowMax = null, total = null, sel = -1, hover = -1;
  let norm = 'row', sort = 'family';

  const cv = $('spec'), ctx = cv.getContext('2d');
  const off = document.createElement('canvas');
  const RH = 4;                                   // on-screen pixels per badge row

  // --- derived per-badge measures ----------------------------------------
  // Normalised entropy of the block distribution: 1 = spread evenly over the whole
  // range, 0 = every earner in one block. The single most useful sort here, because it
  // separates "rule that fires everywhere" from "rule that fires in one place".
  function spread(i) {
    const base = i * BLK, t = total[i];
    if (!t) return 0;
    let h = 0;
    for (let c = 0; c < BLK; c++) {
      const p = D[base + c] / t;
      if (p > 0) h -= p * Math.log(p);
    }
    return h / Math.log(BLK);
  }

  function reorder() {
    const all = Array.from({ length: B }, (_, i) => i);
    if (sort === 'ep') order = all.sort((a, b) => META[b][2] - META[a][2] || a - b);
    else if (sort === 'rate') order = all.sort((a, b) => total[b] - total[a] || a - b);
    else if (sort === 'spread') order = all.sort((a, b) => SPREAD[b] - SPREAD[a] || a - b);
    else if (sort === 'first') order = all.sort((a, b) => (FIRST[a] < 0 ? 2e9 : FIRST[a]) - (FIRST[b] < 0 ? 2e9 : FIRST[b]));
    else if (sort === 'alpha') order = all.sort((a, b) => META[a][0].localeCompare(META[b][0]));
    else order = all.sort((a, b) => {
      const fa = META[a][4] < 0 ? 999 : META[a][4], fb = META[b][4] < 0 ? 999 : META[b][4];
      return fa - fb || META[b][2] - META[a][2] || a - b;
    });
    draw();
  }
  let SPREAD = null;

  // --- drawing -----------------------------------------------------------
  function draw() {
    if (!D) return;
    const w = BLK, h = B;
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    const img = octx.createImageData(w, h);
    const px = img.data;
    for (let r = 0; r < B; r++) {
      const i = order[r], base = i * BLK;
      const cap = norm === 'row' ? (rowMax[i] || 1) : 1000;
      for (let c = 0; c < w; c++) {
        const v = D[base + c];
        const k = (r * w + c) * 4;
        if (!v) { px[k] = 10; px[k + 1] = 11; px[k + 2] = 15; px[k + 3] = 255; continue; }
        // log within the row's own range: a stripe that runs 1..3 per block and one
        // that runs 1..900 both need to show their shape, not just their level.
        const t = Math.log1p(v) / Math.log1p(cap);
        const rgb = ramp(t);
        px[k] = rgb[0]; px[k + 1] = rgb[1]; px[k + 2] = rgb[2]; px[k + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);

    const gut = 12;                                // family colour gutter on the left
    // The floor is only for the not-yet-laid-out case (clientWidth 0, where a canvas
    // silently keeps its 300px default instead of erroring) - a real narrow
    // measurement has to win, or the canvas widens the page on a phone.
    const measured = cv.parentElement.clientWidth - 2;
    const cw = measured > 40 ? measured : 280;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = cw + 'px'; cv.style.height = (B * RH) + 'px';
    cv.width = cw * dpr; cv.height = B * RH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0b0f'; ctx.fillRect(0, 0, cw, B * RH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, w, h, gut, 0, cw - gut, B * RH);
    for (let r = 0; r < B; r++) {
      ctx.fillStyle = META[order[r]][4] < 0 ? '#2a2d36' : `hsl(${(META[order[r]][4] * 47) % 360} 45% ${META[order[r]][4] % 2 ? 42 : 56}%)`;
      ctx.fillRect(0, r * RH, gut - 3, RH);
    }
    const mark = (b, colour, wdt) => {
      const r = order.indexOf(b);
      if (r < 0) return;
      ctx.strokeStyle = colour; ctx.lineWidth = wdt;
      ctx.strokeRect(gut - .5, r * RH - .5, cw - gut + 1, RH + 1);
    };
    if (hover >= 0 && hover !== sel) mark(hover, 'rgba(255,255,255,.35)', 1);
    if (sel >= 0) mark(sel, '#e8924e', 1.4);
  }

  const STOPS = [[10, 11, 15], [24, 33, 58], [40, 84, 130], [92, 148, 214], [193, 212, 245], [255, 250, 238]];
  function ramp(t) {
    t = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const x = t * (STOPS.length - 1), i = Math.min(STOPS.length - 2, x | 0), f = x - i;
    const a = STOPS[i], b = STOPS[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  // --- detail panel ------------------------------------------------------
  function detail(i) {
    const box = $('detail');
    if (i < 0) {
      box.innerHTML = `<div class="card"><h2>Pick a stripe</h2>
        <p class="muted small">Hover any row for its name, click for where in the range it fires,
        how it splits by digit length, and the longest stretch of numbers that never earn it.</p></div>`;
      return;
    }
    const m = META[i], base = i * BLK, t = total[i];
    const lens = [];
    for (let L = 0; L < 7; L++) {
      const c = BYLEN[i * 7 + L];
      if (!c) continue;
      // Numbers with exactly L+1 digits in 0..1,000,000: 10^L .. 10^(L+1)-1, except
      // length 1 which includes 0, and length 7 which is the single 1,000,000.
      const pool = L === 0 ? 10 : L === 6 ? 1 : 9 * Math.pow(10, L);
      lens.push({ L: L + 1, c, share: c / pool });
    }
    const maxShare = Math.max(...lens.map(x => x.share), 1e-9);

    // The stripe again, but as a profile the eye can read a shape off.
    const W = 520, H = 90;
    const cap = rowMax[i] || 1;
    const pts = [];
    for (let c = 0; c < BLK; c++) {
      pts.push(`${(c / (BLK - 1) * W).toFixed(1)},${(H - (D[base + c] / cap) * H).toFixed(1)}`);
    }

    box.innerHTML = `
      <div class="card" style="--tc:${PAL[m[3]]}">
        <div class="dh"><span class="de">${m[1]}</span>
          <div class="dn"><b>${m[0]}</b><span>${m[4] >= 0 ? FAMS[m[4]] + ' family' : 'standalone'}</span></div>
          <span class="pill">${m[3].toUpperCase()}</span></div>
        <svg class="prof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="${pts.join(' ')}"/></svg>
        <div class="pxax"><span>0</span><span>500,000</span><span>1,000,000</span></div>
        <div class="dstats">
          <div class="stat"><span class="k">Earned by</span><span class="v">${pctf(100 * t / N)}</span>
            <span class="sub">${fmt(t)} numbers</span></div>
          <div class="stat"><span class="k">Spread</span><span class="v">${(SPREAD[i] * 100).toFixed(0)}%</span>
            <span class="sub">of an even wash</span></div>
          <div class="stat"><span class="k">Longest gap</span><span class="v">${fmt(GAP[i])}</span>
            <span class="sub">with none in a row</span></div>
        </div>
        <div class="drange">First <a href="/?n=${FIRST[i]}">${fmt(FIRST[i])}</a> ·
          last <a href="/?n=${LAST[i]}">${fmt(LAST[i])}</a> ·
          <a href="/grid#${encodeURIComponent(m[0])}">map on /grid</a> ·
          <a href="/badges#${m[5]}">rule</a></div>
      </div>
      <div class="card"><h2>By digit length</h2>
        <p class="muted small">Share of all numbers of each length that earn it - which is where the
          hard steps in the stripe come from.</p>
        ${lens.map(x => `<div class="lrow">
          <span class="ll">${x.L} digit${x.L === 1 ? '' : 's'}</span>
          <span class="lbar"><i style="width:${(100 * x.share / maxShare).toFixed(2)}%"></i></span>
          <span class="lv">${pctf(100 * x.share)}</span></div>`).join('')}
      </div>`;
  }

  // --- events ------------------------------------------------------------
  function rowAt(ev) {
    const r = cv.getBoundingClientRect();
    const row = Math.floor((ev.clientY - r.top) / RH);
    return row >= 0 && row < B ? order[row] : -1;
  }
  const tip = $('tip');
  cv.addEventListener('mousemove', ev => {
    const i = rowAt(ev);
    if (i !== hover) { hover = i; draw(); }
    if (i < 0) { tip.style.display = 'none'; return; }
    const r = cv.getBoundingClientRect();
    const gut = 12, cw = r.width;
    const col = Math.max(0, Math.min(BLK - 1, Math.floor((ev.clientX - r.left - gut) / (cw - gut) * BLK)));
    const lo = col * 1000;
    tip.innerHTML = `<b>${META[i][1]} ${META[i][0]}</b>
      <span>${fmt(D[i * BLK + col])} of the 1,000 numbers ${fmt(lo)}-${fmt(lo + 999)}</span>
      <span>${pctf(100 * total[i] / N)} of the range overall</span>`;
    tip.style.display = 'block';
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, ev.clientX + 14) + 'px';
    tip.style.top = Math.max(8, ev.clientY - tip.offsetHeight - 12) + 'px';
  });
  cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; hover = -1; draw(); });
  cv.addEventListener('click', ev => { sel = rowAt(ev); detail(sel); draw(); });
  $('sort').addEventListener('change', e => { sort = e.target.value; reorder(); });
  $('norm').addEventListener('change', e => { norm = e.target.value; draw(); });
  addEventListener('resize', draw);

  // --- boot --------------------------------------------------------------
  betaBoot(WORKER_SRC).then(({ data }) => {
    D = new Uint32Array(data.dens); FIRST = new Int32Array(data.first);
    LAST = new Int32Array(data.last); GAP = new Int32Array(data.gap);
    BYLEN = new Uint32Array(data.byLen); BLK = data.BLK; N = data.N;

    rowMax = new Uint32Array(B); total = new Float64Array(B);
    for (let i = 0; i < B; i++) {
      let mx = 0, t = 0;
      for (let c = 0; c < BLK; c++) { const v = D[i * BLK + c]; t += v; if (v > mx) mx = v; }
      rowMax[i] = mx; total[i] = t;
    }
    SPREAD = new Float64Array(B);
    for (let i = 0; i < B; i++) SPREAD[i] = spread(i);
    $('page').classList.add('on');                 // must be visible before draw() measures
    reorder(); detail(-1);
  });
}

function renderSpectrum(ctx) {
  const { BADGES, FAMILIES, FAMILY_NAMES, TIER_PALETTE, tierFromScore } = ctx;
  const famOf = new Map();
  FAMILIES.forEach((fam, fi) => { for (const id of fam) famOf.set(id, fi); });
  const meta = BADGES.map(([id, label, emoji, ep]) =>
    [label, emoji, ep, tierFromScore(ep), famOf.has(id) ? famOf.get(id) : -1, id]);
  const pal = Object.fromEntries(Object.entries(TIER_PALETTE).map(([k, v]) => [k, v.accent]));

  const css = `
  #page { display:none; }
  #page.on { display:block; }
  .bar { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-bottom:.9rem; }
  .bar label { font-size:.78rem; color:var(--muted); }
  .bar select { font-size:.85rem; padding:.4rem .5rem; }

  .cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,330px); gap:1rem; align-items:start; }
  @media (max-width:1000px) { .cols { grid-template-columns:minmax(0,1fr); } }
  .speccard { padding:.7rem; position:relative; }
  #spec { display:block; cursor:crosshair; border-radius:var(--r-sm); }
  .xax { display:flex; justify-content:space-between; margin:.4rem 0 0 12px; font-size:.7rem;
    color:var(--faint); font-family:var(--mono); }

  /* min-width:0 on the column and minmax(0,1fr) on the stat row: without both, a long
     stat caption sets a min-content floor that widens the whole grid track. */
  #detail { min-width:0; display:flex; flex-direction:column; gap:.7rem; position:sticky; top:1rem; }
  .dh { display:flex; align-items:center; gap:.55rem; margin-bottom:.6rem; }
  .de { font-size:1.3rem; }
  .dn { flex:1; min-width:0; display:flex; flex-direction:column; }
  .dn b { font-size:1rem; font-weight:600; }
  .dn span { font-size:.74rem; color:var(--muted); }
  .prof { width:100%; height:90px; display:block; background:var(--surface-2); border-radius:var(--r-sm);
    border:1px solid var(--border); }
  .prof polyline { fill:none; stroke:var(--accent); stroke-width:1.2; vector-effect:non-scaling-stroke; }
  .pxax { display:flex; justify-content:space-between; margin:.25rem 0 .7rem; font-size:.68rem;
    color:var(--faint); font-family:var(--mono); }
  .dstats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.4rem; }
  .dstats .stat { min-width:0; overflow-wrap:anywhere; }
  .drange { margin-top:.7rem; font-size:.78rem; color:var(--muted); line-height:1.7; }
  .small { font-size:.78rem; line-height:1.5; margin:-.35rem 0 .6rem; }

  .lrow { display:flex; align-items:center; gap:.6rem; padding:.22rem 0; }
  .lrow .ll { flex:0 0 4.6rem; font-size:.8rem; color:var(--dim); }
  .lrow .lbar { flex:1; height:8px; border-radius:var(--r-pill); background:var(--surface-2); overflow:hidden; }
  .lrow .lbar i { display:block; height:100%; background:var(--accent); }
  .lrow .lv { flex:0 0 4.4rem; text-align:right; font-family:var(--mono); font-size:.74rem;
    color:var(--muted); font-variant-numeric:tabular-nums; }

  #tip { position:fixed; z-index:20; display:none; pointer-events:none; padding:.45rem .6rem;
    background:#06070a; border:1px solid var(--border-2); border-radius:var(--r-ctl); font-size:.78rem;
    box-shadow:0 10px 30px rgba(0,0,0,.6); }
  #tip b { display:block; font-size:.84rem; font-weight:600; }
  #tip span { display:block; color:var(--muted); font-size:.74rem; margin-top:.15rem;
    font-variant-numeric:tabular-nums; }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Badge Spectrum <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">All 230 badges at once: one row each, one column per thousand numbers, brightness for
    how many of them earn it.</p>

  <div id="page">
    <div class="bar">
      <label for="sort">Order</label>
      <select id="sort">
        <option value="family">Family</option>
        <option value="spread">Spread - even wash first</option>
        <option value="rate">How often earned</option>
        <option value="first">First earner</option>
        <option value="ep">EP</option>
        <option value="alpha">Name</option>
      </select>
      <label for="norm">Brightness</label>
      <select id="norm">
        <option value="row">Per badge - each row uses its own range</option>
        <option value="abs">Absolute - comparable between rows</option>
      </select>
    </div>

    <div class="cols">
      <section class="card speccard">
        <canvas id="spec" aria-label="230 badge density stripes across the number range"></canvas>
        <div class="xax"><span>0</span><span>250,000</span><span>500,000</span><span>750,000</span><span>1,000,000</span></div>
      </section>
      <div id="detail"></div>
    </div>
  </div>

  <div id="tip"></div>
  <footer>
    <b>Per badge</b> brightness rescales every row to its own busiest block, so a rule earned ten times
    in the whole range still shows its shape; <b>absolute</b> puts every row on the same scale, which
    makes the common badges glow and the rare ones vanish. <b>Spread</b> is the entropy of a badge's
    block distribution as a fraction of a perfectly even wash - 100% means it fires uniformly across the
    range, and a low number means it is concentrated somewhere. The colour gutter down the left edge is
    the badge's family.
  </footer>
</div>
${overlayHTML('Then counting, for each badge, how many of every thousand numbers earn it.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(spectrumWorker))};
(${spectrumClient.toString()})(__W, ${JSON.stringify(meta)}, ${JSON.stringify(FAMILY_NAMES)}, ${JSON.stringify(pal)});`;

  return betaShell({ title: 'RNGdle - Badge Spectrum', width: '1180px', slug: 'spectrum', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/oracle - which digit, in which position, is actually worth anything.
//
// Every other tool here looks at badges. This one looks at the digits, and asks the
// question a player actually has: with the number half-known, what is the rest worth?
//
// Fix any digits you like and the worker rescans the 900,000 six-digit numbers that
// still match, reporting the mean EP behind every remaining choice. Locking a digit
// re-runs it against the survivors, so the board is always conditional on what is
// already known - which is where the surprises are, because a digit that is worth
// nothing on its own can be worth a great deal next to the right neighbour.
//
// Six-digit numbers only (100,000-999,999). They are 90% of the range, and mixing in
// the shorter ones would mean a fixed leading 0 silently changing the rules that apply.
// ---------------------------------------------------------------------------

function oracleWorker() {
  const LO = 100000, HI = 999999;
  const DIV = [100000, 10000, 1000, 100, 10, 1];
  const HB = 48;                                  // histogram bins, log EP
  let EP = null, CNT = null, lgMax = 1, p99 = 0;

  function query(fix) {
    // Per (position, digit) accumulators for the six positions still free, plus the
    // overall stats for whatever is left after the fixed digits are applied.
    const cN = new Float64Array(60), cEP = new Float64Array(60), cTop = new Float64Array(60);
    const hist = new Float64Array(HB);
    let count = 0, sumEP = 0, sumC = 0, nTop = 0;
    let best = -1, bestEP = -1, worst = -1, worstEP = Infinity;
    const tops = [];

    for (let n = LO; n <= HI; n++) {
      let ok = true;
      for (let p = 0; p < 6; p++) {
        if (fix[p] >= 0 && ((n / DIV[p]) | 0) % 10 !== fix[p]) { ok = false; break; }
      }
      if (!ok) continue;
      const e = EP[n];
      count++; sumEP += e; sumC += CNT[n];
      const isTop = e >= p99;
      if (isTop) nTop++;
      if (e > bestEP) { bestEP = e; best = n; }
      if (e < worstEP) { worstEP = e; worst = n; }
      hist[Math.min(HB - 1, (Math.log10(1 + e) / lgMax * HB) | 0)]++;
      for (let p = 0; p < 6; p++) {
        if (fix[p] >= 0) continue;
        const k = p * 10 + ((n / DIV[p]) | 0) % 10;
        cN[k]++; cEP[k] += e; if (isTop) cTop[k]++;
      }
      if (tops.length < 5 || e > tops[tops.length - 1][1]) {
        tops.push([n, e]);
        tops.sort((a, b) => b[1] - a[1]);
        if (tops.length > 5) tops.length = 5;
      }
    }
    return { type: 'q', fix, count, meanEP: count ? sumEP / count : 0, meanC: count ? sumC / count : 0,
      pTop: count ? nTop / count : 0, best, bestEP, worst, worstEP, tops,
      cN: cN.buffer, cEP: cEP.buffer, cTop: cTop.buffer, hist: hist.buffer };
  }

  self.onmessage = async ev => {
    const m = ev.data;
    if (m.cmd === 'init') {
      try {
        const swept = await betaSweep(m.origin, 0.85);
        EP = swept.ep; CNT = swept.cnt;
        self.postMessage({ type: 'progress', pct: 0.9, msg: 'Ranking the six-digit numbers…' });
        let max = 0;
        for (let n = LO; n <= HI; n++) if (EP[n] > max) max = EP[n];
        lgMax = Math.log10(1 + max);
        // The "top 1%" cutoff every cell is scored against, over six-digit numbers only.
        const sorted = Float64Array.from(EP.subarray(LO, HI + 1)).sort();
        p99 = sorted[Math.floor(sorted.length * 0.99)];
        const q = query([-1, -1, -1, -1, -1, -1]);
        self.postMessage(Object.assign({}, q, { type: 'ready', p99, max, HB }),
          [q.cN, q.cEP, q.cTop, q.hist]);
      } catch (e) {
        self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
      }
      return;
    }
    if (m.cmd === 'query') {
      const q = query(m.fix);
      self.postMessage(q, [q.cN, q.cEP, q.cTop, q.hist]);
    }
  };
}

function oracleClient(WORKER_SRC, TIERS) {
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  // EP runs to nine figures at the top of the range and a stat tile is 150px wide.
  const compact = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
    : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : fmt(n);
  let W = null, fix = [-1, -1, -1, -1, -1, -1], Q = null, P99 = 0, HB = 48, busy = false;
  let metric = 'ep';

  const METRICS = {
    ep: { label: 'mean EP', val: (ep, n, t) => n ? ep / n : 0, fmt: v => fmt(v) },
    top: { label: 'chance of a top 1% number', val: (ep, n, t) => n ? t / n : 0, fmt: v => (v * 100).toFixed(2) + '%' },
  };

  const RAMP = [[16, 18, 24], [30, 44, 74], [46, 96, 150], [104, 160, 224], [200, 220, 250], [255, 250, 238]];
  function ramp(t) {
    t = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const x = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, x | 0), f = x - i;
    const a = RAMP[i], b = RAMP[i + 1];
    return `rgb(${(a[0] + (b[0] - a[0]) * f) | 0},${(a[1] + (b[1] - a[1]) * f) | 0},${(a[2] + (b[2] - a[2]) * f) | 0})`;
  }

  // --- board -------------------------------------------------------------
  function board() {
    const M = METRICS[metric];
    const cN = new Float64Array(Q.cN), cEP = new Float64Array(Q.cEP), cTop = new Float64Array(Q.cTop);
    // One shared colour scale over every live cell, so a column's colours mean the
    // same thing as its neighbour's - the comparison across positions is the point.
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 60; k++) {
      if (fix[(k / 10) | 0] >= 0 || !cN[k]) continue;
      const v = M.val(cEP[k], cN[k], cTop[k]);
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    const span = hi - lo || 1;

    const cols = [];
    for (let p = 0; p < 6; p++) {
      const cells = [];
      for (let d = 0; d < 10; d++) {
        if (p === 0 && d === 0) { cells.push('<div class="cell off" aria-hidden="true"></div>'); continue; }
        const k = p * 10 + d;
        if (fix[p] >= 0) {
          cells.push(`<div class="cell ${fix[p] === d ? 'locked' : 'dim'}">${d}</div>`);
          continue;
        }
        if (!cN[k]) { cells.push(`<div class="cell none" title="no number left with a ${d} here">${d}</div>`); continue; }
        const v = M.val(cEP[k], cN[k], cTop[k]);
        const t = (v - lo) / span;
        cells.push(`<button type="button" class="cell live" data-p="${p}" data-d="${d}"
          style="background:${ramp(t)};color:${t > .6 ? '#0a1220' : '#e7e8ea'}"
          title="${d} here: ${M.fmt(v)} across ${fmt(cN[k])} numbers">${d}<em>${M.fmt(v)}</em></button>`);
      }
      cols.push(`<div class="col${fix[p] >= 0 ? ' fixed' : ''}">
        <div class="chead">${fix[p] >= 0
          ? `<button type="button" class="unlock" data-un="${p}" title="Unlock this position">${fix[p]}<span>&times;</span></button>`
          : `<span class="q">?</span>`}</div>
        <div class="cells">${cells.join('')}</div>
        <div class="cfoot">${['100k', '10k', '1k', '100', '10', '1'][p]}</div>
      </div>`);
    }
    $('board').innerHTML = cols.join('');
  }

  // --- summary -----------------------------------------------------------
  function tierOf(ep) { let t = TIERS[0]; for (const x of TIERS) if (ep >= x.lo) t = x; return t; }

  function summary() {
    const pat = fix.map(d => d < 0 ? '<i>?</i>' : d).join('');
    const bt = tierOf(Q.bestEP);
    $('pattern').innerHTML = pat;
    $('summary').innerHTML = `
      <div class="stat stat-lg"><span class="k">Numbers left</span><span class="v">${fmt(Q.count)}</span>
        <span class="sub">${(100 * Q.count / 900000).toFixed(Q.count < 900 ? 4 : 2)}% of the six-digit range</span></div>
      <div class="stat stat-lg"><span class="k">Mean EP</span><span class="v">${fmt(Q.meanEP)}</span>
        <span class="sub">${Q.meanC.toFixed(1)} badges on average</span></div>
      <div class="stat stat-lg"><span class="k">Top 1% chance</span><span class="v">${(100 * Q.pTop).toFixed(2)}%</span>
        <span class="sub">EP over ${fmt(P99)}</span></div>
      <div class="stat stat-lg"><span class="k">Best case</span><span class="v">${compact(Q.bestEP)}</span>
        <span class="sub">EP · <a href="/?n=${Q.best}">${Q.best.toLocaleString()}</a> · ${bt.label}</span></div>`;

    $('tops').innerHTML = Q.tops.map(([n, e]) => {
      const t = tierOf(e);
      return `<a class="toprow" href="/?n=${n}"><span class="tn">${n.toLocaleString()}</span>
        <span class="pill" style="--tc:${t.accent}">${t.label}</span>
        <span class="te">${fmt(e)} EP</span></a>`;
    }).join('');

    // Distribution of the survivors, on the same log-EP axis every query uses, so the
    // shape can be compared as digits are locked in rather than rescaling each time.
    const hist = new Float64Array(Q.hist);
    const mx = Math.max(...hist) || 1;
    $('hist').innerHTML = Array.from(hist, (v, i) =>
      `<i style="height:${(100 * v / mx).toFixed(1)}%" title="${fmt(v)} numbers"></i>`).join('');
  }

  // --- driving the worker -------------------------------------------------
  function send() {
    if (busy) return;
    busy = true;
    $('board').classList.add('working');
    W.postMessage({ cmd: 'query', fix: fix.slice() });
  }
  function got(m) {
    if (m.type !== 'q') return;
    Q = m; busy = false;
    $('board').classList.remove('working');
    board(); summary();
  }

  document.addEventListener('click', e => {
    const cell = e.target.closest('[data-p]');
    if (cell) { fix[+cell.dataset.p] = +cell.dataset.d; send(); return; }
    const un = e.target.closest('[data-un]');
    if (un) { fix[+un.dataset.un] = -1; send(); return; }
  });
  $('reset').addEventListener('click', () => { fix = [-1, -1, -1, -1, -1, -1]; send(); });
  $('greedy').addEventListener('click', () => {
    // Lock the single best remaining choice, then let the next result drive the next
    // step - each pick is conditional on the last, which is the whole point.
    const M = METRICS[metric];
    const cN = new Float64Array(Q.cN), cEP = new Float64Array(Q.cEP), cTop = new Float64Array(Q.cTop);
    let bk = -1, bv = -Infinity;
    for (let k = 0; k < 60; k++) {
      if (fix[(k / 10) | 0] >= 0 || !cN[k]) continue;
      const v = M.val(cEP[k], cN[k], cTop[k]);
      if (v > bv) { bv = v; bk = k; }
    }
    if (bk < 0) return;
    fix[(bk / 10) | 0] = bk % 10;
    send();
  });
  $('metric').addEventListener('change', e => { metric = e.target.value; board(); });

  betaBoot(WORKER_SRC, got).then(({ worker, data }) => {
    W = worker; Q = data; P99 = data.p99; HB = data.HB;
    $('page').classList.add('on');
    board(); summary();
  });
}

function renderOracle(ctx) {
  const { CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE } = ctx;
  const tiers = CARD_TIER_NAMES.map((key, i) => ({
    label: TIER_PALETTE[key].label, accent: TIER_PALETTE[key].accent,
    lo: i === 0 ? 0 : CARD_TIERS[i - 1][0],
  }));

  const css = `
  #page { display:none; }
  #page.on { display:block; }
  .bar { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-bottom:1rem; }
  .bar label { font-size:.78rem; color:var(--muted); }
  .bar select { font-size:.85rem; padding:.4rem .5rem; }
  .bar .grow { flex:1; }

  #pattern { font-family:var(--mono); font-size:2.1rem; font-weight:600; letter-spacing:.14em;
    margin-bottom:.9rem; }
  #pattern i { font-style:normal; color:var(--faint); }

  .cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,320px); gap:1rem; align-items:start; }
  @media (max-width:980px) { .cols { grid-template-columns:minmax(0,1fr); } }

  #board { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:.5rem; transition:opacity .12s; }
  #board.working { opacity:.55; }
  .col { display:flex; flex-direction:column; gap:.3rem; min-width:0; }
  .chead { height:34px; display:flex; align-items:center; justify-content:center; }
  .chead .q { font-family:var(--mono); font-size:1.2rem; color:var(--faint); }
  .unlock { padding:.15rem .5rem; font-family:var(--mono); font-size:1.05rem; font-weight:700;
    color:var(--hl-lt); background:color-mix(in srgb, var(--hl) 18%, transparent);
    border-color:color-mix(in srgb, var(--hl) 45%, transparent); }
  .unlock span { color:var(--faint); font-size:.8rem; }
  .cells { display:flex; flex-direction:column; gap:2px; }
  .cell { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;
    height:38px; border-radius:var(--r-sm); font-family:var(--mono); font-size:.95rem; font-weight:600;
    border:1px solid transparent; background:var(--surface-2); color:var(--muted); padding:0; }
  .cell em { font-style:normal; font-size:.6rem; font-weight:500; opacity:.85; letter-spacing:-.02em; }
  .cell.live { cursor:pointer; }
  .cell.live:hover { border-color:var(--text); }
  .cell.off { background:transparent; }
  .cell.none { background:var(--surface); color:var(--faint); opacity:.35; }
  .cell.dim { background:var(--surface); color:var(--faint); opacity:.3; }
  .cell.locked { background:var(--hl); color:var(--on-accent); border-color:var(--hl); }
  .cfoot { text-align:center; font-size:.66rem; color:var(--faint); font-family:var(--mono); }
  @media (max-width:640px) { .cell { height:30px; font-size:.82rem; } .cell em { display:none; } }

  #side { display:flex; flex-direction:column; gap:.7rem; }
  #summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.5rem; }
  #summary .stat { min-width:0; overflow-wrap:anywhere; }
  #hist { display:flex; align-items:flex-end; gap:1px; height:78px; padding:.2rem;
    background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-sm); }
  #hist i { flex:1; background:var(--accent); border-radius:1px 1px 0 0; min-height:1px; }
  .histax { display:flex; justify-content:space-between; margin-top:.25rem; font-size:.68rem;
    color:var(--faint); font-family:var(--mono); }
  .toprow { display:flex; align-items:center; gap:.5rem; padding:.3rem .35rem; text-decoration:none;
    border-radius:var(--r-sm); color:var(--dim); }
  .toprow:hover { background:var(--surface-2); color:var(--text); }
  .toprow .tn { flex:1; font-family:var(--mono); font-size:.88rem; }
  .toprow .te { font-family:var(--mono); font-size:.75rem; color:var(--faint); }
  .small { font-size:.78rem; line-height:1.5; margin:-.35rem 0 .6rem; }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Digit Oracle <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">Lock a digit and every remaining choice is re-scored against the numbers that still
    match. Six-digit numbers only.</p>

  <div id="page">
    <div class="bar">
      <label for="metric">Score by</label>
      <select id="metric">
        <option value="ep">Mean EP</option>
        <option value="top">Chance of a top 1% number</option>
      </select>
      <span class="grow"></span>
      <button type="button" id="greedy" class="btn-sm">Lock the best one</button>
      <button type="button" id="reset" class="btn-sm btn-ghost">Reset</button>
    </div>

    <div id="pattern"></div>

    <div class="cols">
      <section class="card"><div id="board"></div></section>
      <div id="side">
        <div id="summary"></div>
        <section class="card"><h2>Where the survivors score</h2>
          <p class="muted small">EP of every number that still matches, on a log axis.</p>
          <div id="hist"></div>
          <div class="histax"><span>low EP</span><span>high EP</span></div>
        </section>
        <section class="card"><h2>Best still reachable</h2>
          <div id="tops"></div></section>
      </div>
    </div>
  </div>

  <footer>
    Each cell is the mean over every six-digit number that matches the digits already locked
    <b>and</b> has that digit in that position - so the board changes meaning with every lock, and a
    digit worth little on its own can be worth a lot beside the right neighbour. The <b>100k</b> column
    is the leading digit and <b>1</b> the last. Numbers below 100,000 are left out: fixing a leading
    zero would quietly change which rules apply.
  </footer>
</div>
${overlayHTML('Then scoring every digit in every position against the 900,000 six-digit numbers.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(oracleWorker))};
(${oracleClient.toString()})(__W, ${JSON.stringify(tiers)});`;

  return betaShell({ title: 'RNGdle - Digit Oracle', width: '1080px', slug: 'oracle', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/luck - the odds of a roll, and whether yours were any good.
//
// Every other tool here is about the numbers. This one is about the player: the sweep
// is the exact distribution of EP over the whole roll space, so every question of the
// "how likely was that?" kind has a closed-form answer rather than a simulated one.
//
// The one that matters is best-of-N. If F is the EP distribution then the best of N
// independent rolls is below x with probability F(x)^N, which gives both the typical
// best for a given number of rolls AND, read the other way, exactly how lucky a real
// player's best roll was among everyone else who rolled the same number of times.
// ---------------------------------------------------------------------------

function luckWorker() {
  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.85);
      const N = swept.ep.length;
      self.postMessage({ type: 'progress', pct: 0.9, msg: 'Sorting every score…' });
      // The empirical CDF, as a sorted copy. 8MB, transferred zero-copy, and it lets
      // the page answer any percentile question exactly instead of interpolating.
      const sorted = Float64Array.from(swept.ep).sort();
      const ep = Float64Array.from(swept.ep);
      self.postMessage({ type: 'ready', sorted: sorted.buffer, ep: ep.buffer, N },
        [sorted.buffer, ep.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

function luckClient(WORKER_SRC, TIERS) {
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  const compact = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M'
    : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : fmt(n);
  const oneIn = p => p <= 0 ? '-' : p >= 1 ? '1 in 1' : '1 in ' + fmt(1 / p);

  let S = null, EP = null, N = 0;

  // Share of all rolls scoring at or below x, and its inverse.
  function cdf(x) {
    let lo = 0, hi = N;
    while (lo < hi) { const m = (lo + hi) >> 1; if (S[m] <= x) lo = m + 1; else hi = m; }
    return lo / N;
  }
  function quantile(p) { return S[Math.min(N - 1, Math.max(0, Math.round(p * N) - 1))]; }
  function tierOf(ep) { let t = TIERS[0]; for (const x of TIERS) if (ep >= x.lo) t = x; return t; }

  // --- distribution chart -------------------------------------------------
  function distribution() {
    const W = 760, H = 260, M = { l: 44, r: 14, t: 14, b: 40 }, BINS = 150;
    const lgMax = Math.log10(1 + S[N - 1]);
    const bins = new Float64Array(BINS);
    for (let i = 0; i < N; i++) bins[Math.min(BINS - 1, (Math.log10(1 + S[i]) / lgMax * BINS) | 0)]++;
    const mx = Math.max(...bins);
    const bx = i => M.l + (i / BINS) * (W - M.l - M.r);
    const bw = (W - M.l - M.r) / BINS;

    const g = [];
    // Tier bands behind the bars: the histogram is the shape, the bands are the stakes.
    for (let t = 0; t < TIERS.length; t++) {
      const x0 = bx(Math.log10(1 + TIERS[t].lo) / lgMax * BINS);
      const x1 = t + 1 < TIERS.length ? bx(Math.log10(1 + TIERS[t + 1].lo) / lgMax * BINS) : W - M.r;
      if (x1 - x0 < 0.5) continue;
      g.push(`<rect class="band" x="${x0.toFixed(1)}" y="${M.t}" width="${(x1 - x0).toFixed(1)}"
        height="${H - M.t - M.b}" fill="${TIERS[t].accent}"/>`);
      if (x1 - x0 > 52) g.push(`<text class="tl" x="${((x0 + x1) / 2).toFixed(1)}" y="${M.t + 12}"
        text-anchor="middle" fill="${TIERS[t].accent}">${TIERS[t].label}</text>`);
    }
    for (let i = 0; i < BINS; i++) {
      if (!bins[i]) continue;
      const h = (bins[i] / mx) * (H - M.t - M.b);
      g.push(`<rect class="bar" x="${bx(i).toFixed(1)}" y="${(H - M.b - h).toFixed(1)}"
        width="${Math.max(0.6, bw - 0.4).toFixed(2)}" height="${h.toFixed(1)}"/>`);
    }
    for (let e = 2; e <= Math.floor(lgMax); e++) {
      const x = bx(e / lgMax * BINS);
      g.push(`<text class="ax" x="${x.toFixed(1)}" y="${H - M.b + 15}" text-anchor="middle">${
        compact(Math.pow(10, e))}</text>`);
    }
    $('dist').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Distribution of EP over all 1,000,001 rolls">${g.join('')}
      <text class="axl" x="${M.l + (W - M.l - M.r) / 2}" y="${H - 4}" text-anchor="middle">EP of a single roll (log scale)</text>
    </svg>`;
  }

  // --- odds table ---------------------------------------------------------
  function odds() {
    $('odds').innerHTML = TIERS.slice().reverse().map(t => {
      const p = 1 - cdf(t.lo - 0.5);              // P(roll lands in this tier or above)
      const exact = cdf((TIERS[TIERS.indexOf(t) + 1] || { lo: Infinity }).lo - 0.5) - cdf(t.lo - 0.5);
      return `<div class="orow">
        <span class="pill" style="--tc:${t.accent}">${t.label}</span>
        <span class="ol">${t.lo ? fmt(t.lo) + '+ EP' : 'any score'}</span>
        <span class="obar"><i style="width:${Math.max(0.5, 100 * Math.pow(exact, 0.35)).toFixed(1)}%;background:${t.accent}"></i></span>
        <span class="oval">${(100 * exact).toFixed(exact < 0.001 ? 4 : 2)}%</span>
        <span class="oe">${oneIn(p)} or better</span>
      </div>`;
    }).join('');
  }

  // --- best-of-N ----------------------------------------------------------
  // P(best of n <= x) = F(x)^n, so the median best is the F = 0.5^(1/n) quantile and
  // the 10-90 band falls straight out the same way.
  const bestAt = (n, q) => quantile(Math.pow(q, 1 / n));

  function bestOfN() {
    const n = Number($('rolls').value);
    $('rollsv').textContent = fmt(n);
    const med = bestAt(n, 0.5), lo = bestAt(n, 0.1), hi = bestAt(n, 0.9);
    const pMyth = 1 - Math.pow(cdf(TIERS[TIERS.length - 1].lo - 0.5), n);
    const t = tierOf(med);
    $('bon').innerHTML = `
      <div class="stat stat-lg"><span class="k">Typical best</span><span class="v">${compact(med)}</span>
        <span class="sub">EP · <span class="pill" style="--tc:${t.accent}">${t.label}</span></span></div>
      <div class="stat stat-lg"><span class="k">Unlucky / lucky</span><span class="v">${compact(lo)} - ${compact(hi)}</span>
        <span class="sub">the middle 80% of players</span></div>
      <div class="stat stat-lg"><span class="k">At least one ${TIERS[TIERS.length - 1].label.toLowerCase()}</span>
        <span class="v">${(100 * pMyth).toFixed(pMyth < 0.001 ? 3 : 1)}%</span>
        <span class="sub">${oneIn(pMyth)} players</span></div>`;

    // The whole curve, so the slider has context rather than three numbers in a vacuum.
    const W = 760, H = 170, M = { l: 52, r: 12, t: 12, b: 28 };
    const maxN = 10000, lgN = Math.log10(maxN);
    const lgMax = Math.log10(1 + S[N - 1]);
    const cx = k => M.l + (Math.log10(k) / lgN) * (W - M.l - M.r);
    const cy = v => H - M.b - (Math.log10(1 + v) / lgMax) * (H - M.t - M.b);
    const pts = [], band = [];
    for (let k = 1; k <= maxN; k = k < 10 ? k + 1 : Math.round(k * 1.18)) {
      pts.push(`${cx(k).toFixed(1)},${cy(bestAt(k, 0.5)).toFixed(1)}`);
      band.push([cx(k), cy(bestAt(k, 0.9)), cy(bestAt(k, 0.1))]);
    }
    const top = band.map(b => `${b[0].toFixed(1)},${b[1].toFixed(1)}`).join(' ');
    const bot = band.slice().reverse().map(b => `${b[0].toFixed(1)},${b[2].toFixed(1)}`).join(' ');
    $('curve').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Typical best score against number of rolls">
      <polygon class="cband" points="${top} ${bot}"/>
      <polyline class="cline" points="${pts.join(' ')}"/>
      <line class="cmark" x1="${cx(n).toFixed(1)}" y1="${M.t}" x2="${cx(n).toFixed(1)}" y2="${H - M.b}"/>
      ${[1, 10, 100, 1000, 10000].map(k =>
        `<text class="ax" x="${cx(k).toFixed(1)}" y="${H - 8}" text-anchor="middle">${k >= 1000 ? (k / 1000) + 'k' : k}</text>`).join('')}
      <text class="axl" x="4" y="${M.t + 8}">best EP</text>
    </svg>`;
  }

  // --- your rolls ---------------------------------------------------------
  function analyse(nums, label) {
    const valid = nums.filter(n => Number.isInteger(n) && n >= 0 && n < N);
    if (!valid.length) {
      $('verdict').innerHTML = '<p class="err">No usable numbers - give me integers from 0 to 1,000,000.</p>';
      return;
    }
    const rows = valid.map(n => ({ n, ep: EP[n], p: cdf(EP[n]) })).sort((a, b) => b.ep - a.ep);
    const k = rows.length;
    const best = rows[0];
    // Two independent readings of the same rolls: how good the single best one was
    // among players with the same number of rolls, and whether the whole set drifted
    // high or low (percentiles are uniform, so their mean has a known spread).
    const beatShare = Math.pow(best.p, k);
    const meanP = rows.reduce((s, r) => s + r.p, 0) / k;
    const z = (meanP - 0.5) / Math.sqrt(1 / 12 / k);
    const par = bestAt(k, 0.5);
    const verdict = beatShare >= 0.999 ? 'extraordinary' : beatShare >= 0.99 ? 'very lucky'
      : beatShare >= 0.75 ? 'lucky' : beatShare >= 0.25 ? 'about par'
      : beatShare >= 0.01 ? 'unlucky' : 'brutal';

    $('verdict').innerHTML = `
      <div class="vhead"><b>${label}</b><span>${fmt(k)} roll${k === 1 ? '' : 's'}</span></div>
      <div class="vstats">
        <div class="stat stat-lg"><span class="k">Best roll</span><span class="v">${compact(best.ep)}</span>
          <span class="sub">EP · <a href="/?n=${best.n}">${best.n.toLocaleString()}</a>
            · ${(100 * best.p).toFixed(3)}th percentile</span></div>
        <div class="stat stat-lg"><span class="k">Luckier than</span><span class="v">${(100 * beatShare).toFixed(1)}%</span>
          <span class="sub">of players with ${fmt(k)} rolls - <b>${verdict}</b></span></div>
        <div class="stat stat-lg"><span class="k">Par for ${fmt(k)} rolls</span><span class="v">${compact(par)}</span>
          <span class="sub">EP · what a median player's best would be</span></div>
        <div class="stat stat-lg"><span class="k">Overall drift</span><span class="v">${z >= 0 ? '+' : ''}${z.toFixed(2)}σ</span>
          <span class="sub">mean percentile ${(100 * meanP).toFixed(1)} vs 50 expected</span></div>
      </div>
      <div class="strip" title="every roll by percentile, left = worst">${
        rows.slice().sort((a, b) => a.p - b.p).map(r =>
          `<i style="left:${(100 * r.p).toFixed(3)}%;background:${tierOf(r.ep).accent}"
            title="${r.n.toLocaleString()} · ${fmt(r.ep)} EP · ${(100 * r.p).toFixed(2)}th"></i>`).join('')}</div>
      <div class="stripax"><span>worst possible</span><span>median</span><span>best possible</span></div>
      <div class="vlist">${rows.slice(0, 8).map(r => {
        const t = tierOf(r.ep);
        return `<a class="vrow" href="/?n=${r.n}"><span class="vn">${r.n.toLocaleString()}</span>
          <span class="pill" style="--tc:${t.accent}">${t.label}</span>
          <span class="vp">${(100 * r.p).toFixed(2)}th</span>
          <span class="ve">${fmt(r.ep)} EP</span></a>`;
      }).join('')}</div>`;
  }

  $('paste-go').addEventListener('click', () => {
    const nums = ($('paste').value.match(/\d+/g) || []).map(Number);
    analyse(nums, 'Pasted rolls');
  });
  $('user-form').addEventListener('submit', async e => {
    e.preventDefault();
    const u = $('user').value.trim();
    if (!u) return;
    $('verdict').innerHTML = '<div class="loading"><span class="spinner"></span>Loading rolls…</div>';
    try {
      const r = await fetch('/api/profile?u=' + encodeURIComponent(u));
      const d = await r.json();
      if (!r.ok || !d.scored) throw new Error(d.error || 'could not load that player');
      analyse(d.scored.map(s => s.number), d.username || u);
    } catch (err) {
      $('verdict').innerHTML = `<p class="err">${err.message}</p>`;
    }
  });
  $('rolls').addEventListener('input', bestOfN);

  betaBoot(WORKER_SRC).then(({ data }) => {
    S = new Float64Array(data.sorted); EP = new Float64Array(data.ep); N = data.N;
    $('page').classList.add('on');
    $('head').innerHTML = `
      <div class="stat stat-lg"><span class="k">Median roll</span><span class="v">${fmt(quantile(0.5))}</span>
        <span class="sub">EP · half of all numbers score less</span></div>
      <div class="stat stat-lg"><span class="k">Mean roll</span><span class="v">${
        fmt(S.reduce((a, b) => a + b, 0) / N)}</span><span class="sub">EP · dragged up by the tail</span></div>
      <div class="stat stat-lg"><span class="k">Top 1% starts at</span><span class="v">${fmt(quantile(0.99))}</span>
        <span class="sub">EP</span></div>
      <div class="stat stat-lg"><span class="k">Best possible</span><span class="v">${compact(S[N - 1])}</span>
        <span class="sub">EP · one number in the range</span></div>`;
    distribution(); odds(); bestOfN();
    // ?u=name deep-links straight into an analysis, so a profile page can point here.
    const u = new URLSearchParams(location.search).get('u');
    if (u) { $('user').value = u; $('user-form').dispatchEvent(new Event('submit')); }
  });
}

function renderLuck(ctx) {
  const { CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE } = ctx;
  const tiers = CARD_TIER_NAMES.map((key, i) => ({
    label: TIER_PALETTE[key].label, accent: TIER_PALETTE[key].accent,
    lo: i === 0 ? 0 : CARD_TIERS[i - 1][0],
  }));

  const css = `
  #page { display:none; }
  #page.on { display:block; }
  #head { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(180px,100%),1fr)); gap:.6rem; margin-bottom:1.2rem; }
  .card { margin-bottom:.9rem; }
  .card > p.small { margin:-.35rem 0 .8rem; font-size:.8rem; color:var(--muted); line-height:1.6; }
  svg { width:100%; height:auto; display:block; }
  .ax { fill:var(--faint); font-size:10px; font-family:var(--mono); }
  .axl { fill:var(--muted); font-size:11px; }
  .band { opacity:.13; }
  .tl { font-size:8.5px; font-weight:700; letter-spacing:.09em; opacity:.85; }
  .bar { fill:var(--dim); }

  .orow { display:grid; grid-template-columns:5.6rem 6.5rem 1fr 4.4rem 9rem; align-items:center; gap:.6rem;
    padding:.32rem .2rem; font-size:.82rem; }
  .orow .ol { color:var(--muted); font-family:var(--mono); font-size:.76rem; }
  .orow .obar { height:8px; border-radius:var(--r-pill); background:var(--surface-2); overflow:hidden; }
  .orow .obar i { display:block; height:100%; }
  .orow .oval { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .orow .oe { text-align:right; color:var(--faint); font-family:var(--mono); font-size:.75rem; }
  @media (max-width:720px) { .orow { grid-template-columns:5.6rem 1fr 4.4rem; } .orow .ol, .orow .oe { display:none; } }

  #curve { margin-top:.9rem; }
  #bon { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(130px,100%),1fr)); gap:.5rem; }
  #bon .stat { min-width:0; overflow-wrap:anywhere; }
  .slider { display:flex; align-items:center; gap:.7rem; margin-bottom:.8rem; }
  .slider input { flex:1; }
  .slider b { font-family:var(--mono); min-width:4rem; text-align:right; }
  .cband { fill:color-mix(in srgb, var(--accent) 18%, transparent); }
  .cline { fill:none; stroke:var(--accent); stroke-width:1.6; }
  .cmark { stroke:var(--hl); stroke-width:1.2; stroke-dasharray:3 3; }

  .inputs { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:.8rem; margin-bottom:.9rem; }
  @media (max-width:720px) { .inputs { grid-template-columns:minmax(0,1fr); } }
  .inputs label { display:block; font-size:.72rem; letter-spacing:.06em; text-transform:uppercase;
    color:var(--faint); font-weight:600; margin-bottom:.3rem; }
  #user-form { display:flex; gap:.5rem; }
  #user { flex:1; min-width:0; }
  #paste { width:100%; height:64px; resize:vertical; font-family:var(--mono); font-size:.8rem; }
  #paste-go { margin-top:.4rem; }

  .vhead { display:flex; align-items:baseline; gap:.6rem; margin-bottom:.7rem; }
  .vhead b { font-size:1rem; }
  .vhead span { color:var(--muted); font-size:.82rem; }
  .vstats { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(160px,100%),1fr)); gap:.5rem; margin-bottom:1rem; }
  .vstats .stat { min-width:0; overflow-wrap:anywhere; }
  .strip { position:relative; height:26px; border-radius:var(--r-sm); background:
    linear-gradient(90deg, var(--surface-2), var(--surface-3)); border:1px solid var(--border); }
  .strip i { position:absolute; top:3px; width:3px; height:18px; border-radius:2px; margin-left:-1.5px; opacity:.9; }
  .stripax { display:flex; justify-content:space-between; margin:.25rem 0 .9rem; font-size:.7rem; color:var(--faint); }
  .vrow { display:flex; align-items:center; gap:.6rem; padding:.3rem .35rem; text-decoration:none;
    border-radius:var(--r-sm); color:var(--dim); }
  .vrow:hover { background:var(--surface-2); color:var(--text); }
  .vrow .vn { flex:1; font-family:var(--mono); font-size:.88rem; }
  .vrow .vp, .vrow .ve { font-family:var(--mono); font-size:.76rem; color:var(--faint); }
  .loading { display:flex; align-items:center; gap:.6rem; color:var(--muted); font-size:.86rem; }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Luck Lab <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">What a roll is worth before you make it - and how lucky yours actually were.</p>

  <div id="page">
    <div id="head"></div>

    <section class="card">
      <h2>What a single roll scores</h2>
      <p class="small">Every one of the 1,000,001 legal rolls, binned by EP on a log axis, with the card
        tiers shaded behind. Nearly everything lands in the crowded middle; the tiers that matter are
        the thin tail on the right.</p>
      <div id="dist"></div>
    </section>

    <section class="card">
      <h2>Tier odds per roll</h2>
      <p class="small">Read down the percentages: 1%, 4%, 5%, 15%, 25%, 49%. The card tiers are not
        placed at round EP values at all - they are cut at round <b>percentiles</b> of this exact
        distribution, which is why the thresholds themselves look so arbitrary.</p>
      <div id="odds"></div>
    </section>

    <section class="card">
      <h2>Best of N rolls</h2>
      <p class="small">The best of N independent rolls is below a score with probability F(score) to the
        power N - so the whole curve of "how good should my best be by now" is exact, not simulated.</p>
      <div class="slider"><span class="muted">Rolls</span>
        <input id="rolls" type="range" min="1" max="2000" value="50">
        <b id="rollsv">50</b></div>
      <div id="bon"></div>
      <div id="curve"></div>
    </section>

    <section class="card">
      <h2>How lucky were yours?</h2>
      <p class="small">Look up a player, or paste any list of numbers. Each roll is scored against the
        exact distribution above, so nothing here is an estimate.</p>
      <div class="inputs">
        <div><label for="user">rngdle player</label>
          <form id="user-form"><input id="user" type="text" placeholder="username" autocomplete="off">
            <button type="submit" class="btn-primary btn-sm">Check</button></form></div>
        <div><label for="paste">or paste rolls</label>
          <textarea id="paste" placeholder="123456, 696969, 100000&#10;one per line or comma separated"></textarea>
          <button type="button" id="paste-go" class="btn-sm">Analyse</button></div>
      </div>
      <div id="verdict"></div>
    </section>
  </div>

  <footer>
    <b>Luckier than</b> is F(your best) raised to the power of your roll count: the exact share of
    players with the same number of rolls whose best would come in below yours. <b>Overall drift</b> is
    a z-score on the mean percentile of every roll - percentiles are uniform by construction, so their
    mean has a known spread and any real streak of good or bad luck shows up as sigma. Player rolls come
    from rngdle's public API and are scored here, locally.
  </footer>
</div>
${overlayHTML('Then sorting all 1,000,001 scores into the exact distribution behind every number here.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(luckWorker))};
(${luckClient.toString()})(__W, ${JSON.stringify(tiers)});`;

  return betaShell({ title: 'RNGdle - Luck Lab', width: '900px', slug: 'luck', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/collector - how long it takes to earn every badge.
//
// Two different questions, and the gap between the answers is the whole point:
//
//   Rolling at random, how many rolls until you have seen all 230 at least once?
//   If you could CHOOSE your numbers, how few would you need?
//
// The first is a weighted coupon-collector problem. The expected count after n rolls
// is exactly the sum over badges of 1 - (1 - p)^n, which needs no simulation; the
// completion TIME does, because the badges are far from independent - a family's
// members mostly arrive together, and the rarest badges cluster on the same handful of
// numbers. So the simulation draws from the actual earner sets rather than from
// independent geometrics, which would give a badly wrong answer.
//
// The second is a set cover. Greedy over the sweep's per-badge example numbers gives a
// legitimate upper bound in a few hundred thousand operations - not proof of the
// minimum, but enough to show how absurd the ratio is.
// ---------------------------------------------------------------------------

function collectorWorker() {
  const RARE_MAX = 2000;                          // "rare" = earned by <= this many numbers
  const RUNS = 240;

  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.6);
      const bits = swept.bits, ROW = swept.ROW, N = swept.ep.length;
      const B = E.BADGE_META.length;

      const earn = new Float64Array(B);
      const idx = new Int32Array(256);
      for (let n = 0; n < N; n++) {
        const k = betaEarned(bits, n * ROW, ROW, idx);
        for (let a = 0; a < k; a++) earn[idx[a]]++;
      }

      // --- the rare set, and every number that carries one of them ---------
      // Everything outside it is earned by >= RARE_MAX numbers, i.e. within a few
      // hundred rolls with near-certainty, so it never decides the completion time.
      self.postMessage({ type: 'progress', pct: 0.7, msg: 'Finding the rare badges…' });
      const rare = [];
      for (let i = 0; i < B; i++) if (earn[i] > 0 && earn[i] <= RARE_MAX) rare.push(i);
      const rareOf = new Int32Array(B).fill(-1);
      rare.forEach((b, i) => { rareOf[b] = i; });

      // CSR: member[m] is a number, and flat[off[m]..off[m+1]] are the rare badges on it.
      const members = [], off = [0], flat = [];
      for (let n = 0; n < N; n++) {
        const k = betaEarned(bits, n * ROW, ROW, idx);
        let any = false;
        for (let a = 0; a < k; a++) {
          const r = rareOf[idx[a]];
          if (r >= 0) { flat.push(r); any = true; }
        }
        if (any) { members.push(n); off.push(flat.length); }
      }
      const U = members.length, pHit = U / N;

      // --- completion time -------------------------------------------------
      // Each union hit is a uniform draw from `members`; the rolls between hits are
      // geometric, and by the time a run finishes there are thousands of them, so the
      // total is summed with a normal approximation rather than drawn one at a time.
      self.postMessage({ type: 'progress', pct: 0.82, msg: 'Simulating collections…' });
      const have = new Uint8Array(rare.length);
      const times = new Float64Array(RUNS);
      const sd1 = Math.sqrt(1 - pHit) / pHit;
      for (let r = 0; r < RUNS; r++) {
        have.fill(0);
        let left = rare.length, hits = 0;
        while (left > 0) {
          const m = (Math.random() * U) | 0;
          hits++;
          for (let j = off[m]; j < off[m + 1]; j++) {
            if (!have[flat[j]]) { have[flat[j]] = 1; left--; }
          }
        }
        // Sum of `hits` geometrics: mean hits/pHit, sd sd1*sqrt(hits). Box-Muller once.
        const u1 = Math.max(1e-12, Math.random()), u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        times[r] = Math.max(hits, hits / pHit + z * sd1 * Math.sqrt(hits));
        if ((r & 15) === 0) self.postMessage({ type: 'progress', pct: 0.82 + 0.12 * (r / RUNS) });
      }
      times.sort();

      // --- greedy set cover over the sweep's example numbers ---------------
      self.postMessage({ type: 'progress', pct: 0.95, msg: 'Searching for a cover…' });
      const cand = [...new Set(swept.examples.flat().map(e => e[0]))];
      const candMask = cand.map(n => {
        const k = betaEarned(bits, n * ROW, ROW, idx);
        return Array.from(idx.subarray(0, k));
      });
      const covered = new Uint8Array(B);
      const cover = [];
      let need = 0;
      for (let i = 0; i < B; i++) if (earn[i] > 0) need++;
      while (need > 0) {
        let bestI = -1, bestGain = 0;
        for (let c = 0; c < cand.length; c++) {
          let gain = 0;
          for (const b of candMask[c]) if (!covered[b]) gain++;
          if (gain > bestGain) { bestGain = gain; bestI = c; }
        }
        if (bestI < 0) break;                     // examples cannot reach the rest
        for (const b of candMask[bestI]) if (!covered[b]) { covered[b] = 1; need--; }
        cover.push([cand[bestI], bestGain]);
      }

      self.postMessage({ type: 'ready', earn: earn.buffer, N, RARE_MAX, rare, U, pHit,
        times: times.buffer, cover, uncovered: need }, [earn.buffer, times.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

function collectorClient(WORKER_SRC, META, PAL) {
  const B = META.length;
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  const compact = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : fmt(n);
  let EARN = null, N = 0, T = null, D = null;

  // Exact expected number of distinct badges after n rolls - no simulation needed,
  // because expectation is linear even though the badges are wildly dependent.
  function expected(n) {
    let s = 0;
    for (let i = 0; i < B; i++) {
      if (!EARN[i]) continue;
      s += 1 - Math.pow(1 - EARN[i] / N, n);
    }
    return s;
  }
  const reachable = () => { let c = 0; for (let i = 0; i < B; i++) if (EARN[i]) c++; return c; };

  function curve() {
    const W = 760, H = 240, M = { l: 46, r: 14, t: 14, b: 34 };
    const maxLg = 7;                              // 1 .. 10,000,000 rolls
    const R = reachable();
    const cx = n => M.l + (Math.log10(n) / maxLg) * (W - M.l - M.r);
    const cy = v => H - M.b - (v / R) * (H - M.t - M.b);
    const pts = [];
    for (let e = 0; e <= maxLg * 40; e++) {
      const n = Math.pow(10, e / 40);
      pts.push(`${cx(n).toFixed(1)},${cy(expected(n)).toFixed(1)}`);
    }
    const g = [];
    for (let e = 0; e <= maxLg; e++) {
      const x = cx(Math.pow(10, e));
      g.push(`<line class="grid" x1="${x.toFixed(1)}" y1="${M.t}" x2="${x.toFixed(1)}" y2="${H - M.b}"/>`);
      g.push(`<text class="ax" x="${x.toFixed(1)}" y="${H - M.b + 15}" text-anchor="middle">${
        e === 0 ? '1' : e < 3 ? Math.pow(10, e) : e < 6 ? Math.pow(10, e - 3) + 'k' : Math.pow(10, e - 6) + 'M'}</text>`);
    }
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const y = cy(R * f);
      g.push(`<line class="grid" x1="${M.l}" y1="${y.toFixed(1)}" x2="${W - M.r}" y2="${y.toFixed(1)}"/>`);
      g.push(`<text class="ax" x="${M.l - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${Math.round(R * f)}</text>`);
    }
    g.push(`<polyline class="cline" points="${pts.join(' ')}"/>`);
    g.push(`<line class="cmark" id="cmark" x1="0" y1="${M.t}" x2="0" y2="${H - M.b}"/>`);
    $('curve').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Expected badges collected against number of rolls">${g.join('')}
      <text class="axl" x="${M.l + (W - M.l - M.r) / 2}" y="${H - 3}" text-anchor="middle">rolls (log scale)</text>
    </svg>`;
    return { cx, W };
  }

  let CX = null;
  function atRolls() {
    const n = Math.round(Math.pow(10, Number($('nrolls').value) / 20));
    const e = expected(n), R = reachable();
    $('nrollsv').textContent = fmt(n);
    const missing = [];
    for (let i = 0; i < B; i++) {
      if (!EARN[i]) continue;
      const p = Math.pow(1 - EARN[i] / N, n);     // still missing after n rolls
      if (p > 0.5) missing.push({ i, p });
    }
    missing.sort((a, b) => b.p - a.p);
    $('atn').innerHTML = `
      <div class="stat stat-lg"><span class="k">Badges by then</span><span class="v">${e.toFixed(1)}</span>
        <span class="sub">of ${R} reachable</span></div>
      <div class="stat stat-lg"><span class="k">Still missing</span><span class="v">${(R - e).toFixed(1)}</span>
        <span class="sub">${missing.length} of them more likely absent than present</span></div>`;
    $('missing').innerHTML = missing.slice(0, 10).map(m =>
      `<a class="mrow" href="/badges#${META[m.i][5]}"><span class="me">${META[m.i][1]}</span>
        <span class="ml">${META[m.i][0]}</span>
        <span class="mv">${(100 * m.p).toFixed(1)}% absent</span></a>`).join('') ||
      '<p class="muted small">Every badge is more likely to be in the collection than not.</p>';
    const mk = document.getElementById('cmark');
    if (mk && CX) { const x = CX.cx(Math.max(1, n)).toFixed(1); mk.setAttribute('x1', x); mk.setAttribute('x2', x); }
  }

  function wall() {
    const rows = [];
    for (let i = 0; i < B; i++) if (EARN[i]) rows.push({ i, p: EARN[i] / N });
    rows.sort((a, b) => a.p - b.p);
    // The one-earner badges are all the same wait, so listing a dozen of them says
    // nothing. Count them once, then show the rarest that are not in that group.
    const solo = rows.filter(r => EARN[r.i] === 1);
    const rest = rows.filter(r => EARN[r.i] > 1);
    $('wall').innerHTML =
      (solo.length ? `<p class="small muted"><b>${solo.length} badges are earned by exactly one
        number</b> in the whole range - ${solo.slice(0, 6).map(r => META[r.i][0]).join(', ')} and
        ${solo.length - 6} more. Each is a 1-in-${fmt(N)} roll on its own, and between them they set
        the floor on everything below.</p>` : '') +
      rest.slice(0, 12).map(r =>
        `<a class="mrow" href="/badges#${META[r.i][5]}"><span class="me">${META[r.i][1]}</span>
          <span class="ml">${META[r.i][0]}<em>${fmt(EARN[r.i])} numbers earn it</em></span>
          <span class="mv">${compact(1 / r.p)} rolls</span></a>`).join('');
  }

  function completion() {
    const n = T.length;
    const q = f => T[Math.min(n - 1, Math.floor(f * n))];
    $('done').innerHTML = `
      <div class="stat stat-lg"><span class="k">Typical</span><span class="v">${compact(q(0.5))}</span>
        <span class="sub">rolls to earn all ${reachable()}</span></div>
      <div class="stat stat-lg"><span class="k">Lucky 10%</span><span class="v">${compact(q(0.1))}</span>
        <span class="sub">rolls or fewer</span></div>
      <div class="stat stat-lg"><span class="k">Unlucky 10%</span><span class="v">${compact(q(0.9))}</span>
        <span class="sub">rolls or more</span></div>
      <div class="stat stat-lg"><span class="k">At one a day</span><span class="v">${
        fmt(q(0.5) / 365)}</span><span class="sub">years, typically</span></div>`;

    // Histogram of the simulated completion times, linear in rolls.
    const BINS = 40, lo = T[0], hi = T[n - 1], span = (hi - lo) || 1;
    const bins = new Float64Array(BINS);
    for (let i = 0; i < n; i++) bins[Math.min(BINS - 1, ((T[i] - lo) / span * BINS) | 0)]++;
    const mx = Math.max(...bins);
    $('dhist').innerHTML = Array.from(bins, v =>
      `<i style="height:${(100 * v / mx).toFixed(1)}%"></i>`).join('');
    $('dhistax').innerHTML = `<span>${compact(lo)}</span><span>${compact(hi)}</span>`;
  }

  function coverHTML(cover, uncovered) {
    $('cover').innerHTML = `
      <div class="stat stat-lg"><span class="k">Numbers needed</span><span class="v">${cover.length}</span>
        <span class="sub">to earn all ${reachable()} between them${uncovered ? ` (${uncovered} unreachable)` : ''}</span></div>
      <div class="stat stat-lg"><span class="k">Versus rolling</span><span class="v">${
        compact(T[T.length >> 1] / cover.length)}x</span><span class="sub">fewer numbers than the typical run</span></div>`;
    $('coverlist').innerHTML = cover.map(([n, gain], i) =>
      `<a class="crow" href="/?n=${n}"><span class="ci">${i + 1}</span>
        <span class="cn">${n.toLocaleString()}</span>
        <span class="cg">+${gain}</span></a>`).join('');
  }

  $('nrolls').addEventListener('input', atRolls);

  betaBoot(WORKER_SRC).then(({ data }) => {
    EARN = new Float64Array(data.earn); N = data.N; T = new Float64Array(data.times);
    $('page').classList.add('on');
    CX = curve();
    wall(); completion(); atRolls(); coverHTML(data.cover, data.uncovered);
    $('rareinfo').textContent =
      `${data.rare.length} badges are earned by ${data.RARE_MAX.toLocaleString()} numbers or fewer; ` +
      `${data.U.toLocaleString()} numbers in the range carry at least one of them.`;
  });
}

function renderCollector(ctx) {
  const { BADGES, TIER_PALETTE, tierFromScore } = ctx;
  const meta = BADGES.map(([id, label, emoji, ep]) => [label, emoji, ep, tierFromScore(ep), 0, id]);
  const pal = Object.fromEntries(Object.entries(TIER_PALETTE).map(([k, v]) => [k, v.accent]));

  const css = `
  #page { display:none; }
  #page.on { display:block; }
  .card { margin-bottom:.9rem; }
  .card > p.small { margin:-.35rem 0 .8rem; font-size:.8rem; color:var(--muted); line-height:1.6; }
  .small { font-size:.8rem; line-height:1.6; }
  svg { width:100%; height:auto; display:block; }
  .grid { stroke:var(--border); stroke-width:1; }
  .ax { fill:var(--faint); font-size:10px; font-family:var(--mono); }
  .axl { fill:var(--muted); font-size:11px; }
  .cline { fill:none; stroke:var(--accent); stroke-width:1.8; }
  .cmark { stroke:var(--hl); stroke-width:1.2; stroke-dasharray:3 3; }

  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(150px,100%),1fr)); gap:.5rem; }
  .tiles .stat { min-width:0; overflow-wrap:anywhere; }
  .slider { display:flex; align-items:center; gap:.7rem; margin:.9rem 0 .8rem; }
  .slider input { flex:1; }
  .slider b { font-family:var(--mono); min-width:5rem; text-align:right; }
  .two { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(320px,100%),1fr)); gap:.9rem; }

  .mrow, .crow { display:flex; align-items:center; gap:.55rem; padding:.32rem .3rem; text-decoration:none;
    border-radius:var(--r-sm); color:var(--dim); }
  .mrow:hover, .crow:hover { background:var(--surface-2); color:var(--text); }
  .mrow .me { flex:0 0 auto; }
  .mrow .ml { flex:1; min-width:0; font-size:.85rem; display:flex; flex-direction:column; }
  .mrow .ml em { font-style:normal; font-size:.72rem; color:var(--faint); font-family:var(--mono); }
  .mrow .mv { flex:0 0 auto; font-family:var(--mono); font-size:.78rem; color:var(--hl-lt);
    font-variant-numeric:tabular-nums; }
  .crow .ci { flex:0 0 1.6rem; font-family:var(--mono); font-size:.72rem; color:var(--faint); }
  .crow .cn { flex:1; font-family:var(--mono); font-size:.88rem; }
  .crow .cg { font-family:var(--mono); font-size:.76rem; color:var(--ok); }
  #coverlist { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(180px,100%),1fr)); gap:0 .5rem;
    margin-top:.7rem; }

  #dhist { display:flex; align-items:flex-end; gap:1px; height:90px; padding:.2rem; margin-top:.8rem;
    background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-sm); }
  #dhist i { flex:1; background:var(--accent); border-radius:1px 1px 0 0; min-height:1px; }
  #dhistax { display:flex; justify-content:space-between; margin-top:.25rem; font-size:.7rem;
    color:var(--faint); font-family:var(--mono); }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>The Collector <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">How many rolls it takes to earn every badge - and how few numbers it would take if you
    could choose them.</p>

  <div id="page">
    <section class="card">
      <h2>Rolling at random</h2>
      <p class="small">Simulated by drawing from the badges' real earner sets, not from independent
        odds: a family's members mostly arrive on the same number, and pretending otherwise gets this
        badly wrong. <span id="rareinfo" class="muted"></span></p>
      <div class="tiles" id="done"></div>
      <div id="dhist"></div>
      <div id="dhistax"></div>
    </section>

    <section class="card">
      <h2>The collection curve</h2>
      <p class="small">Expected distinct badges after n rolls. This one is exact - expectation is
        linear, so the dependence between badges does not matter here at all. The curve is brutal at
        the top: most of the set arrives in the first few hundred rolls, and the last few take longer
        than all the rest put together.</p>
      <div id="curve"></div>
      <div class="slider"><span class="muted">Rolls</span>
        <input id="nrolls" type="range" min="0" max="140" value="60">
        <b id="nrollsv">-</b></div>
      <div class="two">
        <div class="tiles" id="atn"></div>
        <div><h2 class="eyebrow">Probably still missing</h2><div id="missing"></div></div>
      </div>
    </section>

    <section class="card">
      <h2>The wall</h2>
      <p class="small">The badges that decide the whole thing, by how long you would wait for each on
        its own.</p>
      <div id="wall"></div>
    </section>

    <section class="card">
      <h2>If you could choose</h2>
      <p class="small">The same collection as a set cover: greedily pick the number that adds the most
        missing badges, repeat. This is an upper bound found over the sweep's per-badge examples, not a
        proof of the minimum - but the gap against rolling is the point.</p>
      <div class="tiles" id="cover"></div>
      <div id="coverlist"></div>
    </section>
  </div>

  <footer>
    The <b>expected count</b> after n rolls is the sum over badges of 1 - (1 - p)^n, computed from each
    badge's exact share of the range. The <b>completion time</b> is simulated 240 times over the numbers
    that actually carry the rare badges, so co-occurring badges arrive together the way they really do;
    badges earned by more than 2,000 numbers are left out of that simulation because they arrive within
    a few hundred rolls and never decide the finish.
  </footer>
</div>
${overlayHTML('Then simulating collections and searching for a covering set.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(collectorWorker))};
(${collectorClient.toString()})(__W, ${JSON.stringify(meta)}, ${JSON.stringify(pal)});`;

  return betaShell({ title: 'RNGdle - The Collector', width: '900px', slug: 'collector', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/species - the number space as a taxonomy.
//
// Two numbers with exactly the same set of badges are, to the scorer, the same thing:
// the badge set determines supersession, which determines EP, so they cannot even be
// told apart by their score. Group all 1,000,001 numbers by that set and the range
// stops being a line and becomes a population - a few enormous species covering most
// of it, a long tail of small ones, and some number of true one-of-a-kinds.
//
// Grouping is done on the raw 29-byte bitmask, hashed into buckets and compared
// byte-for-byte inside them, so nothing depends on the hash being collision-free.
// ---------------------------------------------------------------------------

function speciesWorker() {
  let bits = null, ROW = 0, N = 0, keyOf = null, species = null;

  self.onmessage = async ev => {
    const m = ev.data;
    if (m.cmd === 'find') {
      const s = species[keyOf[m.n]];
      const sample = [];
      // Walking the range for members is O(N) but only on demand, and it avoids
      // holding a member list for all 1,000,001 numbers just to show eight of them.
      for (let n = 0; n < N && sample.length < 9; n++) if (keyOf[n] === keyOf[m.n]) sample.push(n);
      self.postMessage({ type: 'found', n: m.n, size: s.count, rank: s.rank, sample });
      return;
    }
    if (m.cmd !== 'init') return;
    try {
      const swept = await betaSweep(m.origin, 0.6);
      bits = swept.bits; ROW = swept.ROW; N = swept.ep.length;

      self.postMessage({ type: 'progress', pct: 0.65, msg: 'Grouping by badge set…' });
      const buckets = new Map();                  // hash -> [species index, ...]
      const reps = [], counts = [];
      keyOf = new Int32Array(N);

      for (let n = 0; n < N; n++) {
        if ((n & 0x3ffff) === 0) self.postMessage({ type: 'progress', pct: 0.65 + 0.3 * (n / N) });
        const base = n * ROW;
        let h = 2166136261;                       // FNV-1a over the mask bytes
        for (let b = 0; b < ROW; b++) { h ^= bits[base + b]; h = Math.imul(h, 16777619); }
        h = h >>> 0;
        let list = buckets.get(h), found = -1;
        if (list) {
          outer: for (const si of list) {
            const rb = reps[si] * ROW;
            for (let b = 0; b < ROW; b++) if (bits[rb + b] !== bits[base + b]) continue outer;
            found = si; break;
          }
        } else { list = []; buckets.set(h, list); }
        if (found < 0) { found = reps.length; reps.push(n); counts.push(0); list.push(found); }
        counts[found]++;
        keyOf[n] = found;
      }

      // Rank by population, and hand back the head of the list plus the rank-size
      // curve, which is the shape that says whether this is a few big groups or a
      // genuine long tail.
      const order = Array.from(counts.keys()).sort((a, b) => counts[b] - counts[a]);
      species = new Array(reps.length);
      order.forEach((si, r) => { species[si] = { count: counts[si], rank: r + 1 }; });

      const top = order.slice(0, 40).map(si => ({ n: reps[si], count: counts[si], ep: swept.ep[reps[si]],
        badges: swept.cnt[reps[si]] }));
      const sizes = order.map(si => counts[si]);
      let singles = 0;
      for (const c of counts) if (c === 1) singles++;
      self.postMessage({ type: 'ready', total: reps.length, singles, N, top, sizes });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

function speciesClient(WORKER_SRC, TIERS) {
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  const compact = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : fmt(n);
  const tierOf = ep => { let t = TIERS[0]; for (const x of TIERS) if (ep >= x.lo) t = x; return t; };
  let W = null, D = null;

  // Rank-size on log-log: a straight line here would mean a scale-free population,
  // and the shape it actually has is the finding.
  function zipf(sizes) {
    const CW = 760, H = 260, M = { l: 52, r: 14, t: 14, b: 34 };
    const lgR = Math.log10(sizes.length), lgS = Math.log10(sizes[0]);
    const cx = r => M.l + (Math.log10(r) / lgR) * (CW - M.l - M.r);
    const cy = s => H - M.b - (Math.log10(s) / lgS) * (H - M.t - M.b);
    const pts = [];
    // One point per pixel column: 60,000 species would otherwise be 60,000 vertices.
    let last = -1;
    for (let r = 1; r <= sizes.length; r++) {
      const x = Math.round(cx(r));
      if (x === last) continue;
      last = x;
      pts.push(`${x},${cy(sizes[r - 1]).toFixed(1)}`);
    }
    const g = [];
    for (let e = 0; e <= Math.ceil(lgR); e++) {
      const x = cx(Math.pow(10, e));
      if (x > CW - M.r) continue;
      g.push(`<line class="grid" x1="${x.toFixed(1)}" y1="${M.t}" x2="${x.toFixed(1)}" y2="${H - M.b}"/>`);
      g.push(`<text class="ax" x="${x.toFixed(1)}" y="${H - M.b + 15}" text-anchor="middle">${compact(Math.pow(10, e))}</text>`);
    }
    for (let e = 0; e <= Math.ceil(lgS); e++) {
      const y = cy(Math.pow(10, e));
      if (y < M.t) continue;
      g.push(`<line class="grid" x1="${M.l}" y1="${y.toFixed(1)}" x2="${CW - M.r}" y2="${y.toFixed(1)}"/>`);
      g.push(`<text class="ax" x="${M.l - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${compact(Math.pow(10, e))}</text>`);
    }
    g.push(`<polyline class="cline" points="${pts.join(' ')}"/>`);
    $('zipf').innerHTML = `<svg viewBox="0 0 ${CW} ${H}" role="img"
      aria-label="Species population against rank, both logarithmic">${g.join('')}
      <text class="axl" x="${M.l + (CW - M.l - M.r) / 2}" y="${H - 3}" text-anchor="middle">species by rank (log)</text>
      <text class="axl" transform="translate(12 ${M.t + (H - M.t - M.b) / 2}) rotate(-90)" text-anchor="middle">numbers in it (log)</text>
    </svg>`;
  }

  function top(list) {
    $('top').innerHTML = list.map((s, i) => {
      const t = tierOf(s.ep);
      return `<a class="srow" href="/?n=${s.n}">
        <span class="sr">${i + 1}</span>
        <span class="sn">${s.n.toLocaleString()}<em>${s.badges} badge${s.badges === 1 ? '' : 's'} · ${fmt(s.ep)} EP</em></span>
        <span class="pill" style="--tc:${t.accent}">${t.label}</span>
        <span class="sc">${fmt(s.count)}<i>${(100 * s.count / D.N).toFixed(2)}%</i></span>
      </a>`;
    }).join('');
  }

  $('find-form').addEventListener('submit', e => {
    e.preventDefault();
    const n = parseInt(($('find').value || '').replace(/\D/g, ''), 10);
    if (!Number.isInteger(n) || n < 0 || n >= D.N) {
      $('found').innerHTML = '<p class="err">Give me a number from 0 to 1,000,000.</p>';
      return;
    }
    $('found').innerHTML = '<div class="loading"><span class="spinner"></span>Looking…</div>';
    W.postMessage({ cmd: 'find', n });
  });

  function found(m) {
    const others = m.sample.filter(x => x !== m.n);
    $('found').innerHTML = `
      <div class="fh"><b>${m.n.toLocaleString()}</b> belongs to species
        <b>#${fmt(m.rank)}</b> of ${fmt(D.total)}</div>
      <div class="tiles">
        <div class="stat stat-lg"><span class="k">Numbers like it</span><span class="v">${fmt(m.size)}</span>
          <span class="sub">${m.size === 1 ? 'one of a kind' : 'share its exact badge set'}</span></div>
        <div class="stat stat-lg"><span class="k">Share of the range</span><span class="v">${
          (100 * m.size / D.N).toFixed(m.size < 100 ? 5 : 3)}%</span>
          <span class="sub">scores exactly this way</span></div>
      </div>
      ${others.length ? `<div class="fsame">Same badge set: ${
        others.map(x => `<a href="/?n=${x}">${x.toLocaleString()}</a>`).join(' · ')}${
        m.size > others.length + 1 ? ` and ${fmt(m.size - others.length - 1)} more` : ''}</div>` : ''}`;
  }

  betaBoot(WORKER_SRC, m => { if (m.type === 'found') found(m); }).then(({ worker, data }) => {
    W = worker; D = data;
    $('page').classList.add('on');
    const biggest = data.top[0];
    // Number-weighted, not species-weighted: "how many numbers share YOUR badge set"
    // is the question a player has, and it is not the mean species size.
    let acc = 0, medianShare = 1;
    for (const s of data.sizes) { acc += s; if (acc >= data.N / 2) { medianShare = s; break; } }
    let half = 0, run = 0;
    while (run < data.N / 2 && half < data.sizes.length) run += data.sizes[half++];

    $('stats').innerHTML = `
      <div class="stat stat-lg"><span class="k">Distinct kinds</span><span class="v">${fmt(data.total)}</span>
        <span class="sub">badge sets across ${fmt(data.N)} numbers</span></div>
      <div class="stat stat-lg"><span class="k">One of a kind</span><span class="v">${fmt(data.singles)}</span>
        <span class="sub">${(100 * data.singles / data.N).toFixed(1)}% of all numbers score like nothing else</span></div>
      <div class="stat stat-lg"><span class="k">Biggest kind</span><span class="v">${compact(biggest.count)}</span>
        <span class="sub">numbers, out of a million - ${biggest.badges} badges each</span></div>
      <div class="stat stat-lg"><span class="k">A typical number</span><span class="v">${
        medianShare === 1 ? 'unique' : fmt(medianShare)}</span>
        <span class="sub">${medianShare === 1 ? 'the median number shares with nobody'
          : 'numbers share the median badge set'}</span></div>`;
    zipf(data.sizes);
    top(data.top);
    $('halfline').textContent =
      `It takes the ${fmt(half)} most common kinds - ${(100 * half / data.total).toFixed(0)}% of them - ` +
      `to account for half of all ${fmt(data.N)} numbers. There is no small set of common cases here: ` +
      `the badge rules are discriminating enough that most numbers really are their own thing.`;
  });
}

function renderSpecies(ctx) {
  const { CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE } = ctx;
  const tiers = CARD_TIER_NAMES.map((key, i) => ({
    label: TIER_PALETTE[key].label, accent: TIER_PALETTE[key].accent,
    lo: i === 0 ? 0 : CARD_TIERS[i - 1][0],
  }));

  const css = `
  #page { display:none; }
  #page.on { display:block; }
  #stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(180px,100%),1fr)); gap:.6rem; margin-bottom:1.2rem; }
  #stats .stat, .tiles .stat { min-width:0; overflow-wrap:anywhere; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(160px,100%),1fr)); gap:.5rem; }
  .card { margin-bottom:.9rem; }
  .card > p.small { margin:-.35rem 0 .8rem; font-size:.8rem; color:var(--muted); line-height:1.6; }
  svg { width:100%; height:auto; display:block; }
  .grid { stroke:var(--border); stroke-width:1; }
  .ax { fill:var(--faint); font-size:10px; font-family:var(--mono); }
  .axl { fill:var(--muted); font-size:11px; }
  .cline { fill:none; stroke:var(--accent); stroke-width:1.6; }

  #top { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(300px,100%),1fr)); gap:0 .8rem; }
  .srow { display:flex; align-items:center; gap:.55rem; padding:.34rem .3rem; text-decoration:none;
    border-radius:var(--r-sm); color:var(--dim); }
  .srow:hover { background:var(--surface-2); color:var(--text); }
  .srow .sr { flex:0 0 1.7rem; font-family:var(--mono); font-size:.72rem; color:var(--faint); }
  .srow .sn { flex:1; min-width:0; display:flex; flex-direction:column; font-family:var(--mono); font-size:.86rem; }
  .srow .sn em { font-style:normal; font-size:.7rem; color:var(--faint); font-family:var(--font); }
  .srow .sc { flex:0 0 auto; text-align:right; font-family:var(--mono); font-size:.8rem; }
  .srow .sc i { display:block; font-style:normal; font-size:.68rem; color:var(--faint); }

  #find-form { display:flex; gap:.5rem; margin-bottom:.8rem; }
  #find { flex:1; min-width:0; max-width:16rem; }
  .fh { font-size:.92rem; margin-bottom:.7rem; }
  .fh b { font-family:var(--mono); }
  .fsame { margin-top:.7rem; font-size:.82rem; color:var(--muted); line-height:1.8; }
  .loading { display:flex; align-items:center; gap:.6rem; color:var(--muted); font-size:.86rem; }
  #halfline { font-size:.86rem; color:var(--dim); margin:.8rem 0 0; }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Species <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">Two numbers with the same badges are the same thing to the scorer. Grouped that way,
    the range turns into a population.</p>

  <div id="page">
    <div id="stats"></div>

    <section class="card">
      <h2>Rank against size</h2>
      <p class="small">Every distinct badge set, ordered by how many numbers carry it, on log axes. A
        straight line would mean the population is scale-free - each kind a fixed fraction of the one
        above it.</p>
      <div id="zipf"></div>
      <p id="halfline"></p>
    </section>

    <section class="card">
      <h2>Find a number's kind</h2>
      <p class="small">How many other numbers score exactly the same way, and which ones.</p>
      <form id="find-form"><input id="find" type="text" inputmode="numeric" placeholder="e.g. 123456"
        autocomplete="off"><button type="submit" class="btn-primary btn-sm">Look up</button></form>
      <div id="found"></div>
    </section>

    <section class="card">
      <h2>The commonest kinds</h2>
      <p class="small">Ranked by population, each shown by its lowest member. Every number in a kind
        scores identically, so the EP beside each one is the EP of all of them.</p>
      <div id="top"></div>
    </section>
  </div>

  <footer>
    Numbers are grouped on the raw earned-badge bitmask, before supersession - which is the right
    granularity, because the badge set is what determines supersession, and therefore EP. Sets are
    hashed into buckets and then compared byte for byte inside them, so a hash collision cannot merge
    two kinds. <b>One of a kind</b> counts numbers whose badge set no other number in the range has.
  </footer>
</div>
${overlayHTML('Then grouping all 1,000,001 numbers by their exact badge set.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(speciesWorker))};
(${speciesClient.toString()})(__W, ${JSON.stringify(tiers)});`;

  return betaShell({ title: 'RNGdle - Species', width: '900px', slug: 'species', css, body, script });
}

// ---------------------------------------------------------------------------
// Route dispatch
// ---------------------------------------------------------------------------

/**
 * Handle a /beta[/slug] request. Returns an HTML string, or null if the path is
 * not a beta route (so the caller can fall through to its 404).
 *
 * @param {string} path   url.pathname
 * @param {object} ctx    server data the tools render from - see betaCtx() in index.js
 */
export function handleBeta(path, ctx) {
  if (path === '/beta' || path === '/beta/') return renderBetaIndex();
  if (!path.startsWith('/beta/')) return null;
  const slug = path.slice(6).replace(/\/$/, '');
  if (!TOOL_BY_SLUG.has(slug) || !RENDERERS[slug]) return null;
  return RENDERERS[slug](ctx);
}

// slug -> renderer. Every entry must have a matching BETA_TOOLS record (that is what
// puts it on the index and makes the route resolve).
const RENDERERS = {
  atlas: renderAtlas,
  pairs: renderPairs,
  economy: renderEconomy,
  spectrum: renderSpectrum,
  oracle: renderOracle,
  luck: renderLuck,
  collector: renderCollector,
  species: renderSpecies,
};
