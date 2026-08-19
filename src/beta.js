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
    slug: 'atlas', see: ['projections', 'spectrum'], title: 'EP Atlas', kind: '3D',
    blurb: 'The whole number line as terrain. 1,000,000 numbers laid out 1000x1000, ' +
      'height and colour from EP - the scoring landscape as a place you can fly over.',
    note: 'WebGL2 - orbit, zoom, click to land on a number.',
  },
  {
    slug: 'projections', see: ['atlas', 'species'], title: 'Projections', kind: '2D',
    blurb: 'The same million numbers laid out five different ways, morphing between ' +
      'them - because the layout decides which structure you can see at all.',
    note: 'WebGL2 point cloud; every layout computed in the vertex shader.',
  },
  {
    slug: 'spectrum', see: ['contact', 'pairs'], title: 'Badge Spectrum', kind: '2D',
    blurb: 'Every badge as a density stripe across the full range. Digit-length rules ' +
      'step at each power of ten, modular rules band, exact badges are one lit pixel.',
    note: '230 stripes, orderable by how evenly each rule is spread.',
  },
  {
    slug: 'contact', see: ['spectrum', 'pairs'], title: 'Contact Sheet', kind: '2D',
    blurb: 'Every badge map on one page. Rules with the same geometry are obvious ' +
      'side by side, and the odd one out in a family jumps straight out.',
    note: '230 thumbnails of the /grid frame, ordered by family.',
  },
  {
    slug: 'pairs', see: ['contact', 'species'], title: 'Badge Affinity', kind: 'Matrix',
    blurb: 'Which badges travel together. A 230x230 co-occurrence matrix over every ' +
      'number, plus the conditional odds - given this badge, what else did you get?',
    note: 'Lift, P(B|A) and Jaccard, orderable by family or by cluster.',
  },
  {
    slug: 'anatomy', see: ['oracle', 'economy'], title: 'Anatomy', kind: 'Report',
    blurb: 'Which plain properties of a number actually move its score - digit sum, ' +
      'repeats, runs, divisibility - and which sound like they should and do not.',
    note: 'Ten properties, every one measured as lift against the range average.',
  },
  {
    slug: 'oracle', see: ['nearmiss', 'anatomy'], title: 'Digit Oracle', kind: 'Interactive',
    blurb: 'Half a number is already worth something. Lock any digits and every ' +
      'remaining choice is re-scored against the numbers that still match.',
    note: 'Mean EP behind all 60 digit-position choices, conditional on what you know.',
  },
  {
    slug: 'nearmiss', see: ['oracle', 'atlas'], title: 'Near Misses', kind: 'Interactive',
    blurb: 'Every number has exactly 54 neighbours one digit away. See what each of ' +
      'them would have scored, and which ordinary numbers sit next to a fortune.',
    note: 'Peaks, valleys, and how much of the range is one digit from a mythic.',
  },
  {
    slug: 'collection', see: ['collector', 'luck'], title: 'Your Collection', kind: 'Player',
    blurb: 'Which of the 230 badges you actually have, which you do not, and how long ' +
      'the ones you are missing would realistically take to turn up.',
    note: 'The one tool here that needs no sweep - it loads instantly.',
  },
  {
    slug: 'boxes', see: ['collection', 'luck'], title: 'Box Lab', kind: 'Design',
    blurb: 'Every coloured box rngdle.com knows how to draw, with your number in all of ' +
      'them at once - then the same boxes in words and colours of your own.',
    note: 'Tier colours, keyframes and card recipes read out of the live stylesheet.',
  },
  {
    slug: 'luck', see: ['collector', 'species'], title: 'Luck Lab', kind: 'Odds',
    blurb: 'What a roll is worth before you make it. Exact tier odds, what your best ' +
      'should look like after N rolls, and how lucky a real player actually got.',
    note: 'Closed-form best-of-N off the exact score distribution - nothing simulated.',
  },
  {
    slug: 'collector', see: ['luck', 'economy'], title: 'The Collector', kind: 'Odds',
    blurb: 'How many rolls to earn all 230 badges - simulated over the real earner ' +
      'sets - against how few numbers would do it if you could pick them.',
    note: 'Exact collection curve, plus a greedy cover of the whole badge list.',
  },
  {
    slug: 'economy', see: ['collector', 'pairs'], title: 'Badge Economy', kind: 'Report',
    blurb: 'Every badge turns out to be priced at exactly 100 / its own odds, so all ' +
      '230 are worth the same per roll. Only supersession breaks the tie.',
    note: 'The price law, and what families cost in EP that is earned but never paid.',
  },
  {
    slug: 'species', see: ['pairs', 'nearmiss'], title: 'Species', kind: 'Report',
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
  .tool-back:hover { color:var(--text); border-color:var(--border-3); }

  /* Related tools, appended to every document-shell page by betaShell. */
  .tool-more { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem;
    margin-top:1.6rem; padding-top:1rem; border-top:1px solid var(--border); }
  .tool-more > span { font-size:.72rem; letter-spacing:.08em; text-transform:uppercase;
    color:var(--faint); font-weight:600; margin-right:.2rem; }
  .tool-more a { display:inline-flex; flex-direction:column; gap:.1rem; padding:.5rem .8rem;
    text-decoration:none; border:1px solid var(--border-2); border-radius:var(--r-ctl);
    background:var(--surface); color:var(--text); font-size:.85rem; font-weight:500; }
  .tool-more a:hover { border-color:var(--accent); background:var(--surface-2); }
  .tool-more a em { font-style:normal; font-size:.72rem; color:var(--muted); font-weight:400; }`;

/**
 * Wrap a beta tool in the site shell.
 * Same options as pageShell, plus `slug` (marks the current tool, adds the back link).
 *
 * The `__name` shim is not optional. Every tool ships its client to the browser as
 * `fn.toString()`, and when this Worker is bundled for deploy (esbuild keepNames) that
 * source comes out full of `__name(f, "f")` calls - a helper that exists only in the
 * bundle's own scope. Unbundled, as `node serve.mjs` runs it, the source is clean and
 * everything works; bundled, every page would throw "__name is not defined". Same
 * reason /grid and /chains carry it, and workerSrc() adds it for the worker half.
 */
function betaShell(o) {
  const tool = o.slug ? TOOL_BY_SLUG.get(o.slug) : null;
  // Related tools, on the document pages only: the full-bleed canvas ones have no
  // document flow to put a strip in, and their HUD already carries the way back.
  const more = tool && tool.see && !o.full ? `\n<div class="wrap"><nav class="tool-more">
  <span>See also</span>
  ${tool.see.map(s => TOOL_BY_SLUG.get(s)).filter(Boolean).map(t =>
    `<a href="/beta/${t.slug}">${t.title}<em>${t.kind}</em></a>`).join('\n  ')}
  <a href="/beta">All ${BETA_TOOLS.length} tools<em>Beta lab</em></a>
</nav></div>` : '';

  return pageShell({
    ...o,
    nav: 'beta',
    noindex: true,
    css: `${BETA_CSS}\n${o.css || ''}`,
    body: o.body + more,
    script: o.script ? `var __name = (f) => f;\n${o.script}` : o.script,
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
//
// On failure this reports into the overlay and never settles: there is nothing for
// the tool to carry on with, and rejecting would only add an unhandled-rejection log
// on top of the message already on screen.
function betaBoot(workerSrc, onMsg, init) {
  const ov = document.getElementById('ov');
  const bar = document.getElementById('ovbar');
  const head = document.getElementById('ovhead');
  const text = document.getElementById('ovtext');
  const url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
  const w = new Worker(url, { type: 'module' });
  URL.revokeObjectURL(url);
  return new Promise(resolve => {
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
      w.terminate();
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
  contact: `<rect x="4" y="5" width="16" height="13" rx="1.5" opacity=".9"/>
    <rect x="24" y="5" width="16" height="13" rx="1.5" opacity=".45"/>
    <rect x="44" y="5" width="16" height="13" rx="1.5" opacity=".7"/>
    <rect x="4" y="22" width="16" height="13" rx="1.5" opacity=".5"/>
    <rect x="24" y="22" width="16" height="13" rx="1.5" opacity=".85"/>
    <rect x="44" y="22" width="16" height="13" rx="1.5" opacity=".35"/>`,
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
  projections: `<circle cx="6" cy="8" r="1.8"/><circle cx="14" cy="8" r="1.8"/><circle cx="22" cy="8" r="1.8"/>
    <circle cx="6" cy="20" r="1.8"/><circle cx="14" cy="20" r="1.8"/><circle cx="22" cy="20" r="1.8"/>
    <circle cx="6" cy="32" r="1.8"/><circle cx="14" cy="32" r="1.8"/><circle cx="22" cy="32" r="1.8"/>
    <path d="M29 20h6m-2.5-2.5L35 20l-2.5 2.5" opacity=".6"/>
    <path d="M42 34c0-9 4-9 4-16s5-9 12-9" opacity=".35"/>
    <circle cx="42" cy="34" r="1.8"/><circle cx="43.5" cy="26" r="1.8"/><circle cx="46" cy="18" r="1.8"/>
    <circle cx="48" cy="11" r="1.8"/><circle cx="54" cy="9" r="1.8"/><circle cx="60" cy="9" r="1.8"/>`,
  spectrum: `<path d="M4 8h56M4 14h56M4 20h56M4 26h56M4 32h56" stroke-dasharray="2 5" opacity=".9"/>
    <path d="M4 11h56M4 17h56M4 23h56M4 29h56" stroke-dasharray="7 3" opacity=".35"/>`,
  species: `<circle cx="14" cy="20" r="10" opacity=".9"/><circle cx="33" cy="20" r="6" opacity=".6"/>
    <circle cx="45" cy="20" r="4" opacity=".45"/><circle cx="53" cy="20" r="2.5" opacity=".35"/>
    <circle cx="59" cy="20" r="1.5" opacity=".25"/>`,
  collector: `<path d="M4 34 C 20 34, 26 12, 40 8 S 56 5, 60 5"/>
    <circle cx="16" cy="29" r="2.2" opacity=".6"/><circle cx="28" cy="17" r="2.2" opacity=".8"/>
    <circle cx="44" cy="7" r="2.2"/><path d="M4 34h56" opacity=".25"/>`,
  nearmiss: `<circle cx="32" cy="20" r="5.5"/>
    <path d="M32 14.5V7M32 25.5V33M26.5 20H17M37.5 20H47" opacity=".35"/>
    <circle cx="32" cy="5" r="2.2" opacity=".8"/><circle cx="32" cy="35" r="2.2" opacity=".5"/>
    <circle cx="15" cy="20" r="2.2" opacity=".5"/><circle cx="49" cy="20" r="2.2" opacity=".8"/>
    <circle cx="20" cy="8" r="1.8" opacity=".35"/><circle cx="44" cy="32" r="1.8" opacity=".35"/>
    <circle cx="44" cy="8" r="1.8" opacity=".35"/><circle cx="20" cy="32" r="1.8" opacity=".35"/>`,
  collection: `<rect x="6" y="5" width="10" height="10" rx="2.5"/><path d="M8.5 10l2 2 3.5-4"/>
    <path d="M22 10h34" opacity=".8"/>
    <rect x="6" y="19" width="10" height="10" rx="2.5"/><path d="M8.5 24l2 2 3.5-4"/>
    <path d="M22 24h26" opacity=".8"/>
    <rect x="6" y="33" width="10" height="10" rx="2.5" opacity=".35"/>
    <path d="M22 38h20" opacity=".3"/>`,
  luck: `<path d="M4 34 C 14 34, 18 30, 22 20 S 28 4, 33 4 S 40 12, 45 22 S 54 34, 60 34"/>
    <path d="M45 34v-8M52 34v-4" opacity=".45"/>`,
  anatomy: `<path d="M6 8h40M6 15h28M6 22h48M6 29h16" stroke-width="5" stroke-linecap="round"/>
    <path d="M56 6v28" opacity=".3" stroke-dasharray="3 3"/>`,
  oracle: `<rect x="4" y="6" width="10" height="28" rx="2" opacity=".3"/>
    <rect x="17" y="6" width="10" height="28" rx="2" opacity=".95"/>
    <rect x="30" y="6" width="10" height="28" rx="2" opacity=".3"/>
    <rect x="43" y="6" width="10" height="28" rx="2" opacity=".55"/>
    <path d="M19 13h6M19 20h6M19 27h6" opacity=".9"/>`,
};

// Things the tools turned up that are not visible anywhere else on the site. Every
// one is a measurement, not a constant - the tool named beside it recomputes it from
// the live rules on every visit, so if a rebalance moves one, the page will say so
// rather than these going quietly stale.
const FINDINGS = [
  ['Every badge is priced at exactly 100 / its own odds', 'so all 230 are worth the same 100 EP per ' +
    'roll in expectation. A mythic is no better value than a common, it just arrives less often.', 'economy'],
  ['46% of numbers score like nothing else in the range', 'no other number earns the same set of ' +
    'badges. The rules are far more discriminating than they look.', 'species'],
  ['28% of the range is one digit away from a mythic', 'and only 4,736 numbers beat all 54 of the ' +
    'neighbours one digit change can reach.', 'nearmiss'],
  ['Earning every badge takes about 4 million rolls', 'or 62 numbers, if you were allowed to pick ' +
    'them. Thirty-two badges are earned by exactly one number in the whole range.', 'collector'],
  ['The card tiers are cut at round percentiles, not round scores', 'top 1%, next 4%, next 5%, ' +
    'next 15% - which is why the EP thresholds themselves look so arbitrary.', 'luck'],
  ['Supersession quietly destroys 6.3% of all EP', 'a third of it inside the Power family alone, ' +
    'and two badges are outranked on every single number that earns them.', 'economy'],
  ['A rare number is not one that collected more badges', 'it is one that collected a single rare ' +
    'badge. That badge is 16% of a trash score and 81% of a mythic one.', 'economy'],
];

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
  #cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(330px,100%),1fr));
    gap:.8rem; margin-top:1.3rem; }
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

  .finds { margin-top:2rem; }
  .finds h2 { font-size:.78rem; font-weight:700; letter-spacing:.09em; text-transform:uppercase;
    color:var(--muted); margin:0 0 .4rem; }
  .finds ol { list-style:none; margin:0; padding:0; display:grid;
    grid-template-columns:repeat(auto-fill, minmax(min(330px,100%),1fr)); gap:.6rem; }
  .finds li { display:flex; flex-direction:column; gap:.25rem; padding:.75rem .9rem;
    border:1px solid var(--border); border-left:3px solid var(--hl); border-radius:var(--r-card);
    background:var(--surface); }
  .finds li b { font-size:.88rem; font-weight:600; line-height:1.4; }
  .finds li span { font-size:.8rem; color:var(--muted); line-height:1.55; }
  .finds li a { margin-top:auto; padding-top:.35rem; font-size:.76rem; text-decoration:none; }
  .finds li a:hover { text-decoration:underline; }`;

  const body = `<div class="wrap">
  <h1>Beta lab <span class="beta-tag">experimental</span></h1>
  <p class="tag">Data-vis and insight tools built on the full 1,000,001-number sweep.</p>

  <div id="cards">${cards}</div>

  <section class="finds">
    <h2>Some insights</h2>
    <ol>${FINDINGS.map(([head, body, slug]) => `<li>
      <b>${head}</b><span>${body}</span>
      <a href="/beta/${slug}">${BETA_TOOLS.find(t => t.slug === slug).title} &rarr;</a>
    </li>`).join('')}</ol>
  </section>

  <footer>
    <b>Beta</b> - these are experiments. Layout, names and routes may change.
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
  // Kept after the sweep so a badge overlay can be cut on demand: the bitmask is ~29MB
  // and belongs here, not on the page, which only ever needs one badge at a time.
  let BITS = null, ROW = 0;

  self.onmessage = async ev => {
    if (ev.data.cmd === 'badge') {
      const i = ev.data.i, N = 1000000, byte = i >> 3, bit = 1 << (i & 7);
      const mask = new Uint8Array(N);
      for (let n = 0; n < N; n++) mask[n] = (BITS[n * ROW + byte] & bit) ? 1 : 0;
      self.postMessage({ type: 'mask', i, mask: mask.buffer }, [mask.buffer]);
      return;
    }
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.9);
      BITS = swept.bits; ROW = swept.ROW;
      // The square face of the range is 0..999,999; 1,000,000 is the one 7-digit roll
      // and has no cell, exactly as on /grid.
      const N = 1000000;
      self.postMessage({ type: 'progress', pct: 0.92, msg: 'Building the height field…' });

      // Float64, not Float32: EP runs to nine figures and a 24-bit mantissa cannot hold
      // it, so 186,186,584 comes back as 186,186,592. The height texture is built from
      // this in the page and can be Float32 - rendering does not care - but the numbers
      // shown in the readout and the peaks list have to be the real ones.
      const ep = new Float64Array(N);
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
function atlasClient(WORKER_SRC, TIERS, LABELS) {
  const $ = id => document.getElementById(id);
  const SIDE = 1000;                                  // cells per side at full detail
  const cv = $('gl');
  const gl = cv.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
  if (!gl) {
    $('ovhead').textContent = 'WebGL2 not available';
    $('ovtext').textContent = 'This tool needs WebGL2. Everything else in the lab works without it.';
    return;
  }

  let EP = null, CNT = null, MAXEP = 1, PEAKS = [], W = null;
  let MASK = null, maskBadge = -1;               // badge overlay, or null for none
  let S = 1000, mode = 0, exag = 1, hsrc = 'log', showGrid = true;
  let mesh = null, tex = null, prog = null, vao = null, uni = {};
  let sel = -1;

  // --- shaders -----------------------------------------------------------
  const VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform mat4 uMVP;
uniform sampler2D uT;        // (height 0..1, EP, badge count, -)
uniform int uS;
uniform float uY;            // vertical exaggeration, in world units
out float vH; out float vEP; out float vC; out float vA; out vec2 vUV; out vec3 vN; out vec3 vP;
float hAt(ivec2 p) { return texelFetch(uT, clamp(p, ivec2(0), ivec2(uS - 1)), 0).r; }
void main() {
  int gx = gl_VertexID % uS, gy = gl_VertexID / uS;
  vec4 t = texelFetch(uT, ivec2(gx, gy), 0);
  vH = t.r; vEP = t.g; vC = t.b; vA = t.a;
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
in float vH; in float vEP; in float vC; in float vA; in vec2 vUV; in vec3 vN; in vec3 vP;
uniform vec3 uTier[7];
uniform float uCut[6];
uniform int uMode;           // 0 tier, 1 height ramp, 2 badge count
uniform float uMaxC;
uniform int uGrid;
uniform int uS;
uniform vec3 uEye;
uniform vec2 uSel;           // selected cell, or (-1,-1)
uniform int uMark;           // 1 when a badge overlay is loaded
uniform vec3 uMarkCol;
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
  // Badge overlay: everything that does not earn it drops to a desaturated grey, so
  // the ones that do read as the only thing on the map with any colour in it.
  if (uMark == 1) {
    float g = dot(base, vec3(.299, .587, .114));
    base = vA > 0.5 ? uMarkCol : vec3(g * .38);
  }
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
in vec2 vUV; in float vH; in float vEP; in float vC; in float vA; in vec3 vN; in vec3 vP;
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
        let best = 0, bc = 0, mark = 0;
        for (let dy = 0; dy < step; dy++) {
          const row = (y * step + dy) * SIDE + x * step;
          for (let dx = 0; dx < step; dx++) {
            const v = EP[row + dx];
            if (v > best) { best = v; bc = CNT[row + dx]; }
            // Height and colour pool by peak; the overlay pools by "any", or a badge
            // earned by one number in a block would vanish at anything below full detail.
            if (MASK && MASK[row + dx]) mark = 1;
          }
        }
        const k = (y * S + x) * 4;
        data[k] = height(best, bc);
        data[k + 1] = best; data[k + 2] = bc; data[k + 3] = mark;
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
    gl.uniform1i(uni.mark, MASK ? 1 : 0);
    gl.uniform3f(uni.markCol, 0.94, 0.62, 0.33);
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
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer */ }
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
  $('badge').addEventListener('change', e => {
    const i = LABELS.indexOf(e.target.value);
    history.replaceState(null, '', i < 0 ? location.pathname : '?badge=' + encodeURIComponent(LABELS[i]));
    if (i < 0) {
      MASK = null; maskBadge = -1;
      $('badgenote').textContent = '';
      buildTexture(); render();
      return;
    }
    if (i === maskBadge) return;
    maskBadge = i;
    $('badgenote').textContent = 'Loading…';
    W.postMessage({ cmd: 'badge', i });
  });
  $('badgeclear').addEventListener('click', () => {
    $('badge').value = '';
    $('badge').dispatchEvent(new Event('change'));
  });
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
  betaBoot(WORKER_SRC, m => {
    if (m.type !== 'mask' || m.i !== maskBadge) return;
    MASK = new Uint8Array(m.mask);
    let lit = 0;
    for (let n = 0; n < MASK.length; n++) if (MASK[n]) lit++;
    $('badgenote').textContent = `${lit.toLocaleString()} numbers · ${
      (100 * lit / MASK.length).toFixed(lit < 1000 ? 4 : 2)}% of the map`;
    buildTexture(); render();
  }).then(({ worker, data }) => {
    W = worker;
    EP = new Float64Array(data.ep); CNT = new Uint8Array(data.cnt);
    MAXEP = data.max; PEAKS = data.peaks;

    prog = link(VS, FS);
    pickProg = link(VS, PICK_FS);
    vao = gl.createVertexArray();
    uni = {
      mode: gl.getUniformLocation(prog, 'uMode'), grid: gl.getUniformLocation(prog, 'uGrid'),
      maxc: gl.getUniformLocation(prog, 'uMaxC'), eye: gl.getUniformLocation(prog, 'uEye'),
      sel: gl.getUniformLocation(prog, 'uSel'), mark: gl.getUniformLocation(prog, 'uMark'),
      markCol: gl.getUniformLocation(prog, 'uMarkCol'),
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
    const want = new URLSearchParams(location.search).get('badge');
    if (want && LABELS.includes(want)) {
      $('badge').value = want;
      $('badge').dispatchEvent(new Event('change'));
    }
  });
}

function renderAtlas(ctx) {
  const { BADGES, CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE, esc } = ctx;
  const LABELS = BADGES.map(b => b[1]);
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
  .badgerow { display:flex; gap:5px; }
  #badge { flex:1; min-width:0; font-size:12px; padding:.35rem .45rem; background:rgba(255,255,255,.06);
    border-color:rgba(255,255,255,.14); }
  #badgeclear { flex:0 0 auto; padding:.35rem .5rem; font-size:13px; color:var(--muted);
    background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.14); }
  #badgenote { font-size:11px; color:var(--hl-lt); font-family:var(--mono); min-height:1.1em; }
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
  <div class="ctl"><span>Light up a badge</span>
    <div class="badgerow">
      <input id="badge" list="badgelist" type="text" placeholder="any badge…" autocomplete="off">
      <button type="button" id="badgeclear" title="Clear the overlay">&times;</button>
    </div>
    <div id="badgenote"></div>
  </div>
  <datalist id="badgelist">${LABELS.map(l => `<option value="${esc(l)}"></option>`).join('')}</datalist>
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
(${atlasClient.toString()})(__W, ${JSON.stringify(tiers)}, ${JSON.stringify(LABELS)});`;

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
      // With price flat at 100/P, a badge's EP is just its rarity, so a number's score
      // should be dominated by the single rarest badge it earns. Measure it: the share
      // of each number's EP that comes from its biggest scorer.
      const DOM = 20;
      const domHist = new Float64Array(DOM);
      let domSum = 0, domN = 0;
      // Split by card tier as well: the interesting part turned out not to be the
      // average but how sharply it changes as a number gets rarer.
      const CUTS = ev.data.cuts, NT = CUTS.length + 1;
      const tierSum = new Float64Array(NT), tierN = new Float64Array(NT);

      for (let n = 0; n < N; n++) {
        if ((n & 0x3ffff) === 0) {
          self.postMessage({ type: 'progress', pct: 0.6 + 0.4 * (n / N), msg: 'Measuring what each badge really pays…' });
        }
        const k = betaEarned(bits, n * ROW, ROW, idx);
        top.fill(-1);
        let tot = 0, mx = 0;
        for (let a = 0; a < k; a++) {
          const i = idx[a];
          earn[i]++;
          const f = FAM[i];
          if (f < 0) { score[i]++; tot += EP[i]; if (EP[i] > mx) mx = EP[i]; continue; }
          // Strict >, so the first of an EP tie wins - the same rule compute() uses.
          if (top[f] < 0 || EP[i] > EP[top[f]]) top[f] = i;
        }
        for (let f = 0; f < nFam; f++) {
          if (top[f] < 0) continue;
          score[top[f]]++;
          tot += EP[top[f]];
          if (EP[top[f]] > mx) mx = EP[top[f]];
        }
        if (tot > 0) {
          const share = mx / tot;
          domSum += share; domN++;
          domHist[Math.min(DOM - 1, (share * DOM) | 0)]++;
          let ti = 0;
          while (ti < CUTS.length && tot >= CUTS[ti]) ti++;
          tierSum[ti] += share; tierN[ti]++;
        }
      }
      self.postMessage({ type: 'ready', earn: earn.buffer, score: score.buffer, N,
        domHist: Array.from(domHist), domMean: domN ? domSum / domN : 0, domN,
        tierShare: Array.from(tierSum, (v, i) => tierN[i] ? v / tierN[i] : 0),
        tierN: Array.from(tierN) },
        [earn.buffer, score.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

// META[i] = [label, emoji, ep, tier, familyIndex, id]; PAL = tier -> accent.
function economyClient(WORKER_SRC, META, FAMS, PAL, TIERS) {
  const CUTS = TIERS.slice(1).map(t => t.lo);
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
    // Two very different reasons a badge can never pay, and only one of them costs
    // anything: losing to a BIGGER sibling forfeits the difference, whereas losing a
    // TIE is pure bookkeeping - the same EP is still awarded, under the other name.
    $('dead').innerHTML = dead.length
      ? dead.map(r => {
        const mine = META[r.i][2], fam = META[r.i][4];
        let best = null;
        for (let j = 0; j < B; j++) {
          if (j === r.i || META[j][4] !== fam) continue;
          if (!best || META[j][2] > META[best][2]) best = j;
        }
        const tied = best !== null && META[best][2] === mine;
        return row(r, tied ? 'no EP lost' : fmt(mine) + ' forgone',
          best === null ? 'outranked every time'
            : tied ? `ties ${META[best][0]} at ${fmt(mine)} EP and loses the tie on list order`
              : `outranked by ${META[best][0]} at ${fmt(META[best][2])} EP`);
      }).join('')
      : '<p class="muted small">None - every badge is the top scorer of its family somewhere.</p>';
    $('deadn').textContent = dead.length;
    $('cleann').textContent = clean;
  }

  // The price law's real consequence for a player: since EP is 100/P, the rarest
  // badge on a number is worth more than everything else on it put together.
  function dominance(d) {
    const h = d.domHist, B2 = h.length;
    const mx = Math.max(...h);
    // Share of numbers whose biggest badge is most of their score.
    let over = 0, tot = 0;
    for (let i = 0; i < B2; i++) { tot += h[i]; if (i / B2 >= 0.5) over += h[i]; }
    $('domstats').innerHTML = `
      <div class="stat stat-lg"><span class="k">Typical share</span><span class="v">${
        (100 * d.domMean).toFixed(1)}%</span>
        <span class="sub">of a number's EP is its single biggest badge</span></div>
      <div class="stat stat-lg"><span class="k">Carried by one badge</span><span class="v">${
        (100 * over / tot).toFixed(1)}%</span>
        <span class="sub">of numbers get over half their score from one</span></div>
      <div class="stat stat-lg"><span class="k">At the top</span><span class="v">${
        (100 * d.tierShare[d.tierShare.length - 1]).toFixed(1)}%</span>
        <span class="sub">for ${TIERS[TIERS.length - 1].label.toLowerCase()} numbers</span></div>`;
    $('domhist').innerHTML = h.map((v, i) =>
      `<i style="height:${(100 * v / mx).toFixed(1)}%" title="${
        (100 * i / B2).toFixed(0)}-${(100 * (i + 1) / B2).toFixed(0)}%: ${
        Math.round(v).toLocaleString()} numbers"></i>`).join('');
    // The average hides the mechanism; the trend across tiers is the mechanism.
    $('domtiers').innerHTML = TIERS.map((t, i) => d.tierN[i] ? `<div class="frow">
      <span class="fl"><span class="pill" style="--tc:${t.accent}">${t.label}</span></span>
      <span class="fbar"><i style="width:${(100 * d.tierShare[i]).toFixed(1)}%;background:${t.accent}"></i></span>
      <span class="fv">${(100 * d.tierShare[i]).toFixed(0)}%</span></div>` : '').join('');
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
    const r = ROWS.find(x => x.i === Number(c.dataset.i));
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
  // The caption promises this; SVG circles are not links, so it has to be wired.
  $('chart').addEventListener('click', e => {
    const c = e.target.closest('[data-i]');
    if (c) location.href = '/badges#' + META[Number(c.dataset.i)][5];
  });

  // --- boot --------------------------------------------------------------
  const ep = Float64Array.from(META, m => m[2]);
  const fam = Int16Array.from(META, m => m[4]);
  betaBoot(WORKER_SRC, null, { ep: ep.buffer, fam: fam.buffer, cuts: CUTS }).then(({ data }) => {
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
    chart(); residualChart(); tables(); stats(totalEP); dominance(data);
    $('report').classList.add('on');
  });
}

function renderEconomy(ctx) {
  const { BADGES, FAMILIES, FAMILY_NAMES, TIER_PALETTE, CARD_TIERS, CARD_TIER_NAMES, tierFromScore } = ctx;
  const tiers = CARD_TIER_NAMES.map((key, i) => ({
    label: TIER_PALETTE[key].label, accent: TIER_PALETTE[key].accent,
    lo: i === 0 ? 0 : CARD_TIERS[i - 1][0],
  }));
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
  /* Only the points are hit targets: a tick label sitting over a circle would
     otherwise swallow the hover and the tooltip would never appear for it. */
  .grid, .ax, .axl, .fit { pointer-events:none; }
  .grid { stroke:var(--border); stroke-width:1; }
  .ax { fill:var(--faint); font-size:10px; font-family:var(--mono); }
  .axl { fill:var(--muted); font-size:11px; }
  .fit { stroke:var(--hl); stroke-width:1.4; stroke-dasharray:5 4; fill:none; }
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

  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(200px,100%),1fr)); gap:.5rem; }
  .tiles .stat { min-width:0; overflow-wrap:anywhere; }
  #domtiers { margin-top:.9rem; }
  #domtiers .fl { flex:0 0 6.4rem; }
  #domhist { display:flex; align-items:flex-end; gap:2px; height:96px; padding:.25rem; margin-top:.8rem;
    background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-sm); }
  #domhist i { flex:1; background:var(--hl); border-radius:1px 1px 0 0; min-height:1px; opacity:.85; }
  .domax { display:flex; justify-content:space-between; margin-top:.25rem; font-size:.7rem;
    color:var(--faint); }

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

    <section class="card">
      <h2>One badge decides it</h2>
      <p class="small">If price is 100 / P then a badge's EP <b>is</b> its rarity, so you would expect
        the rarest thing a number earns to swamp everything else on it. For a typical number it does
        not: the average biggest badge is only about a third of the score, because an ordinary roll
        picks up a dozen badges of much the same commonness and they add up.</p>
      <p class="small">What the average hides is how fast that changes. Split the same measure by card
        tier and the mechanism is obvious - a number is not rare because it collected more badges, it
        is rare because it collected <b>one</b> rare badge, and by the top tier that single badge is
        nearly the whole score.</p>
      <div class="tiles" id="domstats"></div>
      <div id="domtiers"></div>
      <div id="domhist"></div>
      <div class="domax"><span>none of it</span><span>half</span><span>all of it</span></div>
    </section>

    <div class="grid2">
      <section class="card"><h2>What actually varies <em>supersession</em></h2>
        <p class="small">The one thing that breaks the flat 100 EP: within a family only the
          highest-EP earned badge scores. These are earned constantly and paid rarely, so their real
          expected value per roll is well under 100 EP. <span id="cleann">-</span> badges are never
          superseded and keep the full 100.</p>
        <div id="taxed"></div></section>
      <section class="card"><h2>Never pay out <em>(<span id="deadn">-</span>)</em></h2>
        <p class="small">Earned somewhere in the range, yet beaten by a family sibling on every single
          number that earns them - so the badge itself is never the one credited. Whether that costs
          anything depends on why: a badge beaten by a <b>bigger</b> sibling forfeits its own EP, but
          one that merely <b>ties</b> and loses on list order costs nothing at all, because the same
          EP is still awarded under the sibling's name.</p>
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
    scores only when it wins its family, so a rebalance would show up here immediately. Ties inside a
    family go to whichever badge is listed first, which is what rngdle's own scorer does - so a tied
    pair always credits the same one of the two, and the other reads as never scoring even though the
    EP is paid every time.
  </footer>
</div>
${overlayHTML('Then re-running family supersession on every number to see which badges actually pay.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(economyWorker))};
(${economyClient.toString()})(__W, ${JSON.stringify(meta)}, ${JSON.stringify(FAMILY_NAMES)},
  ${JSON.stringify(pal)}, ${JSON.stringify(tiers)});`;

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
      // The runs at both ends count too: a badge that starts late or stops early has a
      // huge gap there, and those are exactly the interesting cases.
      for (let i = 0; i < B; i++) {
        if (first[i] < 0) continue;
        if (first[i] > gap[i]) gap[i] = first[i];
        if (N - 1 - last[i] > gap[i]) gap[i] = N - 1 - last[i];
      }

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

    // The stripe again, but as a profile the eye can read a shape off. The 4px inset
    // matters: a perfectly uniform badge sits at its own maximum in every block, and
    // without it that line is drawn on the border and looks like an empty chart.
    const W = 520, H = 90, PAD = 4;
    const cap = rowMax[i] || 1;
    const pts = [];
    for (let c = 0; c < BLK; c++) {
      pts.push(`${(c / (BLK - 1) * W).toFixed(1)},${(H - PAD - (D[base + c] / cap) * (H - PAD * 2)).toFixed(1)}`);
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
  cv.addEventListener('click', ev => {
    sel = rowAt(ev);
    history.replaceState(null, '', sel < 0 ? location.pathname : '#' + encodeURIComponent(META[sel][0]));
    detail(sel); draw();
  });
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
    reorder();
    const want = decodeURIComponent(location.hash.slice(1));
    const hit = want ? META.findIndex(m => m[0] === want) : -1;
    if (hit >= 0) { sel = hit; draw(); }
    detail(sel);
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
  let EP = null, CNT = null, lgMax = 1, p99 = 0, BITS = null, ROW = 0, NB = 0;

  function query(fix) {
    // Per (position, digit) accumulators for the six positions still free, plus the
    // overall stats for whatever is left after the fixed digits are applied.
    const cN = new Float64Array(60), cEP = new Float64Array(60), cTop = new Float64Array(60);
    const hist = new Float64Array(HB);
    let count = 0, sumEP = 0, sumC = 0, nTop = 0;
    let best = -1, bestEP = -1, worst = -1, worstEP = Infinity;
    const tops = [];
    // Badges every surviving number earns: start all-ones and AND each one in, which
    // answers "what do I already have, whatever the rest turns out to be".
    const sure = new Uint8Array(ROW).fill(255);

    for (let n = LO; n <= HI; n++) {
      let ok = true;
      for (let p = 0; p < 6; p++) {
        if (fix[p] >= 0 && ((n / DIV[p]) | 0) % 10 !== fix[p]) { ok = false; break; }
      }
      if (!ok) continue;
      const e = EP[n];
      count++; sumEP += e; sumC += CNT[n];
      { const base = n * ROW; for (let b = 0; b < ROW; b++) sure[b] &= BITS[base + b]; }
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
    const sureList = [];
    if (count) {
      for (let i = 0; i < NB; i++) if (sure[i >> 3] & (1 << (i & 7))) sureList.push(i);
    }
    return { type: 'q', fix, count, meanEP: count ? sumEP / count : 0, meanC: count ? sumC / count : 0,
      pTop: count ? nTop / count : 0, best, bestEP, worst, worstEP, tops, sure: sureList,
      cN: cN.buffer, cEP: cEP.buffer, cTop: cTop.buffer, hist: hist.buffer };
  }

  self.onmessage = async ev => {
    const m = ev.data;
    if (m.cmd === 'init') {
      try {
        const swept = await betaSweep(m.origin, 0.85);
        EP = swept.ep; CNT = swept.cnt; BITS = swept.bits; ROW = swept.ROW;
        NB = E.BADGE_META.length;
        self.postMessage({ type: 'progress', pct: 0.9, msg: 'Ranking the six-digit numbers…' });
        let max = 0;
        for (let n = LO; n <= HI; n++) if (EP[n] > max) max = EP[n];
        lgMax = Math.log10(1 + max);
        // The "top 1%" cutoff every cell is scored against, over six-digit numbers only.
        const sorted = Float64Array.from(EP.subarray(LO, HI + 1)).sort();
        p99 = sorted[Math.floor(sorted.length * 0.99)];
        const q = query([-1, -1, -1, -1, -1, -1]);
        self.postMessage(Object.assign({}, q, { type: 'ready', p99, max }),
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

function oracleClient(WORKER_SRC, TIERS, META, PAL) {
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  // EP runs to nine figures at the top of the range and a stat tile is 150px wide.
  const compact = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
    : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : fmt(n);
  let W = null, fix = [-1, -1, -1, -1, -1, -1], Q = null, P99 = 0, busy = false;
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

    const sure = Q.sure || [];
    $('sure').innerHTML = sure.length
      ? `<h2>Already guaranteed <em>${sure.length}</em></h2>
         <p class="muted small">Earned by every number that still matches - these are yours whatever
         the remaining digits turn out to be.</p>
         <div class="pills">${sure.slice().sort((a, b) => META[b][2] - META[a][2]).map(i =>
           `<a class="bpill" href="/badges#${META[i][5]}" style="--tc:${PAL[META[i][3]]}"
             title="${META[i][0]} · ${fmt(META[i][2])} EP">${META[i][1]} ${META[i][0]}</a>`).join('')}</div>`
      : `<h2>Already guaranteed</h2>
         <p class="muted small">Nothing yet - no badge is earned by every number that still matches.
         Lock some digits.</p>`;

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
    // Keep the locked digits in the URL so a board worth showing someone can be
    // linked to. Free positions are '.', which reads as the pattern it is.
    const pat = fix.map(d => d < 0 ? '.' : d).join('');
    history.replaceState(null, '', pat === '......' ? location.pathname : '?fix=' + pat);
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
    W = worker; Q = data; P99 = data.p99;
    $('page').classList.add('on');
    const pat = (new URLSearchParams(location.search).get('fix') || '').slice(0, 6);
    // A leading 0 has no six-digit numbers behind it, so ignore it rather than showing
    // an empty board to anyone who hand-edits the URL.
    const want = [...pat].map((c, i) => (c >= '0' && c <= '9' && !(i === 0 && c === '0')) ? +c : -1);
    if (want.length === 6 && want.some(d => d >= 0)) { fix = want; send(); }
    else { board(); summary(); }
  });
}

function renderOracle(ctx) {
  const { BADGES, CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE, tierFromScore } = ctx;
  const meta = BADGES.map(([id, label, emoji, ep]) => [label, emoji, ep, tierFromScore(ep), -1, id]);
  const pal = Object.fromEntries(Object.entries(TIER_PALETTE).map(([k, v]) => [k, v.accent]));
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
  .small { font-size:.78rem; line-height:1.5; margin:-.35rem 0 .6rem; }
  #sure h2 em { font-style:normal; font-weight:500; letter-spacing:0; text-transform:none;
    color:var(--faint); font-family:var(--mono); }
  .pills { display:flex; flex-wrap:wrap; gap:.3rem; }
  .bpill { font-size:.74rem; text-decoration:none; padding:.2rem .5rem; border-radius:var(--r-pill);
    color:var(--text); background:color-mix(in srgb, var(--tc) 12%, var(--surface-2));
    border:1px solid color-mix(in srgb, var(--tc) 40%, transparent); white-space:nowrap; }
  .bpill:hover { background:color-mix(in srgb, var(--tc) 26%, var(--surface-2)); }`;

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
        <section class="card" id="sure"></section>
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
(${oracleClient.toString()})(__W, ${JSON.stringify(tiers)}, ${JSON.stringify(meta)}, ${JSON.stringify(pal)});`;

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
  // Two independent readings of the same set: how good the single best roll was among
  // players with that many rolls, and whether the whole set drifted high or low
  // (percentiles are uniform, so their mean has a known spread).
  function score(nums) {
    const valid = nums.filter(n => Number.isInteger(n) && n >= 0 && n < N);
    if (!valid.length) return null;
    const rows = valid.map(n => ({ n, ep: EP[n], p: cdf(EP[n]) })).sort((a, b) => b.ep - a.ep);
    const k = rows.length;
    const best = rows[0];
    const beatShare = Math.pow(best.p, k);
    const meanP = rows.reduce((s, r) => s + r.p, 0) / k;
    return { rows, k, best, beatShare, meanP,
      z: (meanP - 0.5) / Math.sqrt(1 / 12 / k), par: bestAt(k, 0.5) };
  }
  const verdictOf = b => b >= 0.999 ? 'extraordinary' : b >= 0.99 ? 'very lucky'
    : b >= 0.75 ? 'lucky' : b >= 0.25 ? 'about par' : b >= 0.01 ? 'unlucky' : 'brutal';

  function analyse(nums, label) {
    const st = score(nums);
    if (!st) {
      $('verdict').innerHTML = '<p class="err">No usable numbers - give me integers from 0 to 1,000,000.</p>';
      return;
    }
    const { rows, k, best, beatShare, meanP, z, par } = st;
    const verdict = verdictOf(beatShare);

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
  async function loadPlayer(u) {
    const r = await fetch('/api/profile?u=' + encodeURIComponent(u));
    const d = await r.json();
    if (!r.ok || !d.scored) throw new Error(d.error || `could not load ${u}`);
    return { username: d.username || u, nums: d.scored.map(x => x.number) };
  }

  // Several names rank the players against each other rather than pooling their rolls:
  // pooling is what /u already does, and "who got luckier" only means anything per
  // player anyway.
  async function compare(names) {
    const loaded = await Promise.all(names.map(u =>
      loadPlayer(u).then(p => ({ ...p, st: score(p.nums) })).catch(e => ({ username: u, error: e.message }))));
    const ok = loaded.filter(p => p.st).sort((a, b) => b.st.beatShare - a.st.beatShare);
    const bad = loaded.filter(p => !p.st);
    if (!ok.length) {
      $('verdict').innerHTML = `<p class="err">${bad.map(p => p.error).join('; ')}</p>`;
      return;
    }
    $('verdict').innerHTML = `
      <div class="vhead"><b>${ok.length} players</b><span>ranked by how lucky their best roll was</span></div>
      <div class="ctable">
        <div class="crow chead"><span>Player</span><span>Rolls</span><span>Best</span>
          <span>Luckier than</span><span>Drift</span></div>
        ${ok.map(p => `<button type="button" class="crow" data-u="${p.username}">
          <span class="cu">${p.username}</span>
          <span>${fmt(p.st.k)}</span>
          <span>${compact(p.st.best.ep)}</span>
          <span class="cl">${(100 * p.st.beatShare).toFixed(1)}%<em>${verdictOf(p.st.beatShare)}</em></span>
          <span>${p.st.z >= 0 ? '+' : ''}${p.st.z.toFixed(2)}σ</span>
        </button>`).join('')}
      </div>
      <p class="muted small">Click a row for that player's full reading.</p>
      ${bad.length ? `<p class="muted small">Could not load: ${bad.map(p => p.username).join(', ')}.</p>` : ''}`;
    for (const b of $('verdict').querySelectorAll('[data-u]')) {
      b.addEventListener('click', () => {
        const p = ok.find(x => x.username === b.dataset.u);
        analyse(p.nums, p.username);
      });
    }
  }

  $('user-form').addEventListener('submit', async e => {
    e.preventDefault();
    const names = [...new Set(($('user').value.match(/[A-Za-z0-9_.-]+/g) || []))].slice(0, 6);
    if (!names.length) return;
    $('verdict').innerHTML = '<div class="loading"><span class="spinner"></span>Loading rolls…</div>';
    try {
      if (names.length > 1) { await compare(names); return; }
      const p = await loadPlayer(names[0]);
      analyse(p.nums, p.username);
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
  .loading { display:flex; align-items:center; gap:.6rem; color:var(--muted); font-size:.86rem; }
  .ctable { display:flex; flex-direction:column; gap:1px; }
  .crow { display:grid; grid-template-columns:minmax(0,1.6fr) 3.6rem 4.6rem 6.4rem 4rem;
    align-items:center; gap:.5rem; width:100%; text-align:right; padding:.4rem .5rem; font-size:.84rem;
    font-weight:400; color:var(--dim); background:transparent; border:0; border-radius:var(--r-sm);
    font-variant-numeric:tabular-nums; font-family:var(--mono); }
  .crow:hover { background:var(--surface-2); border:0; color:var(--text); }
  .crow .cu { text-align:left; font-family:var(--font); overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; }
  .crow .cl { color:var(--hl-lt); }
  .crow .cl em { display:block; font-style:normal; font-size:.68rem; color:var(--faint);
    font-family:var(--font); }
  .crow.chead { color:var(--faint); font-size:.7rem; letter-spacing:.06em; text-transform:uppercase;
    font-family:var(--font); border-bottom:1px solid var(--border); border-radius:0; }
  .crow.chead:hover { background:transparent; }
  .crow.chead > span:first-child { text-align:left; }
  @media (max-width:600px) { .crow { grid-template-columns:minmax(0,1.4fr) 4.4rem 6rem; }
    .crow > span:nth-child(2), .crow > span:nth-child(5) { display:none; } }`;

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
        exact distribution above, so nothing here is an estimate. Name several players (up to six) to
        rank them against each other instead.</p>
      <div class="inputs">
        <div><label for="user">rngdle player</label>
          <form id="user-form"><input id="user" type="text" placeholder="username, or several to compare"
            autocomplete="off"><button type="submit" class="btn-primary btn-sm">Check</button></form></div>
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

function collectorClient(WORKER_SRC, META) {
  const B = META.length;
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  const compact = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : fmt(n);
  let EARN = null, N = 0, T = null;

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
  const { BADGES, tierFromScore } = ctx;
  // Same shape as the other tools' META so the row helpers read the same, with a
  // placeholder in the family slot: this page never groups by family.
  const meta = BADGES.map(([id, label, emoji, ep]) => [label, emoji, ep, tierFromScore(ep), -1, id]);

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
(${collectorClient.toString()})(__W, ${JSON.stringify(meta)});`;

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
  let bits = null, ROW = 0, N = 0, keyOf = null, species = null, EP = null;

  self.onmessage = async ev => {
    const m = ev.data;
    if (m.cmd === 'find') {
      const s = species[keyOf[m.n]];
      const sample = [];
      // Walking the range for members is O(N) but only on demand, and it avoids
      // holding a member list for all 1,000,001 numbers just to show eight of them.
      for (let n = 0; n < N && sample.length < 9; n++) if (keyOf[n] === keyOf[m.n]) sample.push(n);
      // The badge set IS the species, so hand it back: it is the answer to "what do
      // these numbers have in common", which a count alone never tells you.
      const idx = new Int32Array(256);
      const k = betaEarned(bits, m.n * ROW, ROW, idx);
      self.postMessage({ type: 'found', n: m.n, size: s.count, rank: s.rank, sample,
        ep: EP[m.n], badges: Array.from(idx.subarray(0, k)) });
      return;
    }
    if (m.cmd !== 'init') return;
    try {
      const swept = await betaSweep(m.origin, 0.6);
      bits = swept.bits; ROW = swept.ROW; N = swept.ep.length; EP = swept.ep;

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

function speciesClient(WORKER_SRC, TIERS, META, PAL) {
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
        m.size > others.length + 1 ? ` and ${fmt(m.size - others.length - 1)} more` : ''}</div>` : ''}
      <div class="fset"><b>The set itself</b> - ${m.badges.length} badges, ${fmt(m.ep)} EP after
        supersession. This exact combination is what defines the kind.
        <div class="pills">${m.badges.slice().sort((a, b) => META[b][2] - META[a][2]).map(i =>
          `<a class="bpill" href="/badges#${META[i][5]}" style="--tc:${PAL[META[i][3]]}"
            title="${META[i][0]} · ${fmt(META[i][2])} EP">${META[i][1]} ${META[i][0]}</a>`).join('')}</div>
      </div>`;
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
  const { BADGES, CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE, tierFromScore } = ctx;
  const meta = BADGES.map(([id, label, emoji, ep]) => [label, emoji, ep, tierFromScore(ep), -1, id]);
  const pal = Object.fromEntries(Object.entries(TIER_PALETTE).map(([k, v]) => [k, v.accent]));
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
  .fset { margin-top:.9rem; padding-top:.8rem; border-top:1px solid var(--border);
    font-size:.82rem; color:var(--muted); line-height:1.6; }
  .fset b { color:var(--dim); font-weight:600; }
  .pills { display:flex; flex-wrap:wrap; gap:.3rem; margin-top:.6rem; }
  .bpill { font-size:.74rem; text-decoration:none; padding:.2rem .5rem; border-radius:var(--r-pill);
    color:var(--text); background:color-mix(in srgb, var(--tc) 12%, var(--surface-2));
    border:1px solid color-mix(in srgb, var(--tc) 40%, transparent); white-space:nowrap; }
  .bpill:hover { background:color-mix(in srgb, var(--tc) 26%, var(--surface-2)); }
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
(${speciesClient.toString()})(__W, ${JSON.stringify(tiers)}, ${JSON.stringify(meta)}, ${JSON.stringify(pal)});`;

  return betaShell({ title: 'RNGdle - Species', width: '900px', slug: 'species', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/projections - the same million numbers, laid out five different ways.
//
// /grid puts number n at (n mod 1000, n / 1000). That is one choice out of many, and
// the choice decides what you can see: a layout that puts numerically adjacent numbers
// side by side shows last-digit rules and hides everything else, while one that nests
// by digit pairs makes digit-pattern rules self-similar and obvious.
//
// So: draw all 1,000,000 as a point cloud and let the layout change under them, with a
// real interpolation rather than a cut - watching where a highlighted set travels
// between two layouts says more about the structure than either picture alone.
//
// Every layout is computed in the vertex shader from gl_VertexID, so there are no
// position buffers at all and switching is a uniform change. Only the by-score layout
// needs data (each number's rank), which arrives as a texture.
// ---------------------------------------------------------------------------

function projectionsWorker() {
  // The sweep bitmask stays here (~29MB); the page only ever wants one badge at a time.
  let BITS = null, ROW = 0;

  self.onmessage = async ev => {
    if (ev.data.cmd === 'badge') {
      const i = ev.data.i, N = 1000000, byte = i >> 3, bit = 1 << (i & 7);
      const mask = new Uint8Array(N);
      for (let n = 0; n < N; n++) mask[n] = (BITS[n * ROW + byte] & bit) ? 255 : 0;
      self.postMessage({ type: 'mask', i, mask: mask.buffer }, [mask.buffer]);
      return;
    }
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.8);
      BITS = swept.bits; ROW = swept.ROW;
      const N = 1000000;
      self.postMessage({ type: 'progress', pct: 0.85, msg: 'Ranking every number…' });
      const ep = new Float64Array(N);
      let max = 0;
      for (let i = 0; i < N; i++) { ep[i] = swept.ep[i]; if (ep[i] > max) max = ep[i]; }
      const cnt = new Uint8Array(N);
      cnt.set(swept.cnt.subarray(0, N));

      // rank[n] = where n sits in score order, and its inverse for hit-testing the
      // by-score layout. Sorting an index array of a million is ~half a second once.
      const order = new Uint32Array(N);
      for (let i = 0; i < N; i++) order[i] = i;
      const arr = Array.from(order).sort((a, b) => ep[a] - ep[b]);
      const rank = new Uint32Array(N), byRank = new Uint32Array(N);
      for (let r = 0; r < N; r++) { rank[arr[r]] = r; byRank[r] = arr[r]; }

      self.postMessage({ type: 'ready', ep: ep.buffer, cnt: cnt.buffer, rank: rank.buffer,
        byRank: byRank.buffer, max, N }, [ep.buffer, cnt.buffer, rank.buffer, byRank.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

function projectionsClient(WORKER_SRC, TIERS, LABELS) {
  const $ = id => document.getElementById(id);
  const cv = $('gl');
  const gl = cv.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) {
    $('ovhead').textContent = 'WebGL2 not available';
    $('ovtext').textContent = 'This tool needs WebGL2. Everything else in the lab works without it.';
    return;
  }
  const N = 1000000, SIDE = 1000;

  let EP = null, CNT = null, RANK = null, BYRANK = null, MAXEP = 1, W = null;
  let maskTex = null, maskBadge = -1, hasMask = false;
  let from = 0, to = 0, t = 1, animStart = 0, mode = 0, sel = -1;
  const view = { x: 0.5, y: 0.5, z: 1 };          // centre in layout space, plus zoom

  // Layout ids must match the switch in the vertex shader.
  const LAYOUTS = [
    { id: 0, name: 'By value', hint: 'n across, n / 1000 down - the /grid layout. Adjacent numbers sit side by side, so last-digit and modular rules show as vertical banding.' },
    { id: 1, name: 'By digits', hint: 'Nested decimal: the first two digits pick a 10x10 block, the next two a block inside that, the last two a cell. Digit-pattern rules become self-similar.' },
    { id: 2, name: 'Hilbert', hint: 'A space-filling curve: numbers close in value stay close in both directions, not just along a row, so runs read as compact blobs instead of stripes. The empty patch is the curve past 1,000,000 - it fills a 1024 square, and the 48,576 spare places end up together, which is the property.' },
    { id: 3, name: 'Z-order', hint: 'Morton order - interleave the bits of the coordinates. Same idea as Hilbert but with jumps, which is exactly what the seams are; the empty places past 1,000,000 scatter rather than clumping.' },
    { id: 4, name: 'By score', hint: 'Sorted by EP, lowest first. Position no longer means anything about the number, but the area each tier occupies is its exact share of the range.' },
  ];

  const VS = `#version 300 es
precision highp float;
precision highp int;
uniform mat3 uM;              // layout space (0..1) -> clip
uniform int uA, uB;           // layouts being interpolated
uniform float uT;             // 0 = uA, 1 = uB
uniform float uPt;
uniform sampler2D uD;         // (normalised log EP, EP, badge count, rank)
uniform sampler2D uK;         // badge overlay mask, 1 byte per number
uniform int uMark;            // 1 when an overlay is loaded
out vec4 vD;
out float vK;
flat out int vN;

ivec2 decimalNest(int n) {
  return ivec2((n / 10000) % 10 * 100 + (n / 100) % 10 * 10 + n % 10,
               (n / 100000) % 10 * 100 + (n / 1000) % 10 * 10 + (n / 10) % 10);
}
ivec2 morton(int d) {
  int x = 0, y = 0;
  for (int i = 0; i < 10; i++) {
    x |= ((d >> (2 * i)) & 1) << i;
    y |= ((d >> (2 * i + 1)) & 1) << i;
  }
  return ivec2(x, y);
}
ivec2 hilbert(int d) {
  ivec2 p = ivec2(0);
  int t = d;
  for (int s = 1; s < 1024; s *= 2) {
    int rx = 1 & (t / 2);
    int ry = 1 & (t ^ rx);
    if (ry == 0) {
      if (rx == 1) { p = ivec2(s - 1 - p.x, s - 1 - p.y); }
      p = p.yx;
    }
    p += s * ivec2(rx, ry);
    t /= 4;
  }
  return p;
}
vec2 place(int kind, int n, float rank) {
  if (kind == 0) return vec2(float(n % 1000), float(n / 1000)) / 1000.0;
  if (kind == 1) return vec2(decimalNest(n)) / 1000.0;
  if (kind == 2) return vec2(hilbert(n)) / 1024.0;
  if (kind == 3) return vec2(morton(n)) / 1024.0;
  int r = int(rank);
  return vec2(float(r % 1000), float(r / 1000)) / 1000.0;
}
void main() {
  int n = gl_VertexID;
  vN = n;
  vD = texelFetch(uD, ivec2(n % 1000, n / 1000), 0);
  vK = uMark == 1 ? texelFetch(uK, ivec2(n % 1000, n / 1000), 0).r : 0.0;
  vec2 p = mix(place(uA, n, vD.a), place(uB, n, vD.a), uT);
  vec3 c = uM * vec3(p, 1.0);
  gl_Position = vec4(c.xy, 0.0, 1.0);
  // Marked points are drawn fatter, or two thousand of them would be lost among a
  // million one-pixel neighbours.
  gl_PointSize = uMark == 1 && vK > 0.5 ? max(2.5, uPt * 2.2) : uPt;
}`;

  const FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vD;
in float vK;
flat in int vN;
uniform vec3 uTier[7];
uniform float uCut[6];
uniform int uMode;            // 0 tier, 1 EP ramp, 2 badge count
uniform float uMaxC;
uniform int uSel;
uniform int uMark;
out vec4 o;
vec3 ramp(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 a = vec3(.055,.067,.098), b = vec3(.10,.20,.38), c = vec3(.22,.50,.75),
       d = vec3(.60,.79,.88), e = vec3(1.0,.96,.87);
  return x < .25 ? mix(a, b, x / .25) : x < .5 ? mix(b, c, (x - .25) / .25)
       : x < .75 ? mix(c, d, (x - .5) / .25) : mix(d, e, (x - .75) / .25);
}
void main() {
  if (vN == uSel) { o = vec4(1.0, .62, .25, 1.0); return; }
  vec3 col;
  if (uMode == 0) { col = uTier[0]; for (int i = 0; i < 6; i++) if (vD.g >= uCut[i]) col = uTier[i + 1]; }
  else if (uMode == 1) col = ramp(vD.r);
  else col = ramp(vD.b / max(uMaxC, 1.0));
  if (uMark == 1) col = vK > 0.5 ? vec3(1.0, .68, .30) : col * .16;
  o = vec4(col, 1.0);
}`;

  function compile(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(VS, gl.VERTEX_SHADER));
    gl.attachShader(prog, compile(FS, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    // This runs before betaBoot, so without this the overlay would sit there forever
    // with nothing to read.
    $('ovhead').textContent = 'Could not compile the shaders';
    $('ovtext').textContent = String(err && err.message || err);
    return;
  }
  const U = n => gl.getUniformLocation(prog, n);
  const vao = gl.createVertexArray();

  // --- CPU copies of the layouts, for hit-testing ------------------------
  // Inverting the current layout is exact and costs nothing, which beats a picking
  // pass here - the points are one pixel wide and a pass would only find exact hits
  // anyway.
  function place(layout, n) {
    if (layout === 0) return [n % 1000, (n / 1000) | 0, 1000];
    if (layout === 1) {
      return [((n / 10000) | 0) % 10 * 100 + ((n / 100) | 0) % 10 * 10 + n % 10,
        ((n / 100000) | 0) % 10 * 100 + ((n / 1000) | 0) % 10 * 10 + ((n / 10) | 0) % 10, 1000];
    }
    if (layout === 3) {
      let x = 0, y = 0;
      for (let i = 0; i < 10; i++) { x |= ((n >> (2 * i)) & 1) << i; y |= ((n >> (2 * i + 1)) & 1) << i; }
      return [x, y, 1024];
    }
    if (layout === 2) {
      let px = 0, py = 0, tt = n;
      for (let s = 1; s < 1024; s *= 2) {
        const rx = 1 & (tt >> 1), ry = 1 & (tt ^ rx);
        if (ry === 0) {
          if (rx === 1) { px = s - 1 - px; py = s - 1 - py; }
          const tmp = px; px = py; py = tmp;
        }
        px += s * rx; py += s * ry;
        tt = tt >> 2;
      }
      return [px, py, 1024];
    }
    const r = RANK[n];
    return [r % 1000, (r / 1000) | 0, 1000];
  }
  // The inverse: cell -> number, for whichever layout is currently settled.
  function unplace(layout, cx, cy) {
    if (layout === 0) return cy * 1000 + cx;
    if (layout === 1) {
      const a = (cy / 100) | 0, b = (cx / 100) | 0, c = ((cy / 10) | 0) % 10,
        d = ((cx / 10) | 0) % 10, e = cy % 10, f = cx % 10;
      return a * 100000 + b * 10000 + c * 1000 + d * 100 + e * 10 + f;
    }
    if (layout === 3) {
      let n = 0;
      for (let i = 0; i < 10; i++) { n |= ((cx >> i) & 1) << (2 * i); n |= ((cy >> i) & 1) << (2 * i + 1); }
      return n < N ? n : -1;
    }
    if (layout === 2) {
      let rx, ry, d = 0, px = cx, py = cy;
      for (let s = 512; s > 0; s = s >> 1) {
        rx = (px & s) > 0 ? 1 : 0;
        ry = (py & s) > 0 ? 1 : 0;
        d += s * s * ((3 * rx) ^ ry);
        if (ry === 0) {
          if (rx === 1) { px = s - 1 - px; py = s - 1 - py; }
          const tmp = px; px = py; py = tmp;
        }
      }
      return d < N ? d : -1;
    }
    const r = cy * 1000 + cx;
    return r < N ? BYRANK[r] : -1;
  }

  // --- render ------------------------------------------------------------
  function matrix() {
    // Layout space is 0..1; fit it square inside the canvas, then apply pan/zoom.
    const asp = cv.width / cv.height;
    const s = 2 * view.z / (asp > 1 ? 1 : 1);
    const sx = (asp > 1 ? s / asp : s), sy = (asp > 1 ? s : s * asp);
    return new Float32Array([
      sx, 0, 0,
      0, -sy, 0,
      -sx * view.x, sy * view.y, 1,
    ]);
  }

  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (!EP) return;
    if (t < 1) {
      // Smoothstep, so the layouts ease apart and back together instead of sliding.
      const p = Math.min(1, (now - animStart) / 900);
      t = p * p * (3 - 2 * p);
      if (p < 1) render(); else { t = 1; from = to; }
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(cv.clientWidth * dpr), h = Math.floor(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.031, 0.035, 0.047, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniformMatrix3fv(U('uM'), false, matrix());
    gl.uniform1i(U('uA'), from); gl.uniform1i(U('uB'), to);
    gl.uniform1f(U('uT'), t);
    gl.uniform1i(U('uMode'), mode);
    gl.uniform1f(U('uMaxC'), 40);
    gl.uniform1i(U('uSel'), sel);
    gl.uniform1i(U('uMark'), hasMask ? 1 : 0);
    // One device pixel per number at fit; bigger as you zoom in, so a single number
    // stays findable rather than vanishing between samples.
    const px = (Math.min(cv.width, cv.height) * view.z) / SIDE;
    gl.uniform1f(U('uPt'), Math.max(1, px));
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, N);
  }

  // --- readout -----------------------------------------------------------
  const fmt = n => n.toLocaleString();
  const tierOf = ep => { let x = TIERS[0]; for (const y of TIERS) if (ep >= y.lo) x = y; return x; };
  function show(n) {
    const box = $('read');
    if (n < 0) { box.classList.remove('on'); return; }
    const tr = tierOf(EP[n]);
    box.classList.add('on');
    box.innerHTML = `<div class="rd-top"><span class="rd-n">${fmt(n)}</span>
        <span class="pill" style="--tc:${tr.accent}">${tr.label}</span></div>
      <div class="rd-row"><span>EP</span><b>${fmt(Math.round(EP[n]))}</b></div>
      <div class="rd-row"><span>Badges</span><b>${CNT[n]}</b></div>
      <div class="rd-row"><span>Score rank</span><b>${fmt(N - RANK[n])}</b></div>
      <a class="rd-open" href="/?n=${n}">Open on the calculator &rarr;</a>`;
  }

  function cellAt(ev) {
    if (t < 1) return -1;                          // mid-morph there is no cell to name
    const r = cv.getBoundingClientRect();
    const m = matrix();
    // Undo the same transform the shader applies.
    const ndcX = ((ev.clientX - r.left) / r.width) * 2 - 1;
    const ndcY = 1 - ((ev.clientY - r.top) / r.height) * 2;
    const lx = (ndcX - m[6]) / m[0], ly = (ndcY - m[7]) / m[4];
    // Hilbert and Z-order fill a 1024 square; the other three a 1000 one.
    const size = from === 2 || from === 3 ? 1024 : 1000;
    const gx = Math.floor(lx * size), gy = Math.floor(ly * size);
    if (gx < 0 || gy < 0 || gx >= size || gy >= size) return -1;
    return unplace(from, gx, gy);
  }

  // --- interaction -------------------------------------------------------
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer */ }
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = cv.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / r.width, dy = (e.clientY - drag.y) / r.height;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    view.x -= dx / view.z; view.y -= dy / view.z;
    render();
  });
  cv.addEventListener('pointerup', e => {
    const click = drag && drag.moved < 0.005;
    drag = null;
    if (!click) return;
    sel = cellAt(e); show(sel); render();
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const before = cellPoint(e, r);
    view.z = Math.max(0.9, Math.min(400, view.z * Math.exp(-e.deltaY * 0.0015)));
    const after = cellPoint(e, r);
    view.x += before[0] - after[0]; view.y += before[1] - after[1];
    render();
  }, { passive: false });
  // Layout-space point under the cursor, used to keep it fixed while zooming.
  function cellPoint(ev, r) {
    const m = matrix();
    const ndcX = ((ev.clientX - r.left) / r.width) * 2 - 1;
    const ndcY = 1 - ((ev.clientY - r.top) / r.height) * 2;
    return [(ndcX - m[6]) / m[0], (ndcY - m[7]) / m[4]];
  }

  function url() {
    const q = new URLSearchParams();
    if (to) q.set('l', String(to));
    if (maskBadge >= 0 && hasMask) q.set('badge', LABELS[maskBadge]);
    const qs = q.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  // `instant` lands on the layout without a morph, which is what a deep link wants:
  // arriving mid-animation from a layout the visitor never asked for is just noise.
  function goto(id, instant) {
    if (id === to && t >= 1 && !instant) return;
    from = instant ? id : (t < 1 ? from : to);
    to = id;
    t = instant ? 1 : 0;
    animStart = performance.now();
    sel = -1; show(-1);
    [...document.querySelectorAll('#layouts button')].forEach(b =>
      b.classList.toggle('on', Number(b.dataset.l) === id));
    $('hint').textContent = LAYOUTS[id].hint;
    url();
    render();
  }

  $('layouts').addEventListener('click', e => {
    const b = e.target.closest('[data-l]');
    if (b) goto(Number(b.dataset.l));
  });
  $('mode').addEventListener('change', e => { mode = Number(e.target.value); render(); });
  $('fit').addEventListener('click', () => { view.x = view.y = 0.5; view.z = 1; render(); });
  $('badge').addEventListener('change', e => {
    const i = LABELS.indexOf(e.target.value);
    if (i < 0) {
      hasMask = false; maskBadge = -1;
      $('badgenote').textContent = '';
      url();
      render();
      return;
    }
    if (i === maskBadge && hasMask) return;
    maskBadge = i;
    $('badgenote').textContent = 'Loading…';
    W.postMessage({ cmd: 'badge', i });
  });
  $('badgeclear').addEventListener('click', () => {
    $('badge').value = '';
    $('badge').dispatchEvent(new Event('change'));
  });
  addEventListener('resize', render);

  betaBoot(WORKER_SRC, m => {
    if (m.type !== 'mask' || m.i !== maskBadge) return;
    const mask = new Uint8Array(m.mask);
    let lit = 0;
    for (let n = 0; n < mask.length; n++) if (mask[n]) lit++;
    // Its own R8 texture rather than a spare channel of the data one: all four of
    // those are taken, and rebuilding a 16MB RGBA32F upload per badge would be silly.
    if (!maskTex) {
      maskTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.useProgram(prog);
      gl.uniform1i(U('uK'), 1);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1000, 1000, 0, gl.RED, gl.UNSIGNED_BYTE, mask);
    hasMask = true;
    $('badgenote').textContent = `${lit.toLocaleString()} numbers · ${
      (100 * lit / mask.length).toFixed(lit < 1000 ? 4 : 2)}% of the map`;
    url();
    render();
  }).then(({ worker, data }) => {
    W = worker;
    EP = new Float64Array(data.ep); CNT = new Uint8Array(data.cnt);
    RANK = new Uint32Array(data.rank); BYRANK = new Uint32Array(data.byRank);
    MAXEP = data.max;

    // One RGBA32F texture carries everything the shaders need per number: normalised
    // log EP for the ramp, raw EP for the tier cut, badge count, and the score rank
    // (which is a position, not a colour - it is what the by-score layout reads).
    const tex = new Float32Array(N * 4);
    const lg = Math.log10(1 + MAXEP);
    for (let n = 0; n < N; n++) {
      const k = n * 4;
      tex[k] = Math.log10(1 + EP[n]) / lg;
      tex[k + 1] = EP[n];
      tex[k + 2] = CNT[n];
      tex[k + 3] = RANK[n];
    }
    const T = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, T);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1000, 1000, 0, gl.RGBA, gl.FLOAT, tex);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U('uD'), 0);
    gl.uniform3fv(U('uTier'), new Float32Array(TIERS.flatMap(x => {
      const h = x.accent.slice(1);
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    })));
    gl.uniform1fv(U('uCut'), new Float32Array(TIERS.slice(1).map(x => x.lo)));

    $('hud').classList.add('on');
    $('hint').textContent = LAYOUTS[0].hint;
    render();

    const q = new URLSearchParams(location.search);
    const l = Number(q.get('l'));
    if (Number.isInteger(l) && l > 0 && l < LAYOUTS.length) goto(l, true);
    const badge = q.get('badge');
    if (badge && LABELS.includes(badge)) {
      $('badge').value = badge;
      $('badge').dispatchEvent(new Event('change'));
    }
  });
}

function renderProjections(ctx) {
  const { BADGES, CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE, esc } = ctx;
  const LABELS = BADGES.map(b => b[1]);
  const tiers = CARD_TIER_NAMES.map((key, i) => ({
    label: TIER_PALETTE[key].label, accent: TIER_PALETTE[key].accent,
    lo: i === 0 ? 0 : CARD_TIERS[i - 1][0],
  }));
  const names = ['By value', 'By digits', 'Hilbert', 'Z-order', 'By score'];

  const css = `
  body { -webkit-user-select:none; user-select:none; }
  #gl { position:fixed; top:0; left:var(--rail-w); width:calc(100% - var(--rail-w)); height:100%;
    display:block; cursor:grab; touch-action:none; }
  #gl:active { cursor:grabbing; }
  .glass { position:fixed; z-index:5; background:rgba(12,14,22,.86); border:1px solid rgba(255,255,255,.12);
    border-radius:var(--r-card); backdrop-filter:blur(6px); }

  #hud { top:12px; left:calc(var(--rail-w) + 12px); width:270px; padding:12px; display:none;
    flex-direction:column; gap:.7rem; max-height:calc(100vh - 24px); overflow:auto; }
  #hud.on { display:flex; }
  #hud h1 { font-size:14px; font-weight:650; margin:0; }
  #hud .sub { font-size:11.5px; color:var(--muted); line-height:1.5; }
  #hud a.back { font-size:11.5px; color:var(--muted); text-decoration:none; }
  #hud a.back:hover { color:var(--text); }
  #layouts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; }
  #layouts button { padding:.42rem .5rem; font-size:12px; color:var(--dim);
    background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.14); }
  #layouts button:hover { background:rgba(255,255,255,.13); }
  #layouts button.on { background:color-mix(in srgb, var(--hl) 22%, transparent); color:#f6dcc0;
    border-color:color-mix(in srgb, var(--hl) 50%, transparent); }
  #hint { font-size:11.5px; color:var(--dim); line-height:1.55; min-height:4.5em;
    padding-top:.1rem; border-top:1px solid rgba(255,255,255,.1); }
  .ctl { display:flex; flex-direction:column; gap:.25rem; }
  .ctl > span { font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); font-weight:600; }
  .ctl select { width:100%; font-size:12px; padding:.35rem .45rem; background:rgba(255,255,255,.06);
    border-color:rgba(255,255,255,.14); }
  #fit { font-size:12px; padding:.4rem .5rem; background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.14); }
  .badgerow { display:flex; gap:5px; }
  #badge { flex:1; min-width:0; font-size:12px; padding:.35rem .45rem; background:rgba(255,255,255,.06);
    border-color:rgba(255,255,255,.14); }
  #badgeclear { flex:0 0 auto; padding:.35rem .5rem; font-size:13px; color:var(--muted);
    background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.14); }
  #badgenote { font-size:11px; color:var(--hl-lt); font-family:var(--mono); min-height:1.1em; }

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
  @media (max-width:760px) { #legend, #help { display:none; } #hud { width:220px; } }`;

  const legend = tiers.slice().reverse().map(t =>
    `<span><i style="background:${t.accent}"></i>${t.label}</span>`).join('');

  const body = `<canvas id="gl"></canvas>
<div id="hud" class="glass">
  <div>
    <h1>Projections <span class="beta-tag">beta</span></h1>
    <div class="sub">All 1,000,000 numbers, laid out five ways. The layout changes under them,
      so you can watch where a set of numbers travels.</div>
    <a class="back" href="/beta">&larr; Beta lab</a>
  </div>
  <div id="layouts">${names.map((n, i) =>
    `<button type="button" data-l="${i}"${i === 0 ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
  <div id="hint"></div>
  <label class="ctl"><span>Colour</span>
    <select id="mode">
      <option value="0">Card tier</option>
      <option value="1">EP</option>
      <option value="2">Badges earned</option>
    </select></label>
  <div class="ctl"><span>Light up a badge</span>
    <div class="badgerow">
      <input id="badge" list="badgelist" type="text" placeholder="any badge…" autocomplete="off">
      <button type="button" id="badgeclear" title="Clear the overlay">&times;</button>
    </div>
    <div id="badgenote"></div>
  </div>
  <datalist id="badgelist">${LABELS.map(l => `<option value="${esc(l)}"></option>`).join('')}</datalist>
  <button type="button" id="fit">Fit</button>
</div>
<div id="read" class="glass"></div>
<div id="legend" class="glass">${legend}</div>
<div id="help" class="glass"><b>Drag</b> to pan · <b>Wheel</b> to zoom · <b>Click</b> a point to read it</div>
${overlayHTML('Then ranking every number so the by-score layout has somewhere to put them.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(projectionsWorker))};
(${projectionsClient.toString()})(__W, ${JSON.stringify(tiers)}, ${JSON.stringify(LABELS)});`;

  return betaShell({
    title: 'RNGdle - Projections', slug: 'projections', full: true, css, body, script,
    viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
  });
}

// ---------------------------------------------------------------------------
// /beta/nearmiss - what one different digit would have been worth.
//
// Treat every number as its six-digit zero-padded form and it has exactly 54
// neighbours: six positions times nine other digits, every one of them a legal roll.
// That turns the range into a graph, and the interesting questions are local ones -
// was your roll a peak or a valley, and how far off was the peak next door?
//
// The global pass is 54 million lookups, which is why it lives in the worker; after
// that the page holds the EP array and any single number's neighbourhood is 54 reads.
// ---------------------------------------------------------------------------

function nearmissWorker() {
  const N = 1000000;
  const POW = [100000, 10000, 1000, 100, 10, 1];

  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.5);
      const ep = new Float64Array(N);
      for (let i = 0; i < N; i++) ep[i] = swept.ep[i];
      const mythic = ev.data.mythic;

      self.postMessage({ type: 'progress', pct: 0.55, msg: 'Walking 54 million neighbours…' });
      let peaks = 0, valleys = 0, nearMythic = 0, sumBest = 0;
      // Two small top-lists, kept by insertion - a full sort of a million candidates
      // to show ten rows would cost more than the whole pass.
      const cruel = [], summits = [];
      const keep = (list, item, cap, key) => {
        if (list.length < cap) { list.push(item); list.sort((a, b) => b[key] - a[key]); return; }
        if (item[key] <= list[cap - 1][key]) return;
        list[cap - 1] = item;
        list.sort((a, b) => b[key] - a[key]);
      };

      for (let n = 0; n < N; n++) {
        if ((n & 0x1ffff) === 0) self.postMessage({ type: 'progress', pct: 0.55 + 0.45 * (n / N) });
        const mine = ep[n];
        let best = -1, bestN = -1, worse = 0;
        for (let p = 0; p < 6; p++) {
          const pw = POW[p], cur = ((n / pw) | 0) % 10, base = n - cur * pw;
          for (let d = 0; d < 10; d++) {
            if (d === cur) continue;
            const e = ep[base + d * pw];
            if (e > best) { best = e; bestN = base + d * pw; }
            if (e < mine) worse++;
          }
        }
        sumBest += best;
        if (worse === 54) { peaks++; keep(summits, { n, ep: mine, ep2: 0 }, 10, 'ep'); }
        if (worse === 0) valleys++;
        if (best >= mythic) nearMythic++;
        // A "near miss" is a poor roll with a spectacular neighbour. Ratio, so it is
        // not just a list of the ten biggest numbers in the range.
        if (mine < mythic) keep(cruel, { n, ep: mine, best, to: bestN, ratio: best / Math.max(1, mine) }, 10, 'ratio');
      }

      self.postMessage({ type: 'ready', ep: ep.buffer, N, peaks, valleys, nearMythic,
        meanBest: sumBest / N, cruel, summits }, [ep.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

function nearmissClient(WORKER_SRC, TIERS) {
  const $ = id => document.getElementById(id);
  const N = 1000000, POW = [100000, 10000, 1000, 100, 10, 1];
  const fmt = n => Math.round(n).toLocaleString();
  // Signed: the board's cells are mostly negative deltas, and an eight-digit one does
  // not fit in a 40px cell.
  const compact = n => {
    const a = Math.abs(n), sign = n < 0 ? '-' : '';
    return a >= 1e6 ? sign + (a / 1e6).toFixed(2) + 'M'
      : a >= 1e4 ? sign + (a / 1e3).toFixed(1) + 'k' : sign + fmt(a);
  };
  const tierOf = ep => { let x = TIERS[0]; for (const y of TIERS) if (ep >= y.lo) x = y; return x; };
  let EP = null, cur = 123456;

  function board(n) {
    const mine = EP[n], s = String(n).padStart(6, '0');
    const rows = [];
    let best = -1, bestN = -1, worst = Infinity;
    const cells = [];
    for (let p = 0; p < 6; p++) {
      const pw = POW[p], curD = Number(s[p]), base = n - curD * pw;
      for (let d = 0; d < 10; d++) {
        const m = base + d * pw;
        const e = EP[m];
        if (d !== curD && e > best) { best = e; bestN = m; }
        if (d !== curD && e < worst) worst = e;
        cells.push({ p, d, m, e, self: d === curD });
      }
    }
    // Mark every cell tied at the extreme, not just the first one found - with 54
    // neighbours the worst score in particular is often shared, and picking one
    // arbitrarily would claim a distinction the numbers do not make.
    for (const c of cells) {
      // Only mark an extreme when it is actually one. On a local peak every swap loses,
      // so a "best" star would be pointing at the least-bad way to make things worse;
      // in a local valley the same is true of the "worst" caret in reverse.
      c.best = !c.self && c.e === best && best > mine;
      c.worst = !c.self && c.e === worst && worst < mine && best !== worst;
    }
    // Colour on the log ratio against the number itself, so the scale means the same
    // thing for a 3,000 EP roll and a 3,000,000 one.
    const lr = e => Math.log10(Math.max(1, e) / Math.max(1, mine));
    const span = Math.max(0.35, ...cells.map(c => Math.abs(lr(c.e))));
    const colour = c => {
      if (c.self) return 'background:var(--hl);color:var(--on-accent)';
      const t = lr(c.e) / span;
      const a = Math.min(0.85, Math.abs(t) * 0.9 + 0.08);
      return t >= 0
        ? `background:color-mix(in srgb, var(--ok) ${(a * 100).toFixed(0)}%, var(--surface-2));color:var(--text)`
        : `background:color-mix(in srgb, var(--bad) ${(a * 70).toFixed(0)}%, var(--surface-2));color:var(--dim)`;
    };

    $('board').innerHTML = [0, 1, 2, 3, 4, 5].map(p => `<div class="col">
      <div class="chead">${s[p]}</div>
      <div class="cells">${cells.filter(c => c.p === p).map(c =>
        `<button type="button" class="cell${c.self ? ' self' : c.best ? ' best' : c.worst ? ' worst' : ''}"
          data-n="${c.m}" style="${colour(c)}"
          title="${c.m.toLocaleString()} · ${fmt(c.e)} EP${
            c.best ? ' · the best swap available' : c.worst ? ' · the worst swap available' : ''}">${
          c.best ? '<span class="mk">&#9733;</span>' : c.worst ? '<span class="mk">&#9660;</span>' : ''}${c.d}<em>${
            c.self ? 'this' : (c.e >= mine ? '+' : '') + compact(c.e - mine)}</em></button>`).join('')}</div>
      <div class="cfoot">${['100k', '10k', '1k', '100', '10', '1'][p]}</div>
    </div>`).join('');

    const t = tierOf(mine), bt = tierOf(best);
    const worse = cells.filter(c => !c.self && c.e < mine).length;
    $('cur').innerHTML = `
      <div class="stat stat-lg"><span class="k">This number</span><span class="v">${compact(mine)}</span>
        <span class="sub">EP · <span class="pill" style="--tc:${t.accent}">${t.label}</span></span></div>
      <div class="stat stat-lg"><span class="k">Best neighbour</span><span class="v">${compact(best)}</span>
        <span class="sub">EP · <a href="/?n=${bestN}">${bestN.toLocaleString()}</a>
          · <span class="pill" style="--tc:${bt.accent}">${bt.label}</span></span></div>
      <div class="stat stat-lg"><span class="k">One digit gains</span><span class="v">${
        best > mine ? '+' + compact(best - mine) : 'nothing'}</span>
        <span class="sub">${best > mine ? (best / Math.max(1, mine)).toFixed(1) + 'x this score' : 'this is a local peak'}</span></div>
      <div class="stat stat-lg"><span class="k">Better than</span><span class="v">${worse}</span>
        <span class="sub">of its 54 neighbours</span></div>`;
    $('title').innerHTML = `<span class="tn">${n.toLocaleString()}</span>
      <a class="tlink" href="/?n=${n}">open on the calculator &rarr;</a>`;
    cur = n;
    history.replaceState(null, '', '?n=' + n);
  }

  function set(n) {
    if (!Number.isInteger(n) || n < 0 || n >= N) return;
    board(n);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-n]');
    if (b) { set(Number(b.dataset.n)); scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  $('go').addEventListener('submit', e => {
    e.preventDefault();
    set(parseInt(($('n').value || '').replace(/\D/g, ''), 10));
  });
  $('rand').addEventListener('click', () => {
    const n = Math.floor(Math.random() * N);
    $('n').value = n;
    set(n);
  });

  betaBoot(WORKER_SRC, null, { mythic: TIERS[TIERS.length - 1].lo }).then(({ data }) => {
    EP = new Float64Array(data.ep);
    $('page').classList.add('on');
    $('global').innerHTML = `
      <div class="stat stat-lg"><span class="k">One digit from mythic</span><span class="v">${
        (100 * data.nearMythic / data.N).toFixed(1)}%</span>
        <span class="sub">${fmt(data.nearMythic)} numbers have a mythic neighbour</span></div>
      <div class="stat stat-lg"><span class="k">Local peaks</span><span class="v">${fmt(data.peaks)}</span>
        <span class="sub">beat all 54 of their neighbours</span></div>
      <div class="stat stat-lg"><span class="k">Local valleys</span><span class="v">${fmt(data.valleys)}</span>
        <span class="sub">lose to all 54</span></div>
      <div class="stat stat-lg"><span class="k">Mean best neighbour</span><span class="v">${
        compact(data.meanBest)}</span><span class="sub">EP · against a mean roll of 21.5k</span></div>`;

    const row = (n, right, sub) => {
      const t = tierOf(EP[n]);
      return `<button type="button" class="nrow" data-n="${n}">
        <span class="nn">${n.toLocaleString()}</span>
        <span class="pill" style="--tc:${t.accent}">${t.label}</span>
        <span class="ns">${sub}</span><span class="nv">${right}</span></button>`;
    };
    $('cruel').innerHTML = data.cruel.map(c =>
      row(c.n, (c.ratio >= 1000 ? compact(c.ratio) : Math.round(c.ratio)) + 'x',
        `${fmt(c.ep)} EP, next door ${compact(c.best)}`)).join('');
    $('summits').innerHTML = data.summits.map(s =>
      row(s.n, compact(s.ep) + ' EP', 'beats every neighbour')).join('');

    const q = parseInt(new URLSearchParams(location.search).get('n') || '', 10);
    const start = Number.isInteger(q) && q >= 0 && q < N ? q : 123456;
    $('n').value = start;
    set(start);
  });
}

function renderNearMiss(ctx) {
  const { CARD_TIERS, CARD_TIER_NAMES, TIER_PALETTE } = ctx;
  const tiers = CARD_TIER_NAMES.map((key, i) => ({
    label: TIER_PALETTE[key].label, accent: TIER_PALETTE[key].accent,
    lo: i === 0 ? 0 : CARD_TIERS[i - 1][0],
  }));

  const css = `
  #page { display:none; }
  #page.on { display:block; }
  .card { margin-bottom:.9rem; }
  .card > p.small { margin:-.35rem 0 .8rem; font-size:.8rem; color:var(--muted); line-height:1.6; }
  .bar { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-bottom:1rem; }
  #go { display:flex; gap:.5rem; }
  #n { width:9rem; }
  #title { display:flex; align-items:baseline; gap:.8rem; flex-wrap:wrap; margin-bottom:.9rem; }
  #title .tn { font-family:var(--mono); font-size:2rem; font-weight:600; letter-spacing:.06em; }
  #title .tlink { font-size:.8rem; }

  .cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,290px); gap:1rem; align-items:start; }
  @media (max-width:900px) { .cols { grid-template-columns:minmax(0,1fr); } }
  #board { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:.5rem; }
  .col { display:flex; flex-direction:column; gap:.3rem; min-width:0; }
  .chead { height:28px; display:flex; align-items:center; justify-content:center;
    font-family:var(--mono); font-size:1.1rem; font-weight:700; color:var(--hl-lt); }
  .cells { display:flex; flex-direction:column; gap:2px; }
  .cell { position:relative; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:1px; height:38px; padding:0; border:1px solid transparent;
    border-radius:var(--r-sm); font-family:var(--mono); font-size:.95rem; font-weight:600; }
  .cell em { font-style:normal; font-size:.6rem; font-weight:500; opacity:.9; letter-spacing:-.02em; }
  .cell:hover { border-color:var(--text); }
  .cell.self { font-weight:800; }
  /* The two extremes, after :hover so the marking survives the pointer. A star for the
     best swap and a caret for the worst - a star on the worst cell reads as praise. */
  /* The ring needs a dark line between it and the fill: the best cell is the greenest
     one on the board and the worst the reddest, so a same-hue ring sat straight on top
     of its own colour and vanished. The mark itself goes near-white for the same
     reason - it has to read on a saturated fill of either colour. */
  .cell.best, .cell.worst { box-shadow:inset 0 0 0 1px rgba(8,9,12,.75); }
  .cell.best { border-color:var(--ok); outline:1.5px solid var(--ok); outline-offset:0; }
  .cell.worst { border-color:var(--bad); outline:1.5px solid var(--bad); outline-offset:0; }
  .cell .mk { position:absolute; top:0; right:2px; font-size:.66rem; line-height:1.2;
    font-weight:700; color:var(--text); text-shadow:0 0 3px rgba(8,9,12,.95), 0 1px 1px rgba(8,9,12,.9);
    pointer-events:none; }
  .cfoot { text-align:center; font-size:.66rem; color:var(--faint); font-family:var(--mono); }
  @media (max-width:640px) { .cell { height:30px; font-size:.8rem; } .cell em { display:none; } }

  #cur, #global { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(140px,100%),1fr)); gap:.5rem; }
  #cur .stat, #global .stat { min-width:0; overflow-wrap:anywhere; }
  #global { margin-bottom:1.2rem; }
  .two { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(330px,100%),1fr)); gap:.9rem; }

  .nrow { display:flex; align-items:center; gap:.5rem; width:100%; text-align:left; padding:.34rem .35rem;
    font-size:.84rem; font-weight:400; color:var(--dim); background:transparent; border:0;
    border-radius:var(--r-sm); }
  .nrow:hover { background:var(--surface-2); border:0; color:var(--text); }
  .nrow .nn { flex:0 0 4.6rem; font-family:var(--mono); }
  .nrow .ns { flex:1; min-width:0; font-size:.74rem; color:var(--faint); font-family:var(--mono);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .nrow .nv { flex:0 0 auto; font-family:var(--mono); font-size:.8rem; color:var(--hl-lt); }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Near Misses <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">Every number has exactly 54 neighbours - six digit positions, nine other digits each.
    This is what each of them would have scored.</p>

  <div id="page">
    <div class="bar">
      <form id="go"><input id="n" type="text" inputmode="numeric" placeholder="a number"
        autocomplete="off"><button type="submit" class="btn-primary btn-sm">Show</button></form>
      <button type="button" id="rand" class="btn-sm">Random roll</button>
    </div>

    <div id="title"></div>
    <div class="cols">
      <section class="card"><div id="board"></div></section>
      <div id="cur"></div>
    </div>

    <h2 class="eyebrow" style="margin-top:1.6rem">Across the whole range</h2>
    <div id="global"></div>

    <div class="two">
      <section class="card"><h2>Cruellest near misses</h2>
        <p class="small">Ordinary numbers with a spectacular neighbour - ranked by how many times
          better one different digit would have been.</p>
        <div id="cruel"></div></section>
      <section class="card"><h2>Highest local peaks</h2>
        <p class="small">Numbers that beat all 54 of their neighbours, best first. Nothing one digit
          away from these is worth more.</p>
        <div id="summits"></div></section>
    </div>
  </div>

  <footer>
    Neighbours are taken on the <b>six-digit zero-padded</b> form, so 69 is 000069 and changing its
    leading digit gives 100069 - every one of the 54 is a legal roll in 0-999,999. Green means that
    digit would have scored more than the number you are looking at, red less, and the shade is the
    log ratio, so the scale reads the same for a small score and a huge one. The outlined cells are
    the extremes worth acting on: <b>&#9733;</b> the biggest gain available and <b>&#9660;</b> the
    biggest loss. Each marks every cell tied at that value rather than picking one, so several can be
    outlined at once - and neither appears unless it is real, so a number that beats all 54 of its
    neighbours shows no star at all.
  </footer>
</div>
${overlayHTML('Then walking all 54 million neighbour pairs to find the peaks and the near misses.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(nearmissWorker))};
(${nearmissClient.toString()})(__W, ${JSON.stringify(tiers)});`;

  return betaShell({ title: 'RNGdle - Near Misses', width: '1000px', slug: 'nearmiss', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/anatomy - which properties of a number actually drive its score.
//
// The Digit Oracle answers this positionally: what is a 7 in the hundreds column
// worth? This one answers it structurally - digit sum, how many distinct digits, the
// longest run, divisibility, palindromes - and puts every property on the same axis
// so they can be ranked by how much they matter at all.
//
// The measure is lift: the mean EP of a bucket over the mean of the whole range. A
// property whose buckets all sit near 1.0 does nothing, however intuitive it sounds,
// and the panels are ordered so those sink to the bottom on their own.
// ---------------------------------------------------------------------------

function anatomyWorker() {
  const N = 1000001;

  // [key, label, note, bucketCount, bucketLabel(i)] - the bucket function itself lives
  // in the loop below, because doing it per feature would mean 14 passes over the range.
  const FEATURES = [
    ['len', 'Digit count', 'How many digits the number has', 7, i => (i + 1) + ''],
    ['sum', 'Digit sum', 'Digits added together', 55, i => i + ''],
    ['distinct', 'Distinct digits', 'How many different digits appear', 7, i => (i + 1) + ''],
    ['maxrep', 'Most repeated digit', 'How many times the commonest digit appears', 7, i => (i + 1) + 'x'],
    ['run', 'Longest run', 'Longest stretch of the same digit in a row', 7, i => (i + 1) + ' long'],
    ['first', 'Leading digit', '', 10, i => i + ''],
    ['last', 'Last digit', '', 10, i => i + ''],
    ['shape', 'Digit shape', 'Whether the digits climb, fall, or neither', 4,
      i => ['strictly up', 'strictly down', 'flat', 'mixed'][i]],
    ['div', 'Divisible by', '', 6, i => ['2', '3', '5', '7', '11', 'nothing under 12'][i]],
    ['pal', 'Palindrome', 'Reads the same both ways', 2, i => i ? 'yes' : 'no'],
  ];

  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.7);
      const ep = swept.ep;
      self.postMessage({ type: 'progress', pct: 0.72, msg: 'Finding the top 1% cutoff…' });
      const sorted = Float64Array.from(ep).sort();
      const top1 = sorted[Math.floor(sorted.length * 0.99)];

      const acc = FEATURES.map(f => ({
        key: f[0], label: f[1], note: f[2],
        n: new Float64Array(f[3]), ep: new Float64Array(f[3]), top: new Float64Array(f[3]),
        labels: Array.from({ length: f[3] }, (_, i) => f[4](i)),
      }));
      const by = Object.fromEntries(acc.map(a => [a.key, a]));
      const put = (a, b, e, isTop) => { a.n[b]++; a.ep[b] += e; if (isTop) a.top[b]++; };

      let total = 0;
      for (let n = 0; n < N; n++) {
        if ((n & 0x3ffff) === 0) self.postMessage({ type: 'progress', pct: 0.78 + 0.22 * (n / N) });
        const s = String(n), L = s.length, e = ep[n], isTop = e >= top1;
        total += e;

        let sum = 0, run = 1, best = 1, up = true, down = true;
        const seen = new Uint8Array(10);
        let distinct = 0, maxrep = 0;
        const counts = new Uint8Array(10);
        for (let i = 0; i < L; i++) {
          const d = s.charCodeAt(i) - 48;
          sum += d;
          if (!seen[d]) { seen[d] = 1; distinct++; }
          if (++counts[d] > maxrep) maxrep = counts[d];
          if (i) {
            const p = s.charCodeAt(i - 1) - 48;
            if (d <= p) up = false;
            if (d >= p) down = false;
            if (d === p) { if (++run > best) best = run; } else run = 1;
          }
        }
        put(by.len, L - 1, e, isTop);
        put(by.sum, sum, e, isTop);
        put(by.distinct, distinct - 1, e, isTop);
        put(by.maxrep, maxrep - 1, e, isTop);
        put(by.run, best - 1, e, isTop);
        put(by.first, s.charCodeAt(0) - 48, e, isTop);
        put(by.last, s.charCodeAt(L - 1) - 48, e, isTop);
        put(by.shape, L === 1 ? 2 : up ? 0 : down ? 1 : (maxrep === L ? 2 : 3), e, isTop);
        // Divisibility buckets overlap, so this one is counted per rule rather than
        // partitioned - which is why it gets its own note on the page.
        let any = false;
        if (n % 2 === 0) { put(by.div, 0, e, isTop); any = true; }
        if (n % 3 === 0) { put(by.div, 1, e, isTop); any = true; }
        if (n % 5 === 0) { put(by.div, 2, e, isTop); any = true; }
        if (n % 7 === 0) { put(by.div, 3, e, isTop); any = true; }
        if (n % 11 === 0) { put(by.div, 4, e, isTop); any = true; }
        if (!any) put(by.div, 5, e, isTop);
        let pal = 1;
        for (let i = 0, j = L - 1; i < j; i++, j--) if (s[i] !== s[j]) { pal = 0; break; }
        put(by.pal, pal, e, isTop);
      }

      self.postMessage({ type: 'ready', N, mean: total / N, top1,
        features: acc.map(a => ({ key: a.key, label: a.label, note: a.note, labels: a.labels,
          n: Array.from(a.n), ep: Array.from(a.ep), top: Array.from(a.top) })) });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

function anatomyClient(WORKER_SRC) {
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  const compact = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : fmt(n);
  let D = null, metric = 'ep';

  function panels() {
    const rows = D.features.map(f => {
      const buckets = f.labels.map((lab, i) => {
        if (!f.n[i]) return null;
        const mean = f.ep[i] / f.n[i];
        const pTop = f.top[i] / f.n[i];
        return { lab, n: f.n[i], mean, pTop,
          lift: metric === 'ep' ? mean / D.mean : pTop / 0.01 };
      }).filter(Boolean);
      // Rank on buckets big enough to be a property rather than an anecdote: "digit
      // sum 0" is the single number 0, and its enormous score would otherwise put
      // every panel containing one such bucket at the top. Small buckets are still
      // shown - they are just marked, and left out of the ranking.
      const MIN = D.N / 1000;
      const solid = buckets.filter(b => b.n >= MIN && b.lift > 0).map(b => b.lift);
      const spread = solid.length > 1 ? Math.max(...solid) / Math.min(...solid) : 1;
      buckets.forEach(b => { b.thin = b.n < MIN; });
      return { f, buckets, spread };
    }).sort((a, b) => b.spread - a.spread);

    $('panels').innerHTML = rows.map(({ f, buckets, spread }) => {
      const maxLift = Math.max(...buckets.map(b => b.lift), 1);
      return `<section class="card panel">
        <h2>${f.label} <em>${spread >= 10 ? Math.round(spread) : spread.toFixed(1)}x spread</em></h2>
        ${f.note ? `<p class="small">${f.note}</p>` : ''}
        ${buckets.map(b => `<div class="brow${b.thin ? ' thin' : ''}"${
          b.thin ? ' title="too few numbers to count towards the ranking"' : ''}>
          <span class="bl">${b.lab}</span>
          <span class="bbar"><i class="${b.lift >= 1 ? 'up' : 'dn'}"
            style="width:${(100 * b.lift / maxLift).toFixed(2)}%"></i></span>
          <span class="bv">${b.lift >= 10 ? Math.round(b.lift) : b.lift.toFixed(2)}x</span>
          <span class="bn">${compact(b.n)}</span>
        </div>`).join('')}
      </section>`;
    }).join('');
  }

  $('metric').addEventListener('change', e => { metric = e.target.value; panels(); });

  betaBoot(WORKER_SRC).then(({ data }) => {
    D = data;
    $('page').classList.add('on');
    $('lead').innerHTML = `Every bar is a <b>lift</b>: how a group's average compares with the range as a
      whole. The mean roll is <b>${fmt(D.mean)} EP</b>, so 2x means that group averages twice that, and
      1x means the property makes no difference at all. Panels are ordered by how much spread the
      property produces, so the ones that matter come first.`;
    panels();
  });
}

function renderAnatomy() {
  const css = `
  #page { display:none; }
  #page.on { display:block; }
  #lead { font-size:.86rem; color:var(--dim); line-height:1.65; margin-bottom:1.2rem;
    border-left:3px solid var(--hl); padding-left:.9rem; }
  #lead b { color:var(--text); font-weight:600; }
  .bar { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-bottom:1rem; }
  .bar label { font-size:.78rem; color:var(--muted); }
  .bar select { font-size:.85rem; padding:.4rem .5rem; }

  /* Columns, not grid: the panels are wildly different heights (digit sum has 55 rows,
     palindrome has 2) and a grid would leave a screen of empty space beside the tall one. */
  #panels { columns:340px; column-gap:.8rem; }
  #panels .panel { break-inside:avoid; margin:0 0 .8rem; }
  .panel h2 em { font-style:normal; font-weight:500; letter-spacing:0; text-transform:none;
    color:var(--faint); font-family:var(--mono); float:right; }
  .panel p.small { margin:-.4rem 0 .7rem; font-size:.76rem; color:var(--muted); line-height:1.5; }
  .brow { display:grid; grid-template-columns:5.4rem 1fr 3.2rem 3.2rem; align-items:center; gap:.5rem;
    padding:.16rem 0; font-size:.8rem; }
  .brow .bl { color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .brow .bbar { height:9px; border-radius:var(--r-pill); background:var(--surface-2); overflow:hidden; }
  .brow .bbar i { display:block; height:100%; }
  .brow .bbar i.up { background:var(--accent); }
  .brow .bbar i.dn { background:var(--border-3); }
  .brow .bv { text-align:right; font-family:var(--mono); font-size:.76rem; color:var(--hl-lt);
    font-variant-numeric:tabular-nums; }
  .brow .bn { text-align:right; font-family:var(--mono); font-size:.7rem; color:var(--faint); }
  .brow.thin { opacity:.45; }
  .brow.thin .bv { color:var(--muted); }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Anatomy <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">Which plain properties of a number actually move its score - and which ones sound
    like they should and do not.</p>

  <div id="page">
    <div id="lead"></div>
    <div class="bar">
      <label for="metric">Measure</label>
      <select id="metric">
        <option value="ep">Mean EP, against the range average</option>
        <option value="top">Chance of a top 1% roll, against 1 in 100</option>
      </select>
    </div>
    <div id="panels"></div>
  </div>

  <footer>
    Every group is measured over all 1,000,001 legal rolls. <b>Divisible by</b> is the one panel whose
    groups overlap - a number can be divisible by both 2 and 3 - so its bars are per rule rather than a
    partition, and its final row is the numbers divisible by nothing under 12. <b>Digit shape</b> counts
    a repdigit as flat, and every single-digit number as flat by definition.
  </footer>
</div>
${overlayHTML('Then measuring ten plain properties of every number against its score.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(anatomyWorker))};
(${anatomyClient.toString()})(__W);`;

  return betaShell({ title: 'RNGdle - Anatomy', width: '1080px', slug: 'anatomy', css, body, script });
}

// ---------------------------------------------------------------------------
// /beta/contact - all 230 badge maps on one sheet.
//
// /grid can show where any ONE badge fires on the 1000x1000 map. That is the right
// tool for reading a single rule and the wrong one for comparing rules, because you
// can only ever hold one in your head at a time.
//
// So: every badge as a 100x100 thumbnail of the same map, all on one page. Rules with
// the same geometry become obvious side by side - the "contains a digit" badges are
// wash, the divisibility badges are fine weave, the digit-length ones are hard bands -
// and the odd one out in a family stands out immediately.
//
// Each thumbnail is a 10x10 block count, so a block is lit if any of its hundred
// numbers earns the badge; at this size that is the honest reduction, and it keeps the
// whole sheet inside 2.3MB.
// ---------------------------------------------------------------------------

function contactWorker() {
  const T = 100;                                  // thumbnail side, 10x10 numbers per cell

  self.onmessage = async ev => {
    if (ev.data.cmd !== 'init') return;
    try {
      const swept = await betaSweep(ev.data.origin, 0.6);
      const bits = swept.bits, ROW = swept.ROW;
      const B = E.BADGE_META.length;
      const N = 1000000;                          // the square face of the range

      // A block holds 100 numbers, so a count never exceeds 100 and fits in a byte.
      const maps = new Uint8Array(B * T * T);
      const total = new Float64Array(B);
      const idx = new Int32Array(256);
      for (let n = 0; n < N; n++) {
        if ((n & 0x3ffff) === 0) self.postMessage({ type: 'progress', pct: 0.6 + 0.4 * (n / N) });
        const k = betaEarned(bits, n * ROW, ROW, idx);
        if (!k) continue;
        const cell = ((n / 1000 / 10) | 0) * T + (((n % 1000) / 10) | 0);
        for (let a = 0; a < k; a++) { maps[idx[a] * T * T + cell]++; total[idx[a]]++; }
      }
      self.postMessage({ type: 'ready', maps: maps.buffer, total: total.buffer, T, B, N },
        [maps.buffer, total.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  };
}

// META[i] = [label, emoji, ep, tier, familyIndex, id]
function contactClient(WORKER_SRC, META, PAL) {
  const B = META.length;
  const $ = id => document.getElementById(id);
  const pctf = p => p === 0 ? '0%' : p >= 1 ? p.toFixed(1) + '%' : p >= 0.01 ? p.toFixed(2) + '%' : p.toFixed(4) + '%';
  let MAPS = null, TOTAL = null, T = 100, N = 0, norm = 'row', sort = 'family';
  let similarOrder = null;

  // Order by how much the pictures themselves look alike: reduce each map to a 20x20
  // presence vector, take cosine similarity, and cluster with average linkage. The
  // family order groups badges the game says are related; this groups the ones that
  // actually fire in the same places, which is what the sheet is for.
  function bySimilarity() {
    if (similarOrder) return similarOrder;
    const R = 20, step = T / R;                  // 100 -> 20, so 400 dims per badge
    const V = new Float32Array(B * R * R);
    for (let i = 0; i < B; i++) {
      const base = i * T * T, out = i * R * R;
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          if (MAPS[base + y * T + x]) V[out + ((y / step) | 0) * R + ((x / step) | 0)] = 1;
        }
      }
      let n2 = 0;
      for (let k = 0; k < R * R; k++) n2 += V[out + k];
      const inv = n2 ? 1 / Math.sqrt(n2) : 0;    // values are 0/1, so the norm is sqrt(count)
      for (let k = 0; k < R * R; k++) V[out + k] *= inv;
    }
    const D = [];
    for (let i = 0; i < B; i++) D.push(new Float32Array(B));
    for (let i = 0; i < B; i++) {
      for (let j = i + 1; j < B; j++) {
        let dot = 0;
        const a = i * R * R, b = j * R * R;
        for (let k = 0; k < R * R; k++) dot += V[a + k] * V[b + k];
        const d = 1 - dot;
        D[i][j] = d; D[j][i] = d;
      }
    }
    const groups = Array.from({ length: B }, (_, i) => [i]);
    const live = Array.from({ length: B }, (_, i) => i);
    while (live.length > 1) {
      let bi = 0, bj = 1, best = Infinity;
      for (let a = 0; a < live.length; a++) {
        for (let b = a + 1; b < live.length; b++) {
          const v = D[live[a]][live[b]];
          if (v < best) { best = v; bi = a; bj = b; }
        }
      }
      const gi = live[bi], gj = live[bj], ni = groups[gi].length, nj = groups[gj].length;
      for (const g of live) {
        if (g === gi || g === gj) continue;
        const v = (D[gi][g] * ni + D[gj][g] * nj) / (ni + nj);
        D[gi][g] = v; D[g][gi] = v;
      }
      groups[gi] = groups[gi].concat(groups[gj]);
      live.splice(bj, 1);
    }
    similarOrder = groups[live[0]];
    return similarOrder;
  }

  function order() {
    const all = Array.from({ length: B }, (_, i) => i);
    if (sort === 'similar') return bySimilarity().slice();
    if (sort === 'ep') return all.sort((a, b) => META[b][2] - META[a][2] || a - b);
    if (sort === 'rate') return all.sort((a, b) => TOTAL[b] - TOTAL[a] || a - b);
    if (sort === 'alpha') return all.sort((a, b) => META[a][0].localeCompare(META[b][0]));
    return all.sort((a, b) => {
      const fa = META[a][4] < 0 ? 999 : META[a][4], fb = META[b][4] < 0 ? 999 : META[b][4];
      return fa - fb || META[b][2] - META[a][2] || a - b;
    });
  }

  function paint(cv, i) {
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(T, T);
    const px = img.data;
    const base = i * T * T;
    let mx = 0;
    for (let c = 0; c < T * T; c++) if (MAPS[base + c] > mx) mx = MAPS[base + c];
    const cap = norm === 'row' ? Math.max(1, mx) : 100;
    const [r, g, b] = hex(PAL[META[i][3]]);
    // A badge earned by three numbers lights three cells out of ten thousand, which at
    // this size is one dim pixel and reads as an empty tile. Below ~60 lit cells the
    // marks are grown to 3x3 so they are visible; the position is still exact, and the
    // sheet says so.
    let lit = 0;
    for (let c = 0; c < T * T; c++) if (MAPS[base + c]) lit++;
    const grow = lit > 0 && lit < 60;

    const alpha = new Float32Array(T * T);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const v = MAPS[base + y * T + x];
        if (!v) continue;
        const a = 0.35 + 0.65 * (Math.log1p(v) / Math.log1p(cap));
        if (!grow) { alpha[y * T + x] = Math.max(alpha[y * T + x], a); continue; }
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= T) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= T) continue;
            const w = dx || dy ? a * 0.55 : a;
            const at = yy * T + xx;
            if (w > alpha[at]) alpha[at] = w;
          }
        }
      }
    }
    for (let c = 0; c < T * T; c++) {
      const a = alpha[c], k = c * 4;
      px[k] = 14 + (r - 14) * a; px[k + 1] = 15 + (g - 15) * a; px[k + 2] = 20 + (b - 20) * a;
      px[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  function render() {
    const q = $('q').value.trim().toLowerCase();
    const list = order().filter(i => !q || META[i][0].toLowerCase().includes(q));
    $('sheet').innerHTML = list.map(i => `<a class="tile" href="/grid#${encodeURIComponent(META[i][0])}"
      title="${META[i][0]} - ${pctf(100 * TOTAL[i] / N)} of numbers, open on /grid"
      style="--tc:${PAL[META[i][3]]}">
      <canvas width="${T}" height="${T}" data-i="${i}"></canvas>
      <span class="tl">${META[i][1]} ${META[i][0]}</span>
      <span class="tr">${pctf(100 * TOTAL[i] / N)}</span>
    </a>`).join('');
    for (const cv of $('sheet').querySelectorAll('canvas')) paint(cv, Number(cv.dataset.i));
    $('count').textContent = list.length === B ? `${B} badges` : `${list.length} of ${B}`;
  }

  $('q').addEventListener('input', render);
  $('sort').addEventListener('change', e => {
    sort = e.target.value;
    // The similarity clustering is a second or so the first time; let the select
    // repaint as disabled rather than freezing on the old view with no explanation.
    if (sort === 'similar' && !similarOrder) {
      $('sort').disabled = true;
      $('count').textContent = 'grouping by what the maps look like…';
      setTimeout(() => { render(); $('sort').disabled = false; }, 16);
      return;
    }
    render();
  });
  $('norm').addEventListener('change', e => { norm = e.target.value; render(); });

  betaBoot(WORKER_SRC).then(({ data }) => {
    MAPS = new Uint8Array(data.maps); TOTAL = new Float64Array(data.total);
    T = data.T; N = data.N;
    $('page').classList.add('on');
    render();
  });
}

function renderContact(ctx) {
  const { BADGES, FAMILIES, TIER_PALETTE, tierFromScore } = ctx;
  const famOf = new Map();
  FAMILIES.forEach((fam, fi) => { for (const id of fam) famOf.set(id, fi); });
  const meta = BADGES.map(([id, label, emoji, ep]) =>
    [label, emoji, ep, tierFromScore(ep), famOf.has(id) ? famOf.get(id) : -1, id]);
  const pal = Object.fromEntries(Object.entries(TIER_PALETTE).map(([k, v]) => [k, v.accent]));

  const css = `
  #page { display:none; }
  #page.on { display:block; }
  .bar { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; align-items:center; gap:.5rem;
    padding:.7rem 0 .6rem; margin-bottom:.6rem;
    background:linear-gradient(var(--bg) 86%, transparent); border-bottom:1px solid var(--border); }
  .bar label { font-size:.78rem; color:var(--muted); }
  .bar select { font-size:.85rem; padding:.4rem .5rem; }
  #q { flex:1 1 180px; min-width:150px; }
  #count { flex-basis:100%; font-size:.74rem; color:var(--faint); }

  #sheet { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(132px,100%),1fr)); gap:.5rem; }
  .tile { display:flex; flex-direction:column; gap:.25rem; padding:.35rem; text-decoration:none;
    border:1px solid var(--border); border-radius:var(--r-card); background:var(--surface);
    color:var(--dim); transition:border-color .12s, transform .12s; }
  .tile:hover { border-color:var(--tc); transform:translateY(-2px); }
  .tile canvas { width:100%; height:auto; aspect-ratio:1; display:block; border-radius:var(--r-sm);
    image-rendering:pixelated; background:#0a0b0f; }
  .tl { font-size:.72rem; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tr { font-size:.66rem; color:var(--faint); font-family:var(--mono); }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Contact Sheet <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">Every badge's map, all at once. Across is n mod 1000, down is n / 1000 - the same
    frame as /grid, one hundredth the size.</p>

  <div id="page">
    <div class="bar">
      <input id="q" type="search" placeholder="Find a badge…" autocomplete="off">
      <label for="sort">Order</label>
      <select id="sort">
        <option value="family">Family</option>
        <option value="similar">Similar maps together</option>
        <option value="rate">How often earned</option>
        <option value="ep">EP</option>
        <option value="alpha">Name</option>
      </select>
      <label for="norm">Brightness</label>
      <select id="norm">
        <option value="row">Per badge</option>
        <option value="abs">Absolute</option>
      </select>
      <span id="count"></span>
    </div>
    <div id="sheet"></div>
  </div>

  <footer>
    Each thumbnail is a 100x100 reduction of the full map: one cell per block of a hundred consecutive
    numbers, lit in proportion to how many of them earn the badge. <b>Per badge</b> scales each
    thumbnail to its own busiest block, which is what makes a rule earned ten times in the whole range
    visible at all; <b>absolute</b> puts them on one scale. <b>Similar maps together</b> ignores the
    game's taxonomy entirely and clusters the pictures themselves - each map reduced to a 20x20
    presence vector, average linkage on cosine distance - so rules that fire in the same places end up
    adjacent whatever family they were filed under. Badges lighting fewer than 60 of the 10,000
    cells have their marks <b>grown to 3x3</b> - the positions are still exact, but a single cell would
    be one dim pixel and read as an empty tile. Ordering by family puts each family's members next to
    each other, which is where the odd one out shows up. Click any tile for its full-resolution map on
    <a href="/grid">/grid</a>.
  </footer>
</div>
${overlayHTML('Then reducing all 230 badge maps to thumbnails.')}`;

  const script = `${BETA_BOOT_JS}
const __W = ${JSON.stringify(workerSrc(contactWorker))};
(${contactClient.toString()})(__W, ${JSON.stringify(meta)}, ${JSON.stringify(pal)});`;

  return betaShell({ title: 'RNGdle - Contact Sheet', width: '1180px', slug: 'contact', css, body, script });
}


// ---------------------------------------------------------------------------
// /beta/collection - which badges a player is actually missing.
//
// /u counts a player's distinct badges; nothing anywhere says WHICH. This does, and
// then ranks the missing ones by how long the wait for each realistically is.
//
// The only tool here that does not sweep. It does not need to: a player has a few
// hundred rolls, so scoring them one at a time through the engine is instant, and every
// badge's exact share of the range is already committed in probabilities.gen.js. So it
// loads in well under a second even on a cold browser, which for the one tool a player
// is most likely to open first is worth more than consistency with the others.
// ---------------------------------------------------------------------------

// META[i] = [label, emoji, ep, tier, familyIndex, id, probPercent]
function collectionClient(META, TIERS, PAL) {
  const B = META.length;
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString();
  const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : fmt(n);
  const pctf = p => p === 0 ? '0%' : p >= 1 ? p.toFixed(1) + '%' : p >= 0.01 ? p.toFixed(2) + '%' : p.toFixed(4) + '%';
  const tierOf = ep => { let x = TIERS[0]; for (const y of TIERS) if (ep >= y.lo) x = y; return x; };
  let E = null, group = 'rarity';
  let have = null, rolls = 0, who = '';

  async function engine() {
    if (!E) E = await import(location.origin + '/engine.js');
    return E;
  }

  function order() {
    const all = Array.from({ length: B }, (_, i) => i);
    if (group === 'family') {
      return all.sort((a, b) => {
        const fa = META[a][4] < 0 ? 999 : META[a][4], fb = META[b][4] < 0 ? 999 : META[b][4];
        return fa - fb || META[b][2] - META[a][2] || a - b;
      });
    }
    if (group === 'missing') {
      // Rarest first among what you have, commonest first among what you do not - so
      // the top of the list is your best badge and the bottom is the wall.
      return all.sort((a, b) => (have[a] === have[b])
        ? (have[a] ? META[b][2] - META[a][2] : META[a][2] - META[b][2])
        : (have[b] ? 1 : -1) - (have[a] ? 1 : -1));
    }
    return all.sort((a, b) => META[b][2] - META[a][2] || a - b);   // rarity
  }

  function render() {
    const got = [], missing = [];
    for (let i = 0; i < B; i++) (have[i] ? got : missing).push(i);

    $('grid').innerHTML = order().map(i => {
      const m = META[i], mine = have[i];
      return `<a class="cb${mine ? ' on' : ''}" href="/badges#${m[5]}" style="--tc:${PAL[m[3]]}"
        title="${m[0]} - ${pctf(m[6])} of numbers earn it${mine ? '' : ' - not yet'}">
        <span class="ce">${m[1]}</span><span class="cn">${m[0]}</span></a>`;
    }).join('');

    // Expected rolls for the next one of each missing badge is 1/p; the chance of
    // getting it within another `rolls` is 1-(1-p)^rolls, which is the number that
    // actually answers "is this ever happening".
    const soon = missing.map(i => ({ i, p: META[i][6] / 100 }))
      .sort((a, b) => b.p - a.p);
    const again = Math.max(rolls, 1);
    $('next').innerHTML = soon.slice(0, 12).map(x => `<a class="mrow" href="/badges#${META[x.i][5]}">
      <span class="me">${META[x.i][1]}</span>
      <span class="ml">${META[x.i][0]}<em>${pctf(META[x.i][6])} of numbers</em></span>
      <span class="mv">${x.p > 0 ? compact(1 / x.p) + ' rolls' : 'unreachable'}
        <i>${(100 * (1 - Math.pow(1 - x.p, again))).toFixed(0)}% in another ${fmt(again)}</i></span></a>`).join('')
      || '<p class="muted small">Nothing left to collect.</p>';

    const wall = soon.slice(-8).reverse();
    $('wall').innerHTML = wall.map(x => `<a class="mrow" href="/badges#${META[x.i][5]}">
      <span class="me">${META[x.i][1]}</span>
      <span class="ml">${META[x.i][0]}<em>${pctf(META[x.i][6])} of numbers</em></span>
      <span class="mv">${x.p > 0 ? compact(1 / x.p) + ' rolls' : 'unreachable'}</span></a>`).join('');

    const rarest = got.slice().sort((a, b) => META[b][2] - META[a][2])[0];
    const t = rarest === undefined ? null : tierOf(META[rarest][2]);
    // Expected count after this many rolls, so "am I ahead or behind" has an answer.
    let expect = 0;
    for (let i = 0; i < B; i++) expect += 1 - Math.pow(1 - META[i][6] / 100, again);

    $('stats').innerHTML = `
      <div class="stat stat-lg"><span class="k">Collected</span><span class="v">${got.length}</span>
        <span class="sub">of ${B} badges · ${(100 * got.length / B).toFixed(0)}%</span></div>
      <div class="stat stat-lg"><span class="k">Par for ${fmt(rolls)} rolls</span><span class="v">${expect.toFixed(0)}</span>
        <span class="sub">${got.length >= expect ? 'you are ahead of' : 'you are behind'} the average collection</span></div>
      <div class="stat stat-lg"><span class="k">Rarest so far</span><span class="v">${
        rarest === undefined ? '-' : pctf(META[rarest][6])}</span>
        <span class="sub">${rarest === undefined ? 'nothing yet'
          : `${META[rarest][1]} ${META[rarest][0]} · <span class="pill" style="--tc:${t.accent}">${t.label}</span>`}</span></div>
      <div class="stat stat-lg"><span class="k">Still missing</span><span class="v">${missing.length}</span>
        <span class="sub">${missing.filter(i => META[i][6] < 0.001).length} of them one-in-a-million</span></div>`;

    $('who').innerHTML = `<span class="wn">${who}</span><span class="wr">${fmt(rolls)} rolls scored</span>`;
    $('out').classList.add('on');
  }

  async function analyse(nums, label) {
    const valid = nums.filter(n => Number.isInteger(n) && n >= 0 && n <= 1000000);
    if (!valid.length) { $('msg').innerHTML = '<p class="err">No usable numbers.</p>'; return; }
    $('msg').innerHTML = '<div class="loading"><span class="spinner"></span>Scoring…</div>';
    const eng = await engine();
    have = new Uint8Array(B);
    for (const n of valid) for (const i of eng.computeLean(n).earned) have[i] = 1;
    rolls = valid.length; who = label;
    $('msg').innerHTML = '';
    render();
  }

  $('user-form').addEventListener('submit', async e => {
    e.preventDefault();
    const u = ($('user').value.match(/[A-Za-z0-9_.-]+/) || [])[0];
    if (!u) return;
    $('msg').innerHTML = '<div class="loading"><span class="spinner"></span>Loading rolls…</div>';
    try {
      const r = await fetch('/api/profile?u=' + encodeURIComponent(u));
      const d = await r.json();
      if (!r.ok || !d.scored) throw new Error(d.error || 'could not load that player');
      await analyse(d.scored.map(x => x.number), d.username || u);
    } catch (err) {
      $('msg').innerHTML = `<p class="err">${err.message}</p>`;
    }
  });
  $('paste-go').addEventListener('click', () => {
    analyse(($('paste').value.match(/\d+/g) || []).map(Number), 'Pasted rolls');
  });
  $('group').addEventListener('change', e => { group = e.target.value; if (have) render(); });

  const u = new URLSearchParams(location.search).get('u');
  if (u) { $('user').value = u; $('user-form').dispatchEvent(new Event('submit')); }
}

function renderCollection(ctx) {
  const { BADGES, FAMILIES, PROBABILITIES, TIER_PALETTE, CARD_TIERS, CARD_TIER_NAMES, tierFromScore } = ctx;
  const famOf = new Map();
  FAMILIES.forEach((fam, fi) => { for (const id of fam) famOf.set(id, fi); });
  const meta = BADGES.map(([id, label, emoji, ep]) =>
    [label, emoji, ep, tierFromScore(ep), famOf.has(id) ? famOf.get(id) : -1, id, PROBABILITIES[id] ?? 0]);
  const tiers = CARD_TIER_NAMES.map((key, i) => ({
    label: TIER_PALETTE[key].label, accent: TIER_PALETTE[key].accent,
    lo: i === 0 ? 0 : CARD_TIERS[i - 1][0],
  }));
  const pal = Object.fromEntries(Object.entries(TIER_PALETTE).map(([k, v]) => [k, v.accent]));

  const css = `
  .card { margin-bottom:.9rem; }
  .card > p.small { margin:-.35rem 0 .8rem; font-size:.8rem; color:var(--muted); line-height:1.6; }
  .small { font-size:.8rem; line-height:1.6; }
  .inputs { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(280px,100%),1fr)); gap:.8rem; }
  .inputs label { display:block; font-size:.72rem; letter-spacing:.06em; text-transform:uppercase;
    color:var(--faint); font-weight:600; margin-bottom:.3rem; }
  #user-form { display:flex; gap:.5rem; }
  #user { flex:1; min-width:0; }
  #paste { width:100%; height:56px; resize:vertical; font-family:var(--mono); font-size:.8rem; }
  #paste-go { margin-top:.4rem; }
  #msg { margin-top:.7rem; }
  .loading { display:flex; align-items:center; gap:.6rem; color:var(--muted); font-size:.86rem; }

  #out { display:none; }
  #out.on { display:block; }
  #who { display:flex; align-items:baseline; gap:.7rem; margin:1.3rem 0 .8rem; }
  #who .wn { font-size:1.15rem; font-weight:600; }
  #who .wr { font-size:.82rem; color:var(--muted); }
  #stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(190px,100%),1fr)); gap:.6rem;
    margin-bottom:1.1rem; }
  #stats .stat { min-width:0; overflow-wrap:anywhere; }

  .bar { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-bottom:.8rem; }
  .bar label { font-size:.78rem; color:var(--muted); }
  .bar select { font-size:.85rem; padding:.4rem .5rem; }
  #grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(132px,100%),1fr)); gap:.3rem; }
  .cb { display:flex; align-items:center; gap:.35rem; padding:.3rem .45rem; text-decoration:none;
    border:1px solid var(--border); border-radius:var(--r-sm); background:var(--surface);
    color:var(--faint); font-size:.75rem; opacity:.45; }
  .cb.on { opacity:1; color:var(--text); border-color:color-mix(in srgb, var(--tc) 55%, transparent);
    background:color-mix(in srgb, var(--tc) 12%, var(--surface)); }
  .cb:hover { border-color:var(--tc); opacity:1; }
  .cb .ce { flex:0 0 auto; }
  .cb .cn { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .two { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(340px,100%),1fr)); gap:.9rem; }
  .mrow { display:flex; align-items:center; gap:.55rem; padding:.34rem .3rem; text-decoration:none;
    border-radius:var(--r-sm); color:var(--dim); }
  .mrow:hover { background:var(--surface-2); color:var(--text); }
  .mrow .me { flex:0 0 auto; }
  .mrow .ml { flex:1; min-width:0; font-size:.85rem; display:flex; flex-direction:column; }
  .mrow .ml em { font-style:normal; font-size:.72rem; color:var(--faint); font-family:var(--mono); }
  .mrow .mv { flex:0 0 auto; text-align:right; font-family:var(--mono); font-size:.78rem;
    color:var(--hl-lt); font-variant-numeric:tabular-nums; }
  .mrow .mv i { display:block; font-style:normal; font-size:.68rem; color:var(--faint); }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Your Collection <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">Which of the 230 badges you have, which you do not, and how long the ones you are
    missing would realistically take.</p>

  <section class="card">
    <div class="inputs">
      <div><label for="user">rngdle player</label>
        <form id="user-form"><input id="user" type="text" placeholder="username" autocomplete="off">
          <button type="submit" class="btn-primary btn-sm">Look up</button></form></div>
      <div><label for="paste">or paste rolls</label>
        <textarea id="paste" placeholder="123456, 696969, 100000"></textarea>
        <button type="button" id="paste-go" class="btn-sm">Score them</button></div>
    </div>
    <div id="msg"></div>
  </section>

  <div id="out">
    <div id="who"></div>
    <div id="stats"></div>

    <div class="bar">
      <label for="group">Order</label>
      <select id="group">
        <option value="rarity">Rarest first</option>
        <option value="missing">Collected first, then the gaps</option>
        <option value="family">Family</option>
      </select>
    </div>
    <div id="grid"></div>

    <div class="two" style="margin-top:1.2rem">
      <section class="card"><h2>Closest to your next one</h2>
        <p class="small">Missing badges you are most likely to pick up, with the expected wait for
          each and the chance of it inside another run the length of the one you have had.</p>
        <div id="next"></div></section>
      <section class="card"><h2>The wall</h2>
        <p class="small">The rarest things you do not have. These are the ones that decide whether
          the set is ever finished.</p>
        <div id="wall"></div></section>
    </div>
  </div>

  <footer>
    Rolls come from rngdle's public API and are scored here, in your browser, with the same engine
    the rest of the site uses - so this reflects the live badge rules, not a stored collection.
    <b>Expected wait</b> is 1 / the badge's exact share of the range, and the percentage beside it is
    1 - (1 - p)^n for another n rolls. This is the one tool in the lab that does not need the full
    sweep: a few hundred rolls score instantly, and every badge's rate is already known.
  </footer>
</div>`;

  const script = `(${collectionClient.toString()})(${JSON.stringify(meta)}, ${JSON.stringify(tiers)},
  ${JSON.stringify(pal)});`;

  return betaShell({ title: 'RNGdle - Your Collection', width: '1080px', slug: 'collection', css, body, script });
}

// ---------------------------------------------------------------------------
// Box Lab
//
// rngdle.com paints a roll into a set of styled boxes, and that styling is not in
// the JS bundle we already mine for badge rules - it is a Tailwind v4 stylesheet
// with a hand-written token layer on top. The constants below are read straight
// out of it (/_next/static/chunks/40301e47118b0e38.css, fetched 2026-08-19).
//
// Two things there are worth a tool. First, prod's tier colours are theme-aware:
// seven of them, written in oklch, with a whole second set swapped in under .dark
// - which is why TIER_PALETTE in index.js (lifted from the older RARITY_PALETTE,
// one fixed set) is not what the live site paints. Second, the box itself has
// several recipes - a plain card, a holographic overlay, a five-colour halo, a
// pulse - and none of them is guessable from the colour values alone.
//
// So: put one number in every box at once. The custom palette below that is the
// point of the page - prod's seven words and seven colours are a starting guess,
// not a fact, and this is where a different guess gets to look like something.
// ---------------------------------------------------------------------------

// Prod's seven tier colours, both themes. Each entry is [oklch, hex]: prod writes
// oklch and the preview paints with it verbatim, but a colour input cannot seed
// from oklch, so the sRGB equivalent rides along for the editor. (They are all
// Tailwind palette stops - light is the 700-ish rung, dark the 300/400 rung.)
const PROD_TIERS = [
  { key: 'trash',    word: 'TRASH',
    light: ['oklch(42.1% .095 57.708)',  '#733e0a'], dark: ['oklch(87.9% .169 91.605)',  '#ffd230'] },
  { key: 'common',   word: 'COMMON',
    light: ['oklch(44.6% .03 256.802)',  '#4a5565'], dark: ['oklch(87.2% .01 258.338)',  '#d1d5dc'] },
  { key: 'uncommon', word: 'UNCOMMON',
    light: ['oklch(52.7% .154 150.069)', '#008236'], dark: ['oklch(76.5% .177 163.223)', '#00d492'] },
  { key: 'rare',     word: 'RARE',
    light: ['oklch(48.8% .243 264.376)', '#1447e6'], dark: ['oklch(70.7% .165 254.624)', '#51a2ff'] },
  { key: 'epic',     word: 'EPIC',
    light: ['oklch(49.6% .265 301.924)', '#8200db'], dark: ['oklch(71.4% .203 305.504)', '#c27aff'] },
  { key: 'anomaly',  word: 'ANOMALY',
    light: ['oklch(55.3% .195 38.402)',  '#ca3500'], dark: ['oklch(75% .183 55.934)',    '#ff8904'] },
  { key: 'mythic',   word: 'MYTHIC',
    light: ['oklch(50.5% .213 27.518)',  '#c10007'], dark: ['oklch(70.4% .191 22.216)',  '#ff6467'] },
];

// --favorite-ring-*, the five colours of prod's halo. Declared once, with no .dark
// override - they are exactly the dark-theme tier colours of the top five tiers,
// so the halo is the same rainbow whichever theme is on.
const PROD_RINGS = ['#ff6467', '#c27aff', '#51a2ff', '#00d492', '#ff8904'];

// The stops --cta-ring-a/b walk through in prod's cta-rarity-cycle keyframes.
const PROD_CTA = ['#ec4899', '#a855f7', '#3b82f6', '#10b981', '#f97316'];

// Prod's surface/ink tokens for both themes, so the preview strip sits on the
// right ground - a box only reads correctly against the background it ships on.
const PROD_SURFACES = {
  light: { bg: '#fafafa', surface: '#ffffff', dim: '#f9fafb', raised: '#f3f4f6',
           outline: '#e5e7eb', mid: '#d1d5db', strong: '#9ca3af',
           prose: '#111827', prose2: '#4b5563', prose3: '#9ca3af' },
  dark:  { bg: '#111017', surface: '#242229', dim: '#1a1820', raised: '#312f37',
           outline: '#47454d', mid: '#525159', strong: '#63616a',
           prose: '#f0f0f0', prose2: '#c4c4c4', prose3: '#9a9a9a' },
};

// The scoring box, tier by tier, resolved from prod's own rarity table (the one keyed
// `background`/`border`/`glow`/`innerGlow`/`textColor`/`shimmer` in chunk 13342e74).
// Prod writes these as Tailwind utility strings; the CSS below is those utilities
// resolved against prod's own v4 palette tokens - [light, dark] for every field.
//
// This table is the reason the tool stopped guessing. The boxes are hand-designed per
// tier, not generated from one colour ramp: mythic spans three families (rose ->
// purple -> cyan) and drops the tier colour off the digits entirely, while trash and
// common have no glow at all and no shimmer layer. None of that is derivable from any
// other tier, which is exactly what an earlier extrapolation here got wrong.
//
// Two details are deliberate, not typos. The glow literals are Tailwind v3 stops -
// rgba(16,185,129) is v3's emerald-500, where the current token is #00bc7d - because
// prod hard-codes them and never migrated; matching prod means keeping the literals.
// And `shim:false` on trash/common is prod's own flag, which is why those two get a
// plain drop shadow where the rest get a coloured glow.
const SCORE_TIERS = {
  trash: {
    bg:  ['linear-gradient(to bottom right, #fffbeb, #ffffff, #fffbeb)',
          'linear-gradient(to bottom right, rgba(123,51,6,0.6), #27272a, rgba(123,51,6,0.6))'],
    bd:  ['#ffd230', '#973c00'],
    sh:  ['0 10px 15px -3px rgba(16,24,40,0.2), 0 4px 6px -4px rgba(16,24,40,0.2), inset 0 2px 4px 0 rgba(254,243,198,0.5)',
          '0 10px 15px -3px rgba(16,24,40,0.2), 0 4px 6px -4px rgba(16,24,40,0.2), inset 0 2px 4px 0 rgba(123,51,6,0.2)'],
    ink: ['#973c00', '#ffd230'], shim: false,
  },
  common: {
    bg:  ['linear-gradient(to bottom right, #f3f4f6, #ffffff, #f3f4f6)',
          'linear-gradient(to bottom right, rgba(63,63,70,0.5), #27272a, rgba(63,63,70,0.5))'],
    bd:  ['#99a1af', '#52525c'],
    sh:  ['0 10px 15px -3px rgba(16,24,40,0.2), 0 4px 6px -4px rgba(16,24,40,0.2), inset 0 2px 4px 0 rgba(229,231,235,0.5)',
          '0 10px 15px -3px rgba(16,24,40,0.2), 0 4px 6px -4px rgba(16,24,40,0.2), inset 0 2px 4px 0 rgba(39,39,42,0.5)'],
    ink: ['#364153', '#d1d5dc'], shim: false,
  },
  uncommon: {
    bg:  ['linear-gradient(to bottom right, #d0fae5, #f0fdf4, #d0fae5)',
          'linear-gradient(to bottom right, rgba(0,79,59,0.6), #27272a, rgba(0,79,59,0.6))'],
    bd:  ['#5ee9b5', '#006045'],
    sh:  ['0 0 10px rgba(16,185,129,0.2), inset 0 2px 4px 0 rgba(164,244,207,0.6)',
          '0 0 14px rgba(16,185,129,0.35), inset 0 2px 4px 0 rgba(0,79,59,0.3)'],
    ink: ['#006045', '#00d492'], shim: true,
  },
  rare: {
    bg:  ['linear-gradient(to bottom right, #dbeafe, #f0f9ff, #dbeafe)',
          'linear-gradient(to bottom right, rgba(28,57,142,0.6), #27272a, rgba(28,57,142,0.6))'],
    bd:  ['#8ec5ff', '#193cb8'],
    sh:  ['0 0 12px rgba(59,130,246,0.25), inset 0 2px 4px 0 rgba(190,219,255,0.6)',
          '0 0 16px rgba(59,130,246,0.4), inset 0 2px 4px 0 rgba(28,57,142,0.3)'],
    ink: ['#193cb8', '#51a2ff'], shim: true,
  },
  epic: {
    bg:  ['linear-gradient(to bottom right, #f3e8ff, #fdf4ff, #f3e8ff)',
          'linear-gradient(to bottom right, rgba(89,22,139,0.6), #27272a, rgba(89,22,139,0.6))'],
    bd:  ['#dab2ff', '#6e11b0'],
    sh:  ['0 0 15px rgba(168,85,247,0.25), inset 0 2px 4px 0 rgba(233,212,255,0.6)',
          '0 0 20px rgba(168,85,247,0.45), inset 0 2px 4px 0 rgba(89,22,139,0.3)'],
    ink: ['#6e11b0', '#c27aff'], shim: true,
  },
  anomaly: {
    bg:  ['linear-gradient(to bottom right, #ffedd4, #fffbeb, #ffedd4)',
          'linear-gradient(to bottom right, rgba(126,42,12,0.6), #27272a, rgba(126,42,12,0.6))'],
    bd:  ['#ffb86a', '#9f2d00'],
    sh:  ['0 0 18px rgba(249,115,22,0.25), inset 0 2px 4px 0 rgba(255,214,167,0.6)',
          '0 0 22px rgba(249,115,22,0.45), inset 0 2px 4px 0 rgba(126,42,12,0.3)'],
    ink: ['#9f2d00', '#ff8904'], shim: true,
  },
  mythic: {
    bg:  ['linear-gradient(to bottom right, #ffe4e6, #faf5ff, #cefafe)',
          'linear-gradient(to bottom right, rgba(139,8,54,0.55), rgba(89,22,139,0.45), rgba(16,78,100,0.55))'],
    bd:  ['#fda5d5', '#a3004c'],
    sh:  ['0 0 20px rgba(236,72,153,0.25),0 0 35px rgba(168,85,247,0.1), inset 0 2px 4px 0 rgba(252,206,232,0.6)',
          '0 0 24px rgba(236,72,153,0.5),0 0 42px rgba(168,85,247,0.25), inset 0 2px 4px 0 rgba(134,16,67,0.3)'],
    ink: ['#101828', '#f3f4f6'], shim: true,
  },
};

// The box recipes. src:'prod' means the rule is prod's, transcribed; src:'lab'
// means prod ships the ingredient but not this box, so it is a suggestion. Keeping
// the two apart matters - half the point of the page is knowing which is which.
const BOX_STYLES = [
  { key: 'score', name: 'Scoring box', src: 'prod', on: true,
    note: 'The real thing, rebuilt from prod\u2019s rarity table: 3px border, a three-stop diagonal ' +
      'gradient, a 135&deg; gloss sheet, a 105&deg; shimmer sweeping on a 4s loop, and the whole box ' +
      'breathing between scale(1) and scale(1.015) every 3s. Trash and common are the odd ones out - ' +
      'prod gives them a plain drop shadow and switches the shimmer off entirely.' },
  { key: 'card', name: 'Card', src: 'prod', on: true,
    note: 'prod .polished-card: 1px --outline, --surface fill, 8px radius, a soft 1px/3px shadow. ' +
      'Note what the tier colour does not do here - the box stays neutral and the colour lands only ' +
      'on the word, which is the one thing prod emits a .text-tier-* utility for.' },
  { key: 'tint', name: 'Tinted', src: 'lab', on: true,
    note: 'The same card with the tier colour mixed 55% into the border and 8% into the fill. Prod ' +
      'has the tokens for this and never does it.' },
  { key: 'ring', name: 'Ring', src: 'lab', on: true,
    note: 'Tier colour as a glow ring rather than a fill - the shape of prod&rsquo;s --favorite-ring-* ' +
      'treatment, but keyed to one tier instead of all five at once.' },
  { key: 'holo', name: 'Holographic', src: 'prod', on: true,
    note: 'prod .card-holographic-overlay: a ten-stop 125&deg; rainbow at 200% size, mix-blend-mode ' +
      'overlay, drifting on an 8s loop. Prod runs it at 3-5% alpha, which is very nearly invisible - ' +
      'switch to Amplify to see the thing you are looking at.' },
  { key: 'halo', name: 'Rainbow halo', src: 'prod', on: false,
    note: 'prod .favorite-badge-empty-attention: five offset coloured shadows at ~42% each, held at ' +
      '16% opacity and breathing to 42% once every 10s. It ignores the tier entirely - every box gets ' +
      'the same rainbow.' },
  { key: 'glow', name: 'Pulse', src: 'lab', on: false,
    note: 'prod&rsquo;s signup-glow keyframes - a 2s box-shadow breath, hard-coded orange there - ' +
      're-pointed at the tier colour.' },
  { key: 'shimmer', name: 'Shimmer', src: 'lab', on: false,
    note: 'prod&rsquo;s shimmer keyframes, a background sweeping 200% to -200%, clipped to the digits ' +
      'instead of to a skeleton block.' },
  { key: 'cycle', name: 'Rarity cycle', src: 'prod', on: false,
    note: 'prod cta-rarity-cycle: two custom properties walking pink &rarr; purple &rarr; blue &rarr; ' +
      'green &rarr; orange on a loop. Tier-blind by design - it is what a box does when it means ' +
      '&ldquo;any rarity&rdquo;, not one.' },
];

function renderBoxes(ctx) {
  const { CARD_TIERS, CARD_TIER_NAMES } = ctx;
  // Prod's tier list is index-aligned with ours, so the EP floors come from the same
  // CARD_TIERS the calculator card uses - which is what makes the number mean anything
  // here: it lands in exactly one of these boxes for real.
  const tiers = PROD_TIERS.map((t, i) => ({ ...t, lo: i === 0 ? 0 : CARD_TIERS[i - 1][0] }));
  const aligned = CARD_TIER_NAMES.join(',') === PROD_TIERS.map(t => t.key).join(',');

  const css = `
  p.tag { margin:0 0 1.4rem; }
  .small { font-size:.8rem; line-height:1.6; color:var(--muted); }
  .card { margin-bottom:.9rem; }

  /* --- controls --- */
  .bar { display:flex; flex-wrap:wrap; align-items:flex-end; gap:.9rem 1.2rem; }
  .bar .fld { display:flex; flex-direction:column; gap:.3rem; }
  .bar label { font-size:.7rem; letter-spacing:.07em; text-transform:uppercase;
    color:var(--faint); font-weight:600; }
  #n { width:9rem; font-family:var(--mono); font-size:1.05rem; letter-spacing:.04em; }
  .seg { display:inline-flex; border:1px solid var(--border-2); border-radius:var(--r-ctl);
    overflow:hidden; }
  .seg button { border:0; border-radius:0; background:var(--surface); color:var(--muted);
    font-size:.8rem; padding:.42rem .7rem; cursor:pointer; }
  .seg button + button { border-left:1px solid var(--border-2); }
  .seg button.on { background:var(--accent-soft); color:var(--text); }
  #read { display:flex; flex-wrap:wrap; gap:.5rem 1.1rem; align-items:baseline;
    margin-top:.9rem; padding-top:.8rem; border-top:1px solid var(--border);
    font-size:.85rem; color:var(--muted); }
  #read b { font-family:var(--mono); color:var(--text); font-weight:600; }
  #read .rt { font-weight:700; letter-spacing:.08em; }

  /* --- style toggles --- */
  .picks { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.9rem; }
  .pick { display:inline-flex; align-items:center; gap:.4rem; padding:.34rem .6rem;
    border:1px solid var(--border-2); border-radius:var(--r-pill); background:var(--surface);
    color:var(--muted); font-size:.8rem; cursor:pointer; user-select:none; }
  .pick.on { color:var(--text); border-color:var(--accent); background:var(--accent-soft); }
  .tag-src { font-style:normal; font-size:.6rem; letter-spacing:.09em; text-transform:uppercase;
    padding:.08rem .32rem; border-radius:var(--r-pill); font-weight:700; }
  .tag-src.prod { color:var(--ok); border:1px solid color-mix(in srgb, var(--ok) 40%, transparent); }
  .tag-src.lab { color:var(--hl-lt); border:1px solid color-mix(in srgb, var(--hl) 40%, transparent); }

  /* --- one style, one strip --- */
  .srow { margin:1.6rem 0; }
  .srow h2 { font-size:.98rem; font-weight:600; margin:0 0 .25rem;
    display:flex; align-items:center; gap:.5rem; }
  .srow > p { margin:0 0 .7rem; max-width:62rem; }
  .palname { font-size:.68rem; letter-spacing:.08em; text-transform:uppercase; color:var(--faint);
    font-weight:700; margin:0 0 .45rem; }
  .palname + .pv { margin-bottom:.9rem; }

  /* ===== preview strip - prod's own tokens, scoped to the strip ============ */
  .pv { --site-bg:${PROD_SURFACES.light.bg}; --surface:${PROD_SURFACES.light.surface};
    --surface-dim:${PROD_SURFACES.light.dim}; --surface-raised:${PROD_SURFACES.light.raised};
    --outline:${PROD_SURFACES.light.outline}; --outline-mid:${PROD_SURFACES.light.mid};
    --outline-strong:${PROD_SURFACES.light.strong}; --prose:${PROD_SURFACES.light.prose};
    --prose-2:${PROD_SURFACES.light.prose2}; --prose-3:${PROD_SURFACES.light.prose3};
    background:var(--site-bg); border:1px solid var(--border); border-radius:var(--r-card);
    padding:1rem; display:grid; grid-template-columns:repeat(auto-fit, minmax(min(128px,100%),1fr));
    gap:.7rem; }
  .pv[data-theme="dark"] { --site-bg:${PROD_SURFACES.dark.bg}; --surface:${PROD_SURFACES.dark.surface};
    --surface-dim:${PROD_SURFACES.dark.dim}; --surface-raised:${PROD_SURFACES.dark.raised};
    --outline:${PROD_SURFACES.dark.outline}; --outline-mid:${PROD_SURFACES.dark.mid};
    --outline-strong:${PROD_SURFACES.dark.strong}; --prose:${PROD_SURFACES.dark.prose};
    --prose-2:${PROD_SURFACES.dark.prose2}; --prose-3:${PROD_SURFACES.dark.prose3}; }

  /* Base box = prod .polished-card, transcribed. isolation:isolate so the holographic
     overlay blends against the card and not against the whole strip. */
  .bx { position:relative; isolation:isolate; overflow:hidden; min-width:0;
    border:1px solid var(--outline); background:var(--surface); border-radius:8px;
    box-shadow:0 1px 3px 0 rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1);
    padding:.6rem .7rem 1.4rem;
    font-family:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .bx.real { outline:2px solid var(--outline-strong); outline-offset:2px; }
  .bx-hd { display:flex; align-items:baseline; justify-content:space-between; gap:.4rem; }
  .bx-word { color:var(--tc); font-size:.66rem; font-weight:700; letter-spacing:.06em;
    text-transform:uppercase; min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; }
  .bx-lo { color:var(--prose-3); font-size:.6rem; font-variant-numeric:tabular-nums;
    white-space:nowrap; }
  .bx-n { position:relative; margin:.3rem 0 .35rem; color:var(--prose);
    font-family:var(--mono); font-size:1.3rem; font-weight:700; letter-spacing:.02em;
    font-variant-numeric:tabular-nums; overflow:hidden; text-overflow:ellipsis; }
  .bx-ft { display:flex; justify-content:space-between; gap:.4rem; color:var(--prose-2);
    font-size:.63rem; font-variant-numeric:tabular-nums; }
  .bx-flag { position:absolute; inset:auto .6rem .5rem auto; color:var(--tc);
    font-size:.58rem; font-weight:700; letter-spacing:.05em; }

  /* ===== the scoring box, prod-exact ==================================== */
  /* Geometry is prod's: px-8 py-5, rounded-xl, border-3, transition-all 500ms. */
  .pv.s-score { grid-template-columns:repeat(auto-fit, minmax(min(216px,100%),1fr)); align-items:start; }
  .sfig { display:flex; flex-direction:column; align-items:center; gap:.45rem; min-width:0; }
  .sfig figcaption { font-size:.6rem; letter-spacing:.06em; text-transform:uppercase; font-weight:700;
    color:var(--tc); text-align:center; min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; max-width:100%; }
  .sfig figcaption i { display:block; font-style:normal; font-weight:400; color:var(--prose-3);
    letter-spacing:0; text-transform:none; font-variant-numeric:tabular-nums; }
  .sfig.real figcaption i { color:var(--prose-2); }

  .sbx { position:relative; overflow:hidden; display:inline-flex; align-items:center;
    justify-content:center; padding:1.25rem 2rem; border-radius:.75rem;
    border:3px solid var(--sb-bd); background-image:var(--sb-bg); box-shadow:var(--sb-sh);
    transition:all .5s; animation:3s ease-in-out infinite sbx-breathe; max-width:100%; }
  .sfig.real .sbx { outline:2px solid var(--outline-strong); outline-offset:3px; }

  /* The gloss sheet and the shimmer are separate absolutely-positioned layers in
     prod, inset by -1px so they cover the border too. Both are pointer-events:none. */
  .sbx-gloss, .sbx-shimwrap { position:absolute; inset:-1px; overflow:hidden;
    pointer-events:none; border-radius:.75rem; }
  .sbx-gloss { background:linear-gradient(135deg, rgba(255,255,255,.4) 0%,
    rgba(255,255,255,.1) 40%, transparent 60%); }
  .pv[data-theme="dark"] .sbx-gloss, .dstage .sbx-gloss, .gc-stage .sbx-gloss { opacity:.4; }
  .pv[data-theme="dark"] .sbx-shimwrap, .dstage .sbx-shimwrap, .gc-stage .sbx-shimwrap { opacity:.1; }
  .gc-stage .sbx { padding:.55rem 1rem; }
  .gc-stage .sbx-n { font-size:1.3rem; }
  .dstage .sbx-n { font-size:2rem; }
  .sbx-shim { position:absolute; inset:0; animation:4s ease-in-out infinite sbx-shim;
    background:linear-gradient(105deg, transparent 0%, transparent 40%, rgba(255,255,255,.35) 50%,
      transparent 60%, transparent 100%) 0 0 / 200% 100%; }

  /* font-roll is Space Mono in prod; the site's --mono stands in for it here. */
  .sbx-n { position:relative; z-index:10; display:flex; align-items:center;
    font-family:var(--mono); font-weight:700; font-variant-numeric:tabular-nums;
    color:var(--sb-ink); transition:all .5s; line-height:1.1;
    text-shadow:0 1px 2px rgba(255,255,255,.5); }
  .pv[data-theme="dark"] .sbx-n, .dstage .sbx-n, .gc-stage .sbx-n {
    text-shadow:0 1px 2px rgba(255,255,255,.2); }
  .sbx-n span { display:inline-block; transition:all .5s; }

  @keyframes sbx-breathe { 0%, 100% { transform:scale(1); } 50% { transform:scale(1.015); } }
  @keyframes sbx-shim { from { background-position:200% 0; } to { background-position:-200% 0; } }

  /* --- tint (lab) --- */
  .s-tint .bx { border-color:color-mix(in srgb, var(--tc) 55%, var(--outline));
    background:color-mix(in srgb, var(--tc) 8%, var(--surface)); }

  /* --- ring (lab) --- */
  .s-ring .bx { border-color:color-mix(in srgb, var(--tc) 45%, var(--outline));
    box-shadow:0 0 0 1px color-mix(in srgb, var(--tc) 45%, transparent),
               0 0 14px 2px color-mix(in srgb, var(--tc) 32%, transparent); }

  /* --- holographic (prod) --- the alphas are prod's; .amp multiplies them ~6x, because
     at prod's own values the effect is very nearly not there. */
  .s-holo .bx::after { content:""; position:absolute; inset:0; pointer-events:none;
    mix-blend-mode:overlay; background-size:200% 200%; background-position:0 0;
    background-image:linear-gradient(125deg, rgba(0,0,0,0) 0%, rgba(255,0,0,.031) 10%,
      rgba(255,154,0,.051) 20%, rgba(208,222,33,.051) 30%, rgba(79,220,74,.051) 40%,
      rgba(63,218,216,.051) 50%, rgba(28,127,238,.051) 60%, rgba(95,21,242,.051) 70%,
      rgba(186,12,248,.031) 80%, rgba(0,0,0,0) 100%);
    animation:8s ease-in-out infinite bx-holo; }
  .s-holo.amp .bx::after { background-image:linear-gradient(125deg, rgba(0,0,0,0) 0%,
      rgba(255,0,0,.19) 10%, rgba(255,154,0,.31) 20%, rgba(208,222,33,.31) 30%,
      rgba(79,220,74,.31) 40%, rgba(63,218,216,.31) 50%, rgba(28,127,238,.31) 60%,
      rgba(95,21,242,.31) 70%, rgba(186,12,248,.19) 80%, rgba(0,0,0,0) 100%); }
  @keyframes bx-holo {
    0%, 100% { opacity:.6; background-position:0% 0%; }
    25% { opacity:.8; background-position:50% 0; }
    50% { opacity:.6; background-position:100% 100%; }
    75% { opacity:.8; background-position:50% 100%; } }

  /* --- rainbow halo (prod) - five offset shadows, tier-blind --- */
  .s-halo .bx::before { content:""; position:absolute; inset:0; border-radius:inherit;
    pointer-events:none; opacity:.16; animation:10s linear infinite bx-halo;
    box-shadow:-2px -1px 6px color-mix(in srgb, ${PROD_RINGS[0]} 45%, transparent),
               0 -3px 7px color-mix(in srgb, ${PROD_RINGS[1]} 43%, transparent),
               3px -1px 7px color-mix(in srgb, ${PROD_RINGS[2]} 42%, transparent),
               2px 3px 7px color-mix(in srgb, ${PROD_RINGS[3]} 40%, transparent),
               -2px 2px 6px color-mix(in srgb, ${PROD_RINGS[4]} 42%, transparent); }
  .s-halo.amp .bx::before { opacity:.5; }
  @keyframes bx-halo { 0%, 100% { opacity:.16; } 10% { opacity:.42; } 24% { opacity:.16; } }

  /* --- pulse (lab, prod's signup-glow re-pointed at the tier) --- */
  .s-glow .bx { animation:2s ease-in-out infinite bx-glow; }
  @keyframes bx-glow {
    0%, 100% { box-shadow:0 0 0 0 rgba(0,0,0,0); }
    50% { box-shadow:0 0 20px 4px color-mix(in srgb, var(--tc) 45%, transparent); } }

  /* --- shimmer (lab, prod's shimmer clipped to the digits) --- */
  .s-shimmer .bx-n { color:transparent; background-clip:text; -webkit-background-clip:text;
    background-size:400% 100%;
    background-image:linear-gradient(100deg, var(--prose) 0 42%, var(--tc) 50%, var(--prose) 58% 100%);
    animation:3s linear infinite bx-shimmer; }
  @keyframes bx-shimmer { from { background-position:200%; } to { background-position:-200%; } }

  /* --- rarity cycle (prod) - @property so the stops interpolate instead of snapping,
     which is the one thing prod's own version does not do --- */
  @property --cta-a { syntax:"<color>"; inherits:true; initial-value:${PROD_CTA[0]}; }
  @property --cta-b { syntax:"<color>"; inherits:true; initial-value:${PROD_CTA[1]}; }
  .s-cycle .bx { border-color:var(--cta-a); animation:6s linear infinite bx-cycle;
    box-shadow:0 0 0 1px var(--cta-b) inset, 0 0 12px -2px var(--cta-a); }
  .s-cycle .bx-word { color:var(--cta-a); }
  @keyframes bx-cycle {
    0%, 100% { --cta-a:${PROD_CTA[0]}; --cta-b:${PROD_CTA[1]}; }
    20% { --cta-a:${PROD_CTA[1]}; --cta-b:${PROD_CTA[2]}; }
    40% { --cta-a:${PROD_CTA[2]}; --cta-b:${PROD_CTA[3]}; }
    60% { --cta-a:${PROD_CTA[3]}; --cta-b:${PROD_CTA[4]}; }
    80% { --cta-a:${PROD_CTA[4]}; --cta-b:${PROD_CTA[0]}; } }

  @media (prefers-reduced-motion: reduce) {
    .s-holo .bx::after, .s-halo .bx::before, .s-glow .bx, .s-shimmer .bx-n,
    .s-cycle .bx, .sbx, .sbx-shim { animation:none; } }

  /* --- the tier designer --- */
  .dz { display:grid; grid-template-columns:minmax(min(230px,100%),.9fr) minmax(min(300px,100%),1.4fr);
    gap:1.1rem; align-items:start; }
  @media (max-width: 780px) { .dz { grid-template-columns:1fr; } }
  /* A 1fr track keeps an automatic minimum, so without this the column refuses to
     shrink below the dial grid's min-content and the page scrolls sideways on a phone. */
  .dz > * { min-width:0; }
  .dials { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(140px,100%),1fr)); gap:.7rem; }
  .dial { display:flex; flex-direction:column; gap:.28rem; min-width:0; }
  .dial > label { font-size:.65rem; letter-spacing:.06em; text-transform:uppercase; color:var(--faint);
    font-weight:600; }
  .dial input[type="color"] { width:100%; height:2rem; padding:2px; cursor:pointer;
    background:var(--surface); border:1px solid var(--border-2); border-radius:var(--r-sm); }
  .dial input[type="range"] { width:100%; accent-color:var(--accent); }
  .dial input[type="text"] { text-transform:uppercase; letter-spacing:.05em; }
  .dial input[type="number"] { font-family:var(--mono); font-size:.82rem; }
  .dial .val { font-family:var(--mono); font-size:.68rem; color:var(--muted); }
  .dial.wide { grid-column:1 / -1; }
  .dial.check { flex-direction:row; align-items:center; gap:.45rem; }
  .dial.check label { text-transform:none; letter-spacing:0; font-size:.8rem; color:var(--dim);
    font-weight:400; }
  .dstage { display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:.6rem; padding:1.3rem 1rem; border-radius:var(--r-card); border:1px solid var(--border);
    background:var(--site-bg); min-height:150px; }
  .edbtns { display:flex; flex-wrap:wrap; gap:.5rem; margin:1rem 0 .9rem; }
  .locked { display:flex; align-items:center; gap:.45rem; font-size:.78rem; color:var(--faint);
    margin:.2rem 0 0; }
  #ed-out { margin:0; padding:.75rem .85rem; background:var(--surface-2);
    border:1px solid var(--border); border-radius:var(--r-ctl); font-family:var(--mono);
    font-size:.74rem; line-height:1.65; color:var(--dim); overflow-x:auto; white-space:pre; }
  #ed-note { margin:.6rem 0 0; color:var(--hl-lt); }

  /* --- publish --- */
  .pub { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(210px,100%),1fr)); gap:.6rem;
    margin-top:1.1rem; padding-top:1rem; border-top:1px solid var(--border); }
  .pub label { display:block; font-size:.66rem; letter-spacing:.07em; text-transform:uppercase;
    color:var(--faint); font-weight:600; margin-bottom:.25rem; }
  .pub input { width:100%; }
  .pub-go { display:flex; flex-wrap:wrap; align-items:center; gap:.7rem; margin-top:.8rem; }
  #pub-msg { font-size:.82rem; }
  #pub-msg.bad { color:var(--bad-lt); }
  #pub-msg.ok { color:var(--ok); }

  /* --- gallery --- */
  .gal-bar { display:flex; flex-wrap:wrap; align-items:center; gap:.6rem; margin:.9rem 0; }
  #gal { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(300px,100%),1fr)); gap:.7rem; }
  .gc { display:flex; flex-direction:column; gap:.5rem; padding:.75rem .8rem;
    border:1px solid var(--border); border-radius:var(--r-card); background:var(--surface); }
  .gc:hover { border-color:var(--border-2); }
  .gc-hd { display:flex; align-items:baseline; justify-content:space-between; gap:.5rem; }
  .gc-hd b { font-size:.92rem; font-weight:600; min-width:0; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .gc-hd span { font-size:.72rem; color:var(--faint); white-space:nowrap; }
  .gc-note { margin:0; font-size:.78rem; color:var(--muted); line-height:1.5; }
  .gc-stage { display:flex; align-items:center; justify-content:center; padding:.7rem;
    border-radius:var(--r-sm); background:var(--site-bg); border:1px solid var(--border); }
  .gc-ft { display:flex; align-items:center; gap:.45rem; }
  .gc-ft .sp { flex:1; }
  .gc-ft .small { font-size:.72rem; }
  .like.on { color:var(--bad-lt); border-color:var(--bad-dk); }
  #gal-msg { margin:.9rem 0 0; }`;

  const body = `<div class="wrap">
  <div class="tool-head">
    <h1>Box Lab <span class="beta-tag">beta</span></h1>
    <a class="tool-back" href="/beta">&larr; Beta lab</a>
  </div>
  <p class="tag">One number, dropped into every coloured box rngdle.com knows how to draw -
    and then into whatever boxes you invent instead.</p>

  <section class="card">
    <div class="bar">
      <div class="fld"><label for="n">Number</label>
        <input id="n" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"
               maxlength="7" value="25891" aria-label="Number from 0 to 1,000,000"></div>
      <div class="fld"><button id="roll" class="btn-sm" type="button">Roll</button></div>
      <div class="fld"><label>Theme</label>
        <div class="seg" id="theme"><button type="button" data-v="light">Light</button
          ><button type="button" data-v="dark" class="on">Dark</button></div></div>
      <div class="fld"><label>Faint effects</label>
        <div class="seg" id="amp"><button type="button" data-v="0" class="on">As shipped</button
          ><button type="button" data-v="1">Amplify</button></div></div>
    </div>
    <div class="picks" id="picks"></div>
    <div id="read"></div>
  </section>

  <div id="rows"></div>

  <section class="card" id="editor">
    <h2>Design a rarity</h2>
    <p class="small">Prod's seven are fixed - they are the reference, and nothing here can repaint
      them. What you get is an eighth of your own, built out of the same parts prod's box is built
      from, and it sits in every strip above alongside the real ones.</p>

    <div class="dz">
      <div>
        <div class="dials">
          <div class="dial wide"><label for="d-word">Rarity name</label>
            <input id="d-word" type="text" maxlength="18" value="LEGENDARY" autocomplete="off"></div>
          <div class="dial"><label for="d-from">Gradient start</label>
            <input id="d-from" type="color" value="#fde68a"></div>
          <div class="dial"><label for="d-via">Gradient middle</label>
            <input id="d-via" type="color" value="#fffbeb"></div>
          <div class="dial"><label for="d-to">Gradient end</label>
            <input id="d-to" type="color" value="#fde68a"></div>
          <div class="dial"><label for="d-bd">Border</label>
            <input id="d-bd" type="color" value="#f59e0b"></div>
          <div class="dial"><label for="d-ink">Digits</label>
            <input id="d-ink" type="color" value="#78350f"></div>
          <div class="dial"><label for="d-glow">Glow</label>
            <input id="d-glow" type="color" value="#f59e0b"></div>
          <div class="dial"><label for="d-size">Glow size <span class="val" id="d-size-v"></span></label>
            <input id="d-size" type="range" min="0" max="60" step="1" value="18"></div>
          <div class="dial"><label for="d-alpha">Glow strength <span class="val" id="d-alpha-v"></span></label>
            <input id="d-alpha" type="range" min="0" max="100" step="1" value="35"></div>
          <div class="dial"><label for="d-lo">From EP</label>
            <input id="d-lo" type="number" min="0" step="1" value="500000"></div>
          <div class="dial check wide">
            <input id="d-shim" type="checkbox" checked>
            <label for="d-shim">Shimmer sweep (prod runs this on every tier above common)</label></div>
        </div>
        <div class="edbtns">
          <button type="button" class="btn-sm" id="d-random">Randomise</button>
          <button type="button" class="btn-sm" id="d-reset">Reset</button>
          <button type="button" class="btn-sm" id="ed-copy">Copy as CSS</button>
        </div>
      </div>
      <div>
        <div class="dstage" id="d-stage"></div>
        <pre id="ed-out"></pre>
        <p class="small" id="ed-note"></p>
      </div>
    </div>

    <div class="pub">
      <div><label for="pub-name">Name this submission</label>
        <input id="pub-name" type="text" maxlength="40" placeholder="Molten Gold" autocomplete="off"></div>
      <div><label for="pub-author">Submitter name (optional)</label>
        <input id="pub-author" type="text" maxlength="24" placeholder="anon" autocomplete="off"></div>
      <div><label for="pub-note">One line about it (optional)</label>
        <input id="pub-note" type="text" maxlength="120" placeholder="what you were going for"
               autocomplete="off"></div>
    </div>
    <div class="pub-go">
      <button type="button" class="btn-primary btn-sm" id="pub-go">Publish this rarity</button>
      <span id="pub-msg"></span>
    </div>
    <p class="small">Only your own rarity is submitted - prod's seven are never sent and cannot be
      changed from here. There is no account and nothing about you is stored; submissions are
      rate-limited by a salted hash of your IP, which is not kept in any form that can be turned back
      into an address.</p>
  </section>

  <section class="card" id="gallery">
    <h2>What other people suggested</h2>
    <p class="small">Every rarity published from this page, each one drawn exactly as its author
      set it up. Load one and it takes the eighth slot in every strip above, so you can see somebody
      else's idea sitting next to the seven real ones. <b>Hot</b> trades hearts off against age - one
      heart is worth about three days of freshness - so a rarity people like climbs back up while a
      new one still gets seen. One heart per person per rarity, capped per hour.</p>
    <div class="gal-bar">
      <div class="seg" id="gsort"><button type="button" data-v="hot" class="on">Hot</button
        ><button type="button" data-v="new">Newest</button
        ><button type="button" data-v="top">Most hearted</button></div>
      <button type="button" class="btn-sm" id="gal-more">Load more</button>
    </div>
    <div id="gal"></div>
    <p class="small" id="gal-msg"></p>
  </section>

  <footer>
    Colours, keyframes and box recipes are read out of rngdle.com's stylesheet
    (<code>/_next/static/chunks/40301e47118b0e38.css</code>, fetched 2026-08-19), not out of the JS
    bundle the badge rules come from. Prod writes its tier colours in <b>oklch</b> and swaps the whole
    set under <code>.dark</code>, so a tier has two colours and not one - the preview paints prod's
    exact oklch and the editor seeds from the sRGB equivalent. Boxes marked <b>prod</b> are its rules
    transcribed; <b>lab</b> ones use prod's ingredients in a way prod itself does not. EP floors are
    the same <code>CARD_TIERS</code> the calculator card uses, and the number is scored by
    <code>/api</code>, so it reflects the live badge rules.
  </footer>
</div>`;

  const script = `(${boxesClient.toString()})(${JSON.stringify(tiers)}, ${JSON.stringify(BOX_STYLES)},
  ${JSON.stringify(aligned)}, ${JSON.stringify(SCORE_TIERS)});`;

  return betaShell({ title: 'RNGdle - Box Lab', width: '1180px', slug: 'boxes', css, body, script });
}

/**
 * Box Lab client.
 * @param {Array}   TIERS    prod's tiers: {key, word, light:[oklch,hex], dark:[oklch,hex], lo}
 * @param {Array}   STYLES   box recipes: {key, name, src, on, note}
 * @param {boolean} ALIGNED  whether CARD_TIER_NAMES still matches prod's tier order
 * @param {object}  SCORE    prod's scoring-box CSS per tier key, [light, dark] per field
 */
function boxesClient(TIERS, STYLES, ALIGNED, SCORE) {
  const KEY = 'rngdle-beta-boxes-v1';
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('en-US');
  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // One tier, yours, described by every part prod's own box is made of. Prod's seven
  // are not in here at all - they are fixed reference and the designer cannot reach them.
  const seed = () => ({
    word: 'LEGENDARY', from: '#fde68a', via: '#fffbeb', to: '#fde68a',
    bd: '#f59e0b', ink: '#78350f', glow: '#f59e0b',
    glowSize: 18, glowAlpha: 35, shimmer: true, lo: 500000,
  });
  const DIALS = ['word', 'from', 'via', 'to', 'bd', 'ink', 'glow', 'glowSize', 'glowAlpha', 'shimmer', 'lo'];

  const S = {
    n: 25891,
    theme: 'dark',
    amp: false,
    on: new Set(STYLES.filter(s => s.on).map(s => s.key)),
    design: seed(),
    data: null,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    // Merge onto a fresh seed so an entry saved before a dial existed still opens.
    if (saved && saved.design && typeof saved.design === 'object') {
      S.design = Object.assign(seed(), saved.design);
    }
  } catch (e) { /* a corrupt entry is not worth a broken page */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ design: S.design })); } catch (e) {} };

  // Prod's seven, resolved for the current theme, then yours as an eighth. Prod's
  // entries paint with the literal oklch they ship; yours is whatever the dials say.
  const tierList = () => TIERS
    .map(t => ({ key: t.key, word: t.word, colour: t[S.theme][0], lo: t.lo }))
    .concat([{ key: null, mine: true, word: S.design.word || 'YOURS',
               colour: S.design.bd, lo: Math.max(0, Number(S.design.lo) || 0) }]);

  // Which box the number actually lands in: the highest floor it clears. Reading the
  // floors rather than the order means a hand-typed cutoff out of sequence still
  // resolves to something sensible instead of silently picking the wrong box.
  const landing = list => {
    if (!S.data) return -1;
    let best = -1, bestLo = -Infinity;
    list.forEach((t, i) => {
      if (t.lo <= S.data.totalEP && t.lo >= bestLo) { best = i; bestLo = t.lo; }
    });
    return best;
  };

  function boxHTML(t, i, real) {
    const ep = S.data ? fmt(S.data.totalEP) + ' EP' : '-';
    const cnt = S.data ? S.data.count + (S.data.count === 1 ? ' badge' : ' badges') : '';
    return '<div class="bx' + (i === real ? ' real' : '') + '" style="--tc:' + t.colour + '">' +
      '<div class="bx-hd"><span class="bx-word">' + esc(t.word) + '</span>' +
      '<span class="bx-lo">' + fmt(t.lo) + '+</span></div>' +
      '<div class="bx-n">' + fmt(S.n) + '</div>' +
      '<div class="bx-ft"><span>' + ep + '</span><span>' + cnt + '</span></div>' +
      (i === real ? '<span class="bx-flag">lands here</span>' : '') +
      '</div>';
  }

  // Prod's scoring box. A tier from prod's palette gets its exact row out of SCORE; a
  // tier you invented has only one colour, so the same shape is derived from it with
  // color-mix against the live surface - close in spirit, honest about not being prod.
  function scoreCSS(t) {
    const row = t.key && SCORE[t.key];
    if (row) {
      const i = S.theme === 'dark' ? 1 : 0;
      return '--sb-bg:' + row.bg[i] + ';--sb-bd:' + row.bd[i] +
             ';--sb-sh:' + row.sh[i] + ';--sb-ink:' + row.ink[i];
    }
    // Yours: the dials, assembled the same way prod assembles a row of its table.
    const d = S.design;
    const glow = Number(d.glowSize) > 0
      ? '0 0 ' + Number(d.glowSize) + 'px ' + rgba(d.glow, Number(d.glowAlpha) / 100) + ', '
      : '';
    return '--sb-bg:linear-gradient(to bottom right,' + d.from + ',' + d.via + ',' + d.to + ')' +
           ';--sb-bd:' + d.bd +
           ';--sb-sh:' + glow + 'inset 0 2px 4px 0 ' + rgba(d.from, .5) +
           ';--sb-ink:' + d.ink;
  }

  // #rrggbb + alpha -> rgba(), so a glow can be dialled down without a second input.
  function rgba(hex, a) {
    const v = parseInt(String(hex).slice(1), 16) || 0;
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
  }

  function scoreBoxHTML(t, i, real) {
    const s = fmt(S.n).replace(/,/g, '');
    // Prod sizes the digits by how many there are: text-5xl at five, text-4xl at six.
    const size = s.length <= 5 ? '3rem' : '2.25rem';
    const shim = (t.key ? SCORE[t.key].shim : S.design.shimmer)
      ? '<div class="sbx-shimwrap"><div class="sbx-shim"></div></div>' : '';
    return '<figure class="sfig' + (i === real ? ' real' : '') + '" style="--tc:' + t.colour + '">' +
      '<div class="sbx" style="' + scoreCSS(t) + '">' +
        '<div class="sbx-gloss"></div>' + shim +
        '<div class="sbx-n" style="font-size:' + size + '">' +
          [...s].map(d => '<span>' + d + '</span>').join('') +
        '</div>' +
      '</div>' +
      '<figcaption>' + esc(t.word) + '<i>' + fmt(t.lo) + '+ EP' +
        (i === real ? ' \u00b7 lands here' : '') + '</i></figcaption>' +
    '</figure>';
  }

  function stripHTML(styleKey) {
    const list = tierList();
    const real = landing(list);
    const draw = styleKey === 'score' ? scoreBoxHTML : boxHTML;
    return '<div class="pv s-' + styleKey + (S.amp ? ' amp' : '') + '" data-theme="' + S.theme + '">' +
      list.map((t, i) => draw(t, i, real)).join('') + '</div>';
  }

  function paintRows() {
    $('rows').innerHTML = STYLES.filter(s => S.on.has(s.key)).map(s =>
      '<section class="srow"><h2>' + esc(s.name) +
        ' <i class="tag-src ' + s.src + '">' + s.src + '</i></h2>' +
      '<p class="small">' + s.note + '</p>' +
      stripHTML(s.key) +
      '</section>').join('') ||
      '<p class="small">No box styles selected.</p>';
  }

  function paintRead() {
    if (!S.data) { $('read').innerHTML = '<span>Scoring&hellip;</span>'; return; }
    const list = tierList();
    const t = list[landing(list)] || { word: '-', colour: 'var(--muted)' };
    const top = S.data.badges.slice(0, 8).map(b => b.emoji).join(' ');
    $('read').innerHTML =
      '<span>Score <b>' + fmt(S.data.totalEP) + '</b> EP</span>' +
      '<span><b>' + S.data.count + '</b> badges</span>' +
      '<span>Tier <b class="rt" style="color:' + t.colour + '">' + esc(t.word) + '</b></span>' +
      (top ? '<span>' + top + '</span>' : '');
  }

  const DIAL_IDS = {
    word: 'd-word', from: 'd-from', via: 'd-via', to: 'd-to', bd: 'd-bd', ink: 'd-ink',
    glow: 'd-glow', glowSize: 'd-size', glowAlpha: 'd-alpha', lo: 'd-lo', shimmer: 'd-shim',
  };

  // State -> inputs. Only called when something other than typing changed the design
  // (reset, randomise, loading someone else's), because writing a field's own value
  // back into it mid-keystroke moves the caret to the end.
  function syncDials() {
    for (const k in DIAL_IDS) {
      const el = $(DIAL_IDS[k]);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!S.design[k];
      else el.value = S.design[k];
    }
  }

  // Inputs -> state.
  function readDials() {
    const d = S.design;
    d.word = ($('d-word').value || '').toUpperCase();
    for (const k of ['from', 'via', 'to', 'bd', 'ink', 'glow']) d[k] = $(DIAL_IDS[k]).value;
    d.glowSize = Number($('d-size').value);
    d.glowAlpha = Number($('d-alpha').value);
    d.lo = Math.max(0, Number($('d-lo').value) || 0);
    d.shimmer = $('d-shim').checked;
  }

  function paintDesign() {
    const d = S.design;
    $('d-size-v').textContent = d.glowSize + 'px';
    $('d-alpha-v').textContent = d.glowAlpha + '%';
    $('d-stage').innerHTML = scoreBoxHTML(
      { key: null, mine: true, word: d.word || 'YOURS', colour: d.bd, lo: d.lo }, 0, -1);
    paintExport();
  }

  const slugOf = w => (w || 'tier').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'tier';

  function paintExport() {
    const d = S.design;
    const glow = Number(d.glowSize) > 0
      ? '0 0 ' + d.glowSize + 'px ' + rgba(d.glow, d.glowAlpha / 100) + ', ' : '';
    $('ed-out').textContent =
      '/* ' + (d.word || 'TIER') + ' - built the way prod builds a scoring box */\n' +
      '.tier-' + slugOf(d.word) + ' {\n' +
      '  --sb-bg: linear-gradient(to bottom right, ' + d.from + ', ' + d.via + ', ' + d.to + ');\n' +
      '  --sb-bd: ' + d.bd + ';\n' +
      '  --sb-sh: ' + glow + 'inset 0 2px 4px 0 ' + rgba(d.from, .5) + ';\n' +
      '  --sb-ink: ' + d.ink + ';\n' +
      '}\n/* shimmer ' + (d.shimmer ? 'on' : 'off') + ' · from ' + fmt(d.lo) + ' EP */';

    const notes = [];
    if (!String(d.word).trim()) notes.push('Give the rarity a name before publishing.');
    if (TIERS.some(t => t.word === d.word)) {
      notes.push('"' + d.word + '" is already one of prod\'s seven - yours will sit next to it.');
    }
    if (Number(d.glowSize) === 0) {
      notes.push('No glow at all, which is exactly what prod does for trash and common.');
    }
    $('ed-note').textContent = notes.join(' ');
  }

  function paint() { paintRows(); paintRead(); paintDesign(); }

  // --- scoring -------------------------------------------------------------
  // /api is the same compute() the calculator uses, so nothing here can drift from
  // the live badge rules. Responses can land out of order, hence the sequence check.
  let seq = 0;
  async function score() {
    const mine = ++seq;
    try {
      const r = await fetch('/api?n=' + S.n);
      const j = await r.json();
      if (mine !== seq) return;
      S.data = j.error ? null : j;
    } catch (e) {
      if (mine === seq) S.data = null;
    }
    if (mine === seq) { paintRows(); paintRead(); }
  }

  // --- wiring --------------------------------------------------------------
  $('picks').innerHTML = STYLES.map(s =>
    '<button type="button" class="pick' + (S.on.has(s.key) ? ' on' : '') + '" data-k="' + s.key + '">' +
    esc(s.name) + ' <i class="tag-src ' + s.src + '">' + s.src + '</i></button>').join('');
  $('picks').addEventListener('click', e => {
    const b = e.target.closest('.pick');
    if (!b) return;
    const k = b.dataset.k;
    if (S.on.has(k)) S.on.delete(k); else S.on.add(k);
    b.classList.toggle('on', S.on.has(k));
    paintRows();
  });

  const seg = (id, fn) => $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    [...$(id).children].forEach(c => c.classList.toggle('on', c === b));
    fn(b.dataset.v);
  });
  seg('theme', v => { S.theme = v; paintRows(); paintRead(); });
  seg('amp', v => { S.amp = v === '1'; paintRows(); });

  let debounce = 0;
  $('n').addEventListener('input', e => {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 7);
    if (raw !== e.target.value) e.target.value = raw;
    const n = raw === '' ? 0 : Math.min(1000000, Number(raw));
    if (n === S.n) return;
    S.n = n;
    paintRows();                                  // the digits move on the keystroke
    clearTimeout(debounce);
    debounce = setTimeout(score, 180);            // the score catches up
  });
  $('roll').addEventListener('click', () => {
    S.n = Math.floor(1000001 * Math.random());    // prod's own range, 0..1,000,000 inclusive
    $('n').value = String(S.n);
    paintRows();
    score();
  });

  // One handler for every dial: they all live inside #editor and all carry a d- id.
  const onDial = e => {
    if (!e.target.id || e.target.id.slice(0, 2) !== 'd-') return;
    readDials();
    save();
    paint();
  };
  $('editor').addEventListener('input', onDial);
  $('editor').addEventListener('change', onDial);

  $('d-reset').addEventListener('click', () => { S.design = seed(); save(); syncDials(); paint(); });

  // Randomise around one hue so the result still reads as a designed box rather than
  // six unrelated colours - the gradient and the glow stay in the same family, which
  // is what every one of prod's own tiers does.
  $('d-random').addEventListener('click', () => {
    const hex = (h, sat, l) => {
      const a = sat * Math.min(l, 1 - l);
      const f = n => {
        const k = (n + h / 30) % 12;
        const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * v).toString(16).padStart(2, '0');
      };
      return '#' + f(0) + f(8) + f(4);
    };
    const h = Math.floor(Math.random() * 360);
    const h2 = (h + 25 + Math.floor(Math.random() * 60)) % 360;
    S.design = Object.assign(S.design, {
      from: hex(h, .75, .80), via: hex(h2, .70, .94), to: hex(h, .75, .80),
      bd: hex(h, .80, .60), ink: hex(h, .85, .25), glow: hex(h, .90, .55),
      glowSize: 6 + Math.floor(Math.random() * 40),
      glowAlpha: 20 + Math.floor(Math.random() * 60),
      shimmer: Math.random() < .75,
    });
    save(); syncDials(); paint();
  });

  $('ed-copy').addEventListener('click', async () => {
    const b = $('ed-copy'), was = b.textContent;
    try {
      await navigator.clipboard.writeText($('ed-out').textContent);
      b.textContent = 'Copied';
    } catch (e) {
      b.textContent = 'Select and copy';
    }
    setTimeout(() => { b.textContent = was; }, 1400);
  });

  // --- gallery -------------------------------------------------------------
  // Published palettes, from D1 via /api/palettes. The whole section is optional:
  // a deployment with no database answers 503 with unconfigured:true, and the page
  // says so once and carries on - nothing else here depends on storage.
  const G = { sort: 'hot', offset: 0, more: false, items: [], liked: new Set(), off: false };

  // Black or white text on a swatch, by Rec.601 luma. Not a contrast-ratio check,
  // but the right side of the line for every colour a colour input can produce.
  const ink = hex => {
    const v = parseInt(hex.slice(1), 16);
    const y = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
    return y > 140 ? '#111111' : '#ffffff';
  };

  const ago = ms => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 90) return 'just now';
    const m = s / 60; if (m < 90) return Math.round(m) + 'm ago';
    const h = m / 60; if (h < 36) return Math.round(h) + 'h ago';
    return Math.round(h / 24) + 'd ago';
  };

  // The gallery draws each submission as the box its author actually designed - a
  // row of colour chips would not show what any of them chose.
  function miniBox(d) {
    const glow = Number(d.glowSize) > 0
      ? '0 0 ' + Number(d.glowSize) + 'px ' + rgba(d.glow, Number(d.glowAlpha) / 100) + ', ' : '';
    const css = '--sb-bg:linear-gradient(to bottom right,' + d.from + ',' + d.via + ',' + d.to + ')' +
      ';--sb-bd:' + d.bd + ';--sb-sh:' + glow + 'inset 0 2px 4px 0 ' + rgba(d.from, .5) +
      ';--sb-ink:' + d.ink;
    return '<div class="sbx" style="' + css + '">' +
      '<div class="sbx-gloss"></div>' +
      (d.shimmer ? '<div class="sbx-shimwrap"><div class="sbx-shim"></div></div>' : '') +
      '<div class="sbx-n">' + String(S.n) + '</div></div>';
  }

  function galCard(p) {
    const d = p.design || {};
    return '<article class="gc">' +
      '<div class="gc-hd"><b>' + esc(p.name) + '</b><span>' +
        (p.author ? esc(p.author) + ' &middot; ' : '') + ago(p.created) + '</span></div>' +
      (p.note ? '<p class="gc-note">' + esc(p.note) + '</p>' : '') +
      (d.bd ? '<div class="gc-stage">' + miniBox(d) + '</div>' : '') +
      '<div class="gc-ft">' +
        '<button type="button" class="btn-sm like' + (G.liked.has(p.id) ? ' on' : '') +
          '" data-like="' + p.id + '">&hearts; ' + p.likes + '</button>' +
        '<span class="sp"></span><span class="small">' + esc(d.word || '?') +
          ' \u00b7 ' + fmt(Number(d.lo) || 0) + '+ EP</span>' +
        '<button type="button" class="btn-sm" data-use="' + p.id + '">Load</button>' +
      '</div></article>';
  }

  function paintGallery() {
    $('gal').innerHTML = G.items.map(galCard).join('');
    $('gal-more').style.display = G.more ? '' : 'none';
    if (!G.off) {
      $('gal-msg').textContent = G.items.length
        ? ''
        : 'Nothing published yet. Yours would be the first.';
    }
  }

  async function loadGallery(reset) {
    if (G.off) return;
    if (reset) { G.offset = 0; G.items = []; }
    $('gal-msg').textContent = 'Loading\u2026';
    try {
      const r = await fetch('/api/palettes?sort=' + G.sort + '&offset=' + G.offset);
      const j = await r.json();
      if (j.unconfigured) {
        G.off = true;
        $('gal').innerHTML = '';
        $('gal-more').style.display = 'none';
        $('gal-msg').textContent = j.error + ' Everything else on this page works without it.';
        return;
      }
      if (j.error) throw new Error(j.error);
      G.items = G.items.concat(j.palettes);
      G.more = j.more;
      G.offset = G.items.length;
      paintGallery();
    } catch (e) {
      $('gal-msg').textContent = 'Could not load the gallery.';
    }
  }

  async function loadLikes() {
    try {
      const j = await (await fetch('/api/palettes-liked')).json();
      G.liked = new Set(j.liked || []);
    } catch (e) { /* the hearts just start empty */ }
  }

  $('gal').addEventListener('click', async e => {
    const use = e.target.closest('[data-use]');
    if (use) {
      const p = G.items.find(x => x.id === use.dataset.use);
      if (!p) return;
      if (!p.design) return;
      S.design = Object.assign(seed(), p.design);
      save();
      syncDials();
      paint();
      $('rows').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const like = e.target.closest('[data-like]');
    if (!like) return;
    const id = like.dataset.like;
    like.disabled = true;
    try {
      const r = await fetch('/api/palettes/' + id + '/like', { method: 'POST' });
      const j = await r.json();
      if (j.error) { $('gal-msg').textContent = j.error; return; }
      $('gal-msg').textContent = '';
      if (j.liked) G.liked.add(id); else G.liked.delete(id);
      const item = G.items.find(x => x.id === id);
      if (item) item.likes = j.likes;
      like.classList.toggle('on', j.liked);
      like.innerHTML = '&hearts; ' + j.likes;
    } catch (e) { /* leave the button as it was */ }
    finally { like.disabled = false; }
  });

  $('gal-more').addEventListener('click', () => loadGallery(false));
  seg('gsort', v => { G.sort = v; loadGallery(true); });

  $('pub-go').addEventListener('click', async () => {
    const btn = $('pub-go'), msg = $('pub-msg');
    msg.className = '';
    const name = $('pub-name').value.trim();
    if (!name) { msg.className = 'bad'; msg.textContent = 'Give it a name first.'; return; }
    btn.disabled = true;
    msg.textContent = 'Publishing\u2026';
    try {
      const r = await fetch('/api/palettes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name, author: $('pub-author').value, note: $('pub-note').value, design: S.design,
        }),
      });
      const j = await r.json();
      if (!r.ok) { msg.className = 'bad'; msg.textContent = j.error || 'Could not publish that.'; return; }
      msg.className = 'ok';
      msg.textContent = j.duplicate ? 'Already published - it is in the gallery below.' : 'Published.';
      G.sort = 'new';
      [...$('gsort').children].forEach(c => c.classList.toggle('on', c.dataset.v === 'new'));
      await loadGallery(true);
    } catch (e) {
      msg.className = 'bad';
      msg.textContent = 'Could not reach the gallery.';
    } finally {
      btn.disabled = false;
    }
  });

  syncDials();
  paint();
  score();
  loadLikes().then(() => loadGallery(true));
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
  projections: renderProjections,
  nearmiss: renderNearMiss,
  anatomy: renderAnatomy,
  contact: renderContact,
  collection: renderCollection,
  boxes: renderBoxes,
};
