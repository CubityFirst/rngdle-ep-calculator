// Shared design system for every HTML page this Worker serves.
//
// Before this existed each page carried its own hand-copied `:root` block, its own
// content width, its own button/input/pill styling and its own ad-hoc row of links -
// five near-identical dark themes plus /chains, which was a separate light-mode design
// entirely. Everything visual that is not genuinely page-specific now lives here.
//
// Usage from a render function:
//
//   pageShell({
//     title: 'RNGdle - Badge Index',
//     width: '1100px',        // sets --wrap
//     nav:   'badges',        // which site-nav link is current
//     css:   PAGE_SPECIFIC_CSS,
//     body:  `<div class="wrap">…</div>`,
//     script: `…`,
//   })
//
// Page CSS is emitted *after* the shared layer, so an equally-specific page rule wins.

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// The superset of what the old five `:root` blocks defined, plus a radius scale
// (previously 2px/3px on /chains, 8px/10px/12px/14px elsewhere) and --wrap, which
// pageShell overrides per page.
export const TOKENS_CSS = `
  :root {
    color-scheme: dark;
    --bg:#08090c; --surface:#131419; --surface-2:#181a20; --surface-3:#20232c;
    --border:#24262d; --border-2:#30333c; --border-3:#3a3e49;
    --text:#e7e8ea; --dim:#c8ccd8; --muted:#8b8e97; --faint:#595c65;
    --accent:#5b93d6; --accent-soft:#142a3e; --on-accent:#0a1220;
    --hl:#e8924e; --hl-lt:#f4b27a;
    --ok:#43d17f; --on-ok:#0a1a10; --bad:#e5484d; --bad-lt:#ffb3b8; --bad-dk:#7c2d3a;
    --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --r-sm:6px; --r-ctl:8px; --r-card:12px; --r-hero:14px; --r-pill:999px;
    --wrap:960px;
  }`;

// ---------------------------------------------------------------------------
// Base element styling
// ---------------------------------------------------------------------------

export const BASE_CSS = `
  * { box-sizing:border-box; }
  /* Crossfade same-origin page navigations (MPA view transitions) where supported,
     instead of a hard cut between documents. Ignored by browsers without support. */
  @view-transition { navigation: auto; }
  html { background:var(--bg); }
  body { font-family:var(--font); background:var(--bg); color:var(--text); margin:0;
    line-height:1.5; -webkit-font-smoothing:antialiased; }
  a { color:var(--accent); }
  h1 { font-size:1.45rem; font-weight:600; letter-spacing:-.02em; margin:0 0 .3rem; }
  h2 { letter-spacing:-.01em; }
  p.tag { color:var(--muted); margin:0 0 1.4rem; font-size:.92rem; }
  .wrap { max-width:var(--wrap); margin:0 auto; }
  .mono { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .muted { color:var(--muted); }
  .eyebrow { font-size:.7rem; letter-spacing:.14em; text-transform:uppercase; font-weight:700;
    color:var(--faint); margin:0 0 .8rem; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  footer { margin-top:2.5rem; color:var(--faint); font-size:.8rem; line-height:1.7; }
  footer b { color:var(--muted); font-weight:600; }
  footer code { color:var(--muted); font-family:var(--mono); }`;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// Bare `button`/`input`/`select` are styled, not just `.btn`/`.field`, so that every
// control on every page picks up the shared look without touching its markup. Pages
// that need something else already use a more specific selector (`#ctrls button`,
// `.chip`, `#plate-hud button`, …), which still wins. Checkboxes and radios are held
// out via :where(), which keeps the selector at plain-element specificity.
export const COMPONENTS_CSS = `
  button, .btn { font-family:inherit; font-size:.92rem; font-weight:500; line-height:1.2;
    display:inline-flex; align-items:center; justify-content:center; gap:.45rem;
    padding:.6rem 1.05rem; border-radius:var(--r-ctl); cursor:pointer; text-decoration:none;
    color:var(--text); background:var(--surface-2); border:1px solid var(--border-2);
    transition:background .12s, border-color .12s, color .12s, opacity .12s; }
  button:hover, .btn:hover { background:var(--surface-3); border-color:var(--border-3); }
  button:disabled, .btn:disabled { opacity:.4; cursor:not-allowed; }
  button:disabled:hover, .btn:disabled:hover { background:var(--surface-2); border-color:var(--border-2); }
  .btn-sm { font-size:.85rem; padding:.45rem .85rem; }
  .btn-primary { color:var(--on-accent); background:var(--accent); border-color:var(--accent); font-weight:600; }
  .btn-primary:hover { background:var(--accent); border-color:var(--accent); filter:brightness(1.08); }
  .btn-ghost { background:transparent; color:var(--muted); }
  .btn-ghost:hover { background:var(--surface-2); color:var(--text); }

  input:where(:not([type=checkbox]):not([type=radio])), select, textarea, .field {
    font-family:inherit; font-size:.92rem; padding:.55rem .7rem; border-radius:var(--r-ctl);
    border:1px solid var(--border); background:var(--surface); color:var(--text);
    font-variant-numeric:tabular-nums; -webkit-appearance:none; appearance:none; }
  select { cursor:pointer; }
  /* The drop-down list is painted by the browser on its own backplate, which doesn't
     inherit the control's dark surface - so name both colours here, or the options
     come out as black text on the UA's light grey. */
  select option { background:var(--surface); color:var(--text); }
  ::placeholder { color:var(--faint); }
  input:focus, select:focus, textarea:focus, .field:focus {
    outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
  input[type=checkbox], input[type=radio] { accent-color:var(--accent); }
  .field-sm { font-size:.85rem; padding:.38rem .55rem; border-radius:var(--r-sm); }

  /* Rarity / tier badge. Colour comes from --tc on the element (see TIER_PALETTE). */
  .pill { display:inline-block; flex:0 0 auto; font-size:.66rem; font-weight:700; letter-spacing:.07em;
    padding:.14rem .5rem; border-radius:var(--r-pill); white-space:nowrap;
    color:var(--tc,var(--accent)); border:1px solid var(--tc,var(--accent));
    background:color-mix(in srgb, var(--tc,var(--accent)) 14%, transparent); }
  .pill-lg { font-size:.72rem; letter-spacing:.1em; padding:.18rem .6rem; }

  /* Toggleable filter chip. */
  .chip { font-family:inherit; font-size:.78rem; font-weight:600; padding:.3rem .65rem;
    border-radius:var(--r-pill); cursor:pointer; color:var(--muted);
    border:1px solid var(--border-2); background:var(--surface-2); --tc:var(--accent);
    transition:color .12s, border-color .12s, background .12s; }
  .chip em { font-style:normal; font-weight:500; color:var(--faint); }
  .chip:hover { border-color:var(--tc); color:var(--text); background:var(--surface-2); }
  .chip.on { color:var(--text); border-color:var(--tc); background:color-mix(in srgb, var(--tc) 16%, var(--surface-2)); }
  .chip.on em { color:inherit; opacity:.75; }

  .card { border:1px solid var(--border); border-radius:var(--r-card); background:var(--surface); padding:1rem 1.1rem; }
  .card > h2 { font-size:.78rem; font-weight:700; letter-spacing:.09em; text-transform:uppercase;
    color:var(--muted); margin:0 0 .7rem; }

  /* Stat tile: <div class="stat"><span class="k">label</span><span class="v">value</span></div> */
  .stat { border:1px solid var(--border); border-radius:var(--r-ctl); padding:.5rem .7rem; background:transparent; }
  .stat .k { display:block; color:var(--faint); font-size:.66rem; text-transform:uppercase;
    letter-spacing:.06em; margin-bottom:.15rem; font-weight:400; }
  .stat .v { display:block; color:var(--text); font-size:1.05rem; font-family:var(--mono);
    font-weight:600; font-variant-numeric:tabular-nums; letter-spacing:-.01em; }
  .stat .sub { display:block; margin-top:.35rem; font-family:var(--font); font-size:.74rem;
    font-weight:400; letter-spacing:0; color:var(--muted); }
  .stat-lg .v { font-size:1.6rem; letter-spacing:-.03em; line-height:1.1; }

  /* Key/value row, for lists of stats inside a .card. */
  .kv { display:flex; align-items:baseline; justify-content:space-between; gap:.8rem;
    padding:.4rem 0; border-bottom:1px solid var(--border); }
  .kv:last-child { border-bottom:none; }
  .kv .k { color:var(--muted); font-size:.9rem; }
  .kv .v { font-family:var(--mono); font-weight:600; font-variant-numeric:tabular-nums; text-align:right; }
  .kv .v small { color:var(--faint); font-weight:400; }

  /* Progress bar: <div class="progress"><i></i></div> */
  .progress { height:8px; border-radius:var(--r-pill); background:var(--surface-2); overflow:hidden; }
  .progress > i { display:block; height:100%; width:0; background:var(--accent); transition:width .2s ease; }

  .spinner { width:1.05em; height:1.05em; flex:0 0 auto; border:2px solid var(--border-2);
    border-top-color:var(--accent); border-radius:50%; animation:ui-spin .7s linear infinite; }
  @keyframes ui-spin { to { transform:rotate(360deg); } }

  .err { border:1px solid var(--bad-dk); border-radius:var(--r-card); padding:1rem 1.1rem;
    color:var(--bad-lt); background:color-mix(in srgb, var(--bad) 8%, var(--surface)); }`;

// ---------------------------------------------------------------------------
// Site navigation
// ---------------------------------------------------------------------------

// One header on every page. `key` is what siteNav(active) matches against, so a page
// can mark itself current. Order is the reading order of the tools, not the routes.
// 24x24 stroke icons, drawn with currentColor so they inherit the rail's states.
// Inline because a strict CSP blocks external assets and this is five small paths.
const ICON = {
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8.5 11h1M14.5 11h1M8.5 15h1M14.5 15h1M8 19h8"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  badges: '<circle cx="12" cy="8" r="6"/><path d="m15.48 12.89 1.52 9.11-5-3-5 3 1.52-9.11"/>',
  chains: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51 8.59 10.49"/>',
  profiles: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  beta: '<path d="M9 3h6M10 3v6.5L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9.5V3"/><path d="M7.5 15h9"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  open: '<path d="m13 17 5-5-5-5M6 17l5-5-5-5"/>',
  close: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

// Groups of [key, href, label, icon]. `key` is what siteNav(active) matches to mark the
// current page. A null group title renders the links bare; a titled group gets a
// sub-heading (text when the rail is open, a plain divider when collapsed).
export const NAV_GROUPS = [
  [null, [
    ['calc', '/', 'Calculator', 'calc'],
    ['badges', '/badges', 'Badges', 'badges'],
    ['profiles', '/u', 'Profiles', 'profiles'],
  ]],
  ['Data vis', [
    ['grid', '/grid', 'Grid', 'grid'],
    ['chains', '/chains', 'Chains', 'chains'],
    ['beta', '/beta', 'Beta lab', 'beta'],
  ]],
];
export const NAV_LINKS = NAV_GROUPS.flatMap(([, links]) => links);

export const DISCLAIMER_HTML =
  'Not affiliated with <strong>rngdle.com</strong> - scoring is reverse-engineered.';

// A fixed icon rail down the left edge, collapsed by default.
//
// Everything that has to clear the rail - body padding here, the grid canvas and its
// glass overlays on /grid - is expressed in var(--rail-w), and opening the rail simply
// widens that variable. So expanding PUSHES the page rather than covering it, and no
// page needs its own open/closed rule. The one cost is that the two canvas pages must
// re-measure afterwards, which NAV_BOOT_JS handles by firing a resize event.
export const NAV_CSS = `
  /* Registering --rail-w makes it a real <length> the browser can interpolate, so the
     rail and everything measured off it slide together. Without @property support the
     declaration is ignored and the toggle simply snaps - which is fine. */
  @property --rail-w { syntax:'<length>'; inherits:true; initial-value:52px; }
  :root { --rail-w:52px; }
  :root.nav-open { --rail-w:210px; }
  /* Added by script after load, so restoring an open rail never animates on arrival. */
  :root.nav-anim { transition:--rail-w .16s ease; }
  @media (prefers-reduced-motion:reduce) { :root.nav-anim { transition:none; } }

  .rail { position:fixed; top:0; bottom:0; left:0; z-index:60; width:var(--rail-w);
    display:flex; flex-direction:column; padding:.45rem .4rem .6rem;
    background:var(--surface); border-right:1px solid var(--border); }

  /* Phones: pushing would leave ~210px of content, so hold --rail-w at the collapsed
     width and let the open rail overlay the page instead. */
  @media (max-width:640px) {
    :root, :root.nav-open { --rail-w:46px; }
    :root.nav-open .rail { width:210px; box-shadow:10px 0 30px -16px #000; transition:width .16s ease; }
    @media (prefers-reduced-motion:reduce) { :root.nav-open .rail { transition:none; } }
  }

  .rail-head { display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem;
    padding-bottom:.5rem; border-bottom:1px solid var(--border); }
  .rail-brand { flex:1; min-width:0; font-size:.86rem; font-weight:700; letter-spacing:-.01em;
    color:var(--text); text-decoration:none; white-space:nowrap; display:none; }
  .rail-brand span { color:var(--faint); font-weight:500; }
  :root.nav-open .rail-brand { display:block; }

  .rail-toggle { flex:0 0 auto; width:34px; height:34px; margin-inline:auto; padding:0;
    border:1px solid transparent; background:transparent; color:var(--muted); border-radius:var(--r-ctl); }
  .rail-toggle:hover { background:var(--surface-2); border-color:var(--border-2); color:var(--text); }
  :root.nav-open .rail-toggle { margin-inline:0; }
  .rail-toggle svg { width:18px; height:18px; }
  .rail-toggle .i-close, :root.nav-open .rail-toggle .i-open { display:none; }
  :root.nav-open .rail-toggle .i-close { display:block; }

  .rail-links { display:flex; flex-direction:column; gap:.12rem; }
  /* Group sub-heading: labelled when the rail is open, a bare divider when collapsed. */
  .rail-sect { margin:.5rem .35rem .15rem; padding-top:.5rem; border-top:1px solid var(--border);
    font-size:.62rem; font-weight:600; letter-spacing:.08em; text-transform:uppercase;
    color:var(--faint); white-space:nowrap; }
  .rail-sect span { display:none; padding-left:.15rem; }
  :root.nav-open .rail-sect span { display:block; }
  .rail-item { position:relative; display:flex; align-items:center; gap:.65rem;
    height:38px; padding:0 .5rem; border-radius:var(--r-ctl); text-decoration:none;
    color:var(--muted); transition:color .12s, background .12s; }
  .rail-item svg { flex:0 0 22px; width:22px; height:22px; }
  .rail-item b { font-size:.86rem; font-weight:500; white-space:nowrap; display:none; }
  :root.nav-open .rail-item b { display:block; }
  .rail-item:hover { color:var(--text); background:var(--surface-2); }
  .rail-item.on { color:var(--text); background:color-mix(in srgb, var(--accent) 20%, transparent); }
  .rail-item.on svg { color:var(--accent); }
  .rail-item:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }

  /* Hover label, collapsed only - when the rail is open the name is already inline. */
  .rail-item::after, .rail-note::after { content:attr(data-label); position:absolute; left:calc(100% + 10px);
    top:50%; transform:translateY(-50%); z-index:1; width:max-content; max-width:15rem; padding:.35rem .6rem;
    border-radius:var(--r-sm); background:#06070a; border:1px solid var(--border-2);
    box-shadow:0 8px 24px rgba(0,0,0,.6); font-size:.78rem; font-weight:450; line-height:1.4;
    color:var(--text); opacity:0; pointer-events:none; transition:opacity .12s; }
  .rail-item:hover::after, .rail-item:focus-visible::after,
  .rail-note:hover::after, .rail-note:focus-visible::after { opacity:1; }
  :root.nav-open .rail-item::after, :root.nav-open .rail-note::after { display:none; }

  /* "Not affiliated" disclaimer, pinned to the foot of the rail. */
  .rail-foot { margin-top:auto; padding-top:.6rem; }
  .rail-note { position:relative; display:flex; align-items:center; gap:.55rem; padding:.35rem .5rem;
    border-radius:var(--r-ctl); color:var(--hl-lt); }
  .rail-note svg { flex:0 0 18px; width:18px; height:18px; }
  .rail-note small { display:none; font-size:.7rem; line-height:1.4; }
  .rail-note small strong { color:var(--text); font-weight:600; }
  :root.nav-open .rail-note { align-items:flex-start; }
  :root.nav-open .rail-note small { display:block; }
  :root.nav-open .rail-note svg { margin-top:.1rem; }`;

/**
 * The icon rail. `active` is a NAV_LINKS key, or '' for none.
 * Open/closed state is restored in <head> (see pageShell) so it never flashes.
 */
export function siteNav(active) {
  const link = ([key, href, label, icon]) => {
    const on = key === active;
    return `    <a class="rail-item${on ? ' on' : ''}" href="${href}" data-label="${label}"` +
      `${on ? ' aria-current="page"' : ''}>${svg(icon)}<b>${label}</b></a>`;
  };
  const items = NAV_GROUPS.map(([title, links]) => {
    const group = links.map(link).join('\n');
    return title ? `    <div class="rail-sect"><span>${title}</span></div>\n${group}` : group;
  }).join('\n');

  return `<nav class="rail" id="rail" aria-label="Tools">
  <div class="rail-head">
    <a class="rail-brand" href="/">RNGdle <span>tools</span></a>
    <button type="button" id="rail-toggle" class="rail-toggle" aria-controls="rail" aria-expanded="false"
      title="Expand sidebar" aria-label="Expand sidebar"><span class="i-open">${svg('open')}</span><span class="i-close">${svg('close')}</span></button>
  </div>
  <div class="rail-links">
${items}
  </div>
  <div class="rail-foot">
    <div class="rail-note" tabindex="0" role="note" data-label="${DISCLAIMER_HTML.replace(/<[^>]+>/g, '')}">
      ${svg('info')}<small>${DISCLAIMER_HTML}</small>
    </div>
  </div>
</nav>`;
}

// Runs in <head>, before the rail paints, so a returning visitor never sees it flash
// open-then-shut. The click handler is attached from the same script on DOMContentLoaded.
export const NAV_BOOT_JS = `
(function () {
  var KEY = 'rngdle-nav-open';
  var root = document.documentElement;
  function apply(open) {
    root.classList.toggle('nav-open', open);
    var b = document.getElementById('rail-toggle');
    if (b) {
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      b.title = b.ariaLabel = open ? 'Collapse sidebar' : 'Expand sidebar';
    }
  }
  try { apply(localStorage.getItem(KEY) === '1'); } catch (e) {}
  addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('rail-toggle');
    if (!b) return;
    apply(root.classList.contains('nav-open'));
    // Only animate from here on - the restored state above must appear instantly.
    requestAnimationFrame(function () { root.classList.add('nav-anim'); });
    b.addEventListener('click', function () {
      var open = !root.classList.contains('nav-open');
      apply(open);
      try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) {}
      // Toggling --rail-w resizes the content area, and the canvas pages (/grid,
      // /chains) only re-measure on a resize event. Fire once now for the snap case
      // (no @property support, or reduced motion) and once after the slide.
      dispatchEvent(new Event('resize'));
      setTimeout(function () { dispatchEvent(new Event('resize')); }, 220);
    });
  });
})();`;

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

/**
 * Assemble a full document from the shared layer plus page-specific parts.
 *
 * @param {object}  o
 * @param {string}  o.title    <title> text (already escaped by the caller if dynamic)
 * @param {string}  o.body     markup that goes inside <body>, after the site header
 * @param {string} [o.css]     page-specific CSS, emitted after the shared layer
 * @param {string} [o.script]  contents of a trailing <script type="module">
 * @param {string} [o.nav]     NAV_LINKS key of the current page; '' for no page marked.
 *                             Pass null to omit the rail entirely.
 * @param {string} [o.width]   value for --wrap (default 960px)
 * @param {boolean}[o.full]    full-bleed app layout: no body padding, no page scroll.
 *                             The page must offset its own fixed overlays by --rail-w.
 * @param {boolean}[o.noindex] emit <meta name="robots" content="noindex">
 * @param {string} [o.head]    extra <head> markup (meta/link tags), escaped by the caller
 * @param {string} [o.viewport] override the viewport meta (canvas pages lock pinch-zoom)
 */
// Inline so the browser never requests /favicon.ico - the Worker has no route for it,
// so every page load was logging a 404. Three dots on the shared surface colour, which
// is as much as reads at 16px.
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#131419"/>' +
  '<circle cx="10" cy="10" r="3" fill="#5b93d6"/>' +
  '<circle cx="22" cy="16" r="3" fill="#e8924e"/>' +
  '<circle cx="10" cy="22" r="3" fill="#5b93d6"/></svg>');

export function pageShell(o) {
  const rail = o.nav == null ? '' : siteNav(o.nav);
  // Document pages reserve the collapsed rail with padding; full-bleed pages get out of
  // the way themselves. Either way the reserved width never changes when the rail opens.
  const layout = o.full
    ? `  html, body { height:100%; overflow:hidden; }`
    : `  body { padding:1.6rem 1.25rem 4rem calc(var(--rail-w) + 1.5rem); }`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="viewport" content="${o.viewport || 'width=device-width,initial-scale=1'}">
${o.noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="icon" href="${FAVICON}">
<title>${o.title}</title>
${o.head || ''}
<style>${TOKENS_CSS}
  :root { --wrap:${o.width || '960px'}; }
${BASE_CSS}
${COMPONENTS_CSS}
${NAV_CSS}
${layout}
${o.css || ''}
</style>${rail ? `\n<script>${NAV_BOOT_JS}</script>` : ''}
</head>
<body>
${rail}
${o.body}
${o.script ? `<script type="module">\n${o.script}\n</script>` : ''}
</body></html>`;
}
