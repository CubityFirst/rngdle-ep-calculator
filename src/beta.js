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

export const BETA_TOOLS = [
  {
    slug: 'atlas', title: 'EP Atlas', kind: '3D',
    blurb: 'The whole number line as terrain. 1,000,000 numbers laid out 1000x1000, ' +
      'height and colour from EP - the scoring landscape as a place you can fly over.',
    note: 'WebGL2 - orbit, zoom, click to land on a number.',
  },
  {
    slug: 'pairs', title: 'Badge Affinity', kind: 'Matrix',
    blurb: 'Which badges travel together. A 230x230 co-occurrence matrix over every ' +
      'number, plus the conditional odds - given this badge, what else did you get?',
    note: 'Lift, P(B|A) and Jaccard, orderable by family or by cluster.',
  },
  {
    slug: 'economy', title: 'Badge Economy', kind: 'Report',
    blurb: 'Is every badge priced correctly? Plots what each badge pays against how ' +
      'rare it actually is, and ranks the biggest over- and under-payers.',
    note: 'Also measures the supersession tax - EP earned but never scored.',
  },
  {
    slug: 'spectrum', title: 'Badge Spectrum', kind: '2D',
    blurb: 'Every badge as a density stripe across the full range. Periodic rules ' +
      'show up as banding, digit-length rules as hard steps.',
    note: '230 stripes, sortable, with a zoomable readout.',
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

  /* One-time sweep overlay. Identical on every tool so the wait always looks the same. */
  .ov { position:fixed; inset:0 0 0 var(--rail-w); z-index:30; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:.9rem; background:var(--bg); text-align:center; padding:1rem; }
  .ov h2 { margin:0; font-size:1rem; font-weight:600; }
  .ov .progress { width:min(340px, 70vw); }
  .ov p { margin:0; color:var(--muted); font-size:.82rem; max-width:34rem; }
  .ov.done { display:none; }

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
  return `<div class="ov" id="ov">
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
function betaBoot(workerSrc, onMsg) {
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
    w.postMessage({ cmd: 'init', origin: location.origin });
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
  #cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(330px, 1fr)); gap:.8rem; }
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
  let CELL = 3, PAD = 0;

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
    const avail = Math.max(240, Math.min(inner, 760));
    CELL = Math.max(2, Math.floor((avail - BAND - 2) / B));
    const side = B * CELL, total = side + BAND + 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = total * dpr; cv.height = total * dpr;
    cv.style.width = total + 'px'; cv.style.height = total + 'px';
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
    const x = ev.clientX - r.left - PAD, y = ev.clientY - r.top - PAD;
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
  @media (max-width:1000px) { .cols { grid-template-columns:1fr; } }

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
  .sh-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:.4rem; }
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
  pairs: renderPairs,
};
