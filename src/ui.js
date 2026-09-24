// Shared shell for every HTML page this Worker still serves: /chains and the /beta
// tools. They sit inside the front end's own furniture - the same header, tabs, theme
// toggle, palette, fonts and footer as the tabs in site/ - so opening a tool from the
// Other tab no longer looks like leaving the site.
//
// How that works without rewriting thirteen pages of CSS:
//
//   - The page links the front end's /style.css (rngdle's Tailwind bundle + extra.css)
//     and drops the header markup from site/index.html in verbatim (SITE_HEADER,
//     pinned to the original by tools/check.cjs).
//   - The legacy pages' own CSS keeps the variable names it always used (--bg, --text,
//     --border, --accent, ...), but TOKENS_CSS now defines each one in terms of the
//     front end's theme variables (--site-bg, --prose, --outline, --status-info, ...).
//     Those switch under `html.dark`, so every page follows the light/dark toggle.
//   - All of it goes in a cascade layer, `legacy`, ordered after Tailwind's `base`
//     and before its `components`/`utilities`. Legacy rules therefore beat
//     Tailwind's preflight, but never the utility classes on the header markup - a
//     bare `button {}` rule down here cannot restyle the theme toggle.
//   - Preflight zeroes every margin and list style and makes <svg> a block. The pages
//     were written against the browser defaults, so REVERT_CSS rolls those few
//     properties back to the UA inside `.legacy` (svg internals excepted, where a
//     revert would drop presentation attributes).
//
// Usage from a render function:
//
//   pageShell({
//     title: 'RNGdle - Badge Index',
//     width: '1100px',        // sets --wrap
//     css:   PAGE_SPECIFIC_CSS,
//     body:  `<div class="wrap">…</div>`,
//     script: `…`,
//   })
//
// Page CSS is emitted *after* the shared layer, so an equally-specific page rule wins.

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// The legacy names, mapped onto the front end's theme. `--surface` and `--muted` are
// not listed: the front end defines both under the same names with the same meaning.
// --head-h is the site header's height, which the full-bleed pages sit below.
export const TOKENS_CSS = `
  :root {
    color-scheme: light;
    --bg:var(--site-bg); --surface-2:var(--surface-raised);
    --surface-3:color-mix(in srgb, var(--surface-raised) 80%, var(--prose));
    --border:var(--outline-subtle); --border-2:var(--outline); --border-3:var(--outline-strong);
    --text:var(--prose); --dim:var(--prose-2); --faint:var(--prose-3);
    --accent:var(--status-info); --accent-soft:var(--status-info-surface); --on-accent:var(--site-bg);
    --hl:var(--ep-text); --hl-lt:var(--ep-text);
    --ok:var(--status-success); --on-ok:var(--site-bg);
    --bad:var(--status-danger); --bad-lt:var(--status-danger-text); --bad-dk:var(--status-danger-outline);
    --font: var(--font-ui), -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: var(--font-mono), ui-monospace, Menlo, Consolas, monospace;
    --r-sm:4px; --r-ctl:8px; --r-card:8px; --r-hero:8px; --r-pill:999px;
    --wrap:960px; --head-h:48px;
  }
  :root.dark { color-scheme: dark; }`;

// ---------------------------------------------------------------------------
// Preflight, undone
// ---------------------------------------------------------------------------

export const REVERT_CSS = `
  :where(.legacy *:not(svg *)) { margin:revert; padding:revert; list-style:revert;
    font-size:revert; font-weight:revert; text-decoration:revert; border-collapse:revert; }
  :where(.legacy :is(img, svg, video, canvas)) { display:revert; vertical-align:revert; }`;

// A handful of rngdle's own rules sit outside any layer (the tail of its bundle), so
// no layered rule can beat them: an uppercase `button` and `input`, and a `body`
// painted --background, which is black in light mode too. Answered here, unlayered.
export const UNLAYERED_CSS = `
  html, body { background-color:var(--site-bg); }
  .legacy :is(button, input, select, textarea) { text-transform:none; }`;

// ---------------------------------------------------------------------------
// Base element styling
// ---------------------------------------------------------------------------

// Scoped to .legacy: <body> keeps the front end's own rules (uppercase, Inter), which
// the header and footer rely on.
export const BASE_CSS = `
  * { box-sizing:border-box; }
  /* Crossfade same-origin page navigations (MPA view transitions) where supported,
     instead of a hard cut between documents. Ignored by browsers without support. */
  @view-transition { navigation: auto; }

  .legacy { font-family:var(--font); color:var(--text); line-height:1.5; text-transform:none;
    -webkit-font-smoothing:antialiased; }
  :where(.legacy) a { color:var(--accent); }
  :where(.legacy) h1 { font-size:var(--type-page-size); line-height:var(--type-page-leading); font-weight:700;
    text-transform:uppercase; letter-spacing:normal; margin:0 0 .4rem; }
  :where(.legacy) h2 { letter-spacing:normal; }
  :where(.legacy) p.tag { color:var(--dim); margin:0 0 1.6rem; font-size:var(--type-body-size); line-height:var(--type-prose-leading); }
  .wrap { max-width:var(--wrap); margin:0 auto; }
  .mono { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .muted { color:var(--muted); }
  .eyebrow { font-size:var(--type-meta-size); letter-spacing:var(--type-label-tracking); text-transform:uppercase;
    font-weight:700; color:var(--prose-3); margin:0 0 .8rem; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  :where(.legacy) footer { margin-top:2.5rem; color:var(--prose-3); font-size:.8rem; line-height:1.7; }
  :where(.legacy) footer b { color:var(--muted); font-weight:600; }
  :where(.legacy) footer code { color:var(--muted); font-family:var(--mono); }`;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// Bare `button`/`input`/`select` are styled, not just `.btn`/`.field`, so that every
// control on every page picks up the shared look without touching its markup. Pages
// that need something else already use a more specific selector (`#ctrls button`,
// `.chip`, `#plate-hud button`, …), which still wins. Checkboxes and radios are held
// out via :where(), which keeps the selector at plain-element specificity. All of it
// is scoped to .legacy so the header's own controls keep the front end's look.
//
// The looks are the front end's: an outlined surface button (the Share button), an
// inverted primary (the selected theme toggle), polished cards, type-label headings.
export const COMPONENTS_CSS = `
  :where(.legacy) button, .btn { font-family:inherit; font-size:var(--type-ui-size); font-weight:700; line-height:1.2;
    display:inline-flex; align-items:center; justify-content:center; gap:.45rem;
    padding:.55rem 1rem; border-radius:var(--r-ctl); cursor:pointer; text-decoration:none;
    color:var(--dim); background:var(--surface); border:1px solid var(--border-2);
    transition:background .15s, border-color .15s, color .15s, opacity .15s, transform .15s; }
  :where(.legacy) button:hover, .btn:hover { background:var(--surface-2); border-color:var(--border-3); color:var(--text); }
  :where(.legacy) button:active, .btn:active { transform:scale(.98); }
  :where(.legacy) button:disabled, .btn:disabled { opacity:.4; cursor:not-allowed; transform:none; }
  :where(.legacy) button:disabled:hover, .btn:disabled:hover { background:var(--surface); border-color:var(--border-2); color:var(--dim); }
  .btn-sm { font-size:var(--type-meta-size); padding:.4rem .75rem; }
  .btn-primary { color:var(--surface); background:var(--text); border-color:var(--text); }
  .btn-primary:hover { color:var(--surface); background:var(--text); border-color:var(--text); filter:brightness(1.15); }
  .btn-ghost { background:transparent; border-color:transparent; color:var(--muted); }
  .btn-ghost:hover { background:var(--surface-2); border-color:transparent; color:var(--text); }

  :where(.legacy) :where(input:not([type=checkbox]):not([type=radio]), select, textarea), .field {
    font-family:inherit; font-size:var(--type-ui-size); padding:.5rem .7rem; border-radius:var(--r-ctl);
    border:1px solid var(--border-2); background:var(--surface); color:var(--text);
    font-variant-numeric:tabular-nums; -webkit-appearance:none; appearance:none; transition:border-color .15s;
  }
  :where(.legacy) select { cursor:pointer; }
  /* The drop-down list is painted by the browser on its own backplate, which doesn't
     inherit the control's surface - so name both colours here, or the options come
     out as black text on the UA's light grey in dark mode. */
  :where(.legacy) select option { background:var(--surface); color:var(--text); }
  :where(.legacy) ::placeholder { color:var(--prose-3); }
  :where(.legacy) :where(input, select, textarea):focus, .field:focus {
    outline:none; border-color:var(--border-3); }
  :where(.legacy) input[type=checkbox], :where(.legacy) input[type=radio] { accent-color:var(--text); }
  .field-sm { font-size:var(--type-meta-size); padding:.35rem .55rem; border-radius:var(--r-sm); }

  /* Rarity / tier badge. Colour comes from --tc on the element (see TIER_PALETTE). */
  .pill { display:inline-block; flex:0 0 auto; font-size:.66rem; font-weight:700; letter-spacing:.07em;
    padding:.14rem .5rem; border-radius:var(--r-sm); white-space:nowrap; text-transform:uppercase;
    color:var(--tc,var(--accent)); border:1px solid var(--tc,var(--accent));
    background:color-mix(in srgb, var(--tc,var(--accent)) 14%, transparent); }
  .pill-lg { font-size:.72rem; letter-spacing:.1em; padding:.18rem .6rem; }

  /* Toggleable filter chip. */
  .chip { font-family:inherit; font-size:var(--type-meta-size); font-weight:700; padding:.3rem .65rem;
    border-radius:var(--r-ctl); cursor:pointer; color:var(--muted);
    border:1px solid var(--border-2); background:var(--surface); --tc:var(--text);
    transition:color .15s, border-color .15s, background .15s; }
  .chip em { font-style:normal; font-weight:500; color:var(--faint); }
  .chip:hover { border-color:var(--border-3); color:var(--text); background:var(--surface-2); }
  .chip.on { color:var(--text); border-color:var(--tc); background:color-mix(in srgb, var(--tc) 14%, var(--surface)); }
  .chip.on em { color:inherit; opacity:.75; }

  .card { border:1px solid var(--border-2); border-radius:var(--r-card); background:var(--surface);
    box-shadow:0 1px 3px 0 #0000001a, 0 1px 2px -1px #0000001a; padding:1rem 1.1rem; }
  .card > h2 { font-size:var(--type-meta-size); line-height:var(--type-meta-leading); font-weight:700;
    letter-spacing:var(--type-label-tracking); text-transform:uppercase; color:var(--prose-3); margin:0 0 .8rem; }

  /* Stat tile: <div class="stat"><span class="k">label</span><span class="v">value</span></div> */
  .stat { border:1px solid var(--border-2); border-radius:var(--r-ctl); padding:.55rem .75rem; background:var(--surface); }
  .stat .k { display:block; color:var(--prose-3); font-size:.66rem; text-transform:uppercase;
    letter-spacing:var(--type-label-tracking); margin-bottom:.15rem; font-weight:700; }
  .stat .v { display:block; color:var(--text); font-size:1.05rem; font-family:var(--mono);
    font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-.01em; }
  .stat .sub { display:block; margin-top:.35rem; font-family:var(--font); font-size:.74rem;
    font-weight:400; letter-spacing:0; color:var(--muted); }
  .stat-lg .v { font-size:1.6rem; letter-spacing:-.03em; line-height:1.1; }

  /* Key/value row, for lists of stats inside a .card. */
  .kv { display:flex; align-items:baseline; justify-content:space-between; gap:.8rem;
    padding:.4rem 0; border-bottom:1px solid var(--border); }
  .kv:last-child { border-bottom:none; }
  .kv .k { color:var(--muted); font-size:.9rem; }
  .kv .v { font-family:var(--mono); font-weight:700; font-variant-numeric:tabular-nums; text-align:right; }
  .kv .v small { color:var(--faint); font-weight:400; }

  /* Progress bar: <div class="progress"><i></i></div> */
  .progress { height:8px; border-radius:var(--r-pill); background:var(--surface-2); overflow:hidden; }
  .progress > i { display:block; height:100%; width:0; background:var(--text); transition:width .2s ease; }

  .spinner { width:1.05em; height:1.05em; flex:0 0 auto; border:2px solid var(--border-2);
    border-top-color:var(--text); border-radius:50%; animation:ui-spin .7s linear infinite; }
  @keyframes ui-spin { to { transform:rotate(360deg); } }

  .err { border:1px solid var(--bad-dk); border-radius:var(--r-card); padding:1rem 1.1rem;
    color:var(--bad-lt); background:var(--status-danger-surface); }`;

// ---------------------------------------------------------------------------
// Site header and footer
// ---------------------------------------------------------------------------

// site/index.html's <header>, character for character (tools/check.cjs fails if the
// two drift). The Other tab is marked current: every page here is one of its tools.
export const SITE_HEADER = `  <header class="flex items-center justify-between bg-site-bg px-2 py-1 ps-4 text-prose">
    <div class="flex items-center gap-1 sm:gap-2 min-w-0">
      <a class="text-lg font-bold tracking-widest hover:text-prose-2 transition-colors normal-case shrink-0" href="/">RNGdle</a>
      <nav class="flex items-center gap-1" id="nav">
        <a href="/" data-view="sandbox" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-dices h-4 w-4 shrink-0" aria-hidden="true"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"></rect><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"></path><path d="M6 18h.01"></path><path d="M10 14h.01"></path><path d="M15 6h.01"></path><path d="M18 9h.01"></path></svg><span class="hidden sm:inline">Roll</span></a>
        <a href="/ep" data-view="ep" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calculator h-4 w-4 shrink-0" aria-hidden="true"><rect width="16" height="20" x="4" y="2" rx="2"></rect><line x1="8" x2="16" y1="6" y2="6"></line><line x1="16" x2="16" y1="14" y2="18"></line><path d="M16 10h.01"></path><path d="M12 10h.01"></path><path d="M8 10h.01"></path><path d="M12 14h.01"></path><path d="M8 14h.01"></path><path d="M12 18h.01"></path><path d="M8 18h.01"></path></svg><span class="hidden sm:inline">EP&nbsp;to&nbsp;Number</span></a>
        <a href="/analysis" data-view="analysis" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-column h-4 w-4 shrink-0" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path></svg><span class="hidden sm:inline">Analysis</span></a>
        <a href="/grid" data-view="grid" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-grid-2x2 h-4 w-4 shrink-0" aria-hidden="true"><path d="M12 3v18"></path><path d="M3 12h18"></path><rect x="3" y="3" width="18" height="18" rx="2"></rect></svg><span class="hidden sm:inline">Grid</span></a>
        <a href="/neighbours" data-view="neighbours" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-left-right h-4 w-4 shrink-0" aria-hidden="true"><path d="M8 3 4 7l4 4"></path><path d="M4 7h16"></path><path d="m16 21 4-4-4-4"></path><path d="M20 17H4"></path></svg><span class="hidden sm:inline">Neighbours</span></a>
        <a href="/luck" data-view="luck" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles h-4 w-4 shrink-0" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path></svg><span class="hidden sm:inline">Luck</span></a>
        <a href="/badges" data-view="badges" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-award h-4 w-4 shrink-0" aria-hidden="true"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"></path><circle cx="12" cy="8" r="6"></circle></svg><span class="hidden sm:inline">Badges</span></a>
        <a href="/u" data-view="profiles" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users h-4 w-4 shrink-0" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><path d="M16 3.128a4 4 0 0 1 0 7.744"></path><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><circle cx="9" cy="7" r="4"></circle></svg><span class="hidden sm:inline">Profiles</span></a>
        <a href="/other" data-view="other" class="nav-tab flex items-center gap-1 rounded-lg p-2 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flask-conical h-4 w-4 shrink-0" aria-hidden="true"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"></path><path d="M6.453 15h11.094"></path><path d="M8.5 2h7"></path></svg><span class="hidden sm:inline">Other</span></a>
      </nav>
    </div>
    <div class="flex items-center gap-1">
      <div class="flex items-center rounded-sm border border-outline overflow-hidden" id="theme-toggle">
        <button data-theme="light" aria-label="Light mode" title="Light" class="p-1.5 transition-colors cursor-pointer text-prose-2 hover:bg-surface-raised"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 pointer-events-none" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg></button>
        <button data-theme="auto" aria-label="Auto mode" title="Auto" class="p-1.5 transition-colors cursor-pointer text-prose-2 hover:bg-surface-raised"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 pointer-events-none" aria-hidden="true"><path d="M12 2v2"></path><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"></path><path d="M16 12a4 4 0 0 0-4-4"></path><path d="m19 5-1.256 1.256"></path><path d="M20 12h2"></path></svg></button>
        <button data-theme="dark" aria-label="Dark mode" title="Dark" class="p-1.5 transition-colors cursor-pointer text-prose-2 hover:bg-surface-raised"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 pointer-events-none" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"></path></svg></button>
      </div>
      <a href="https://www.rngdle.com" target="_blank" rel="noopener noreferrer" class="type-button flex items-center gap-2 px-3 py-2 cursor-pointer rounded-lg border border-outline bg-surface text-prose hover:border-outline-strong hover:shadow-sm active:scale-[0.98] transition-all">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg><span class="hidden sm:inline">Real Game</span>
      </a>
    </div>
  </header>`;

// The front end's footer, with the same wording.
export const SITE_FOOTER = `  <footer class="type-meta text-prose-3 text-center pb-6 normal-case px-4">
    RNGdle Tools is unofficial and not affiliated with RNGdle.
    <a class="underline hover:text-prose-2" href="https://www.rngdle.com" target="_blank" rel="noopener noreferrer">Play the real game</a>,
    where it really is one roll a day.
    <span class="text-outline-strong px-1">·</span>
    <a class="underline hover:text-prose-2" href="/credits">Credits</a>
  </footer>`;

const headerFor = active => SITE_HEADER.replace(
  `data-view="${active}" class="nav-tab `,
  `data-view="${active}" aria-current="page" class="nav-tab is-active `);

// Runs in <head>, before first paint, so the page never flashes the wrong theme. The
// storage key, the default ("dark") and the toggle's classes are app.js's applyTheme;
// the tab tooltips are ep.js's (the labels fold away on narrow screens).
export const THEME_BOOT_JS = `
(function () {
  var root = document.documentElement;
  function dark(mode) {
    return mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  var mode = 'dark';
  try { mode = localStorage.getItem('theme') || 'dark'; } catch (e) {}
  root.classList.toggle('dark', dark(mode));
  function apply(m) {
    mode = m;
    root.classList.toggle('dark', dark(m));
    var t = document.getElementById('theme-toggle');
    if (t) for (var i = 0; i < t.children.length; i++) {
      var b = t.children[i], on = b.dataset.theme === m;
      b.classList.toggle('bg-prose', on);
      b.classList.toggle('text-surface', on);
      b.classList.toggle('text-prose-2', !on);
    }
    try { localStorage.setItem('theme', m); } catch (e) {}
    // The canvas pages read their colours off the tokens when they draw.
    dispatchEvent(new Event('themechange'));
  }
  addEventListener('DOMContentLoaded', function () {
    apply(mode);
    var tabs = document.querySelectorAll('.nav-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].title = tabs[i].textContent.trim();
    var t = document.getElementById('theme-toggle');
    if (t) t.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) apply(b.dataset.theme);
    });
  });
})();`;

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

// Inline so the browser never requests /favicon.ico. Three dots, as before, in the
// front end's dark ground.
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#1b1922"/>' +
  '<circle cx="10" cy="10" r="3" fill="#78aaff"/>' +
  '<circle cx="22" cy="16" r="3" fill="#f59e0b"/>' +
  '<circle cx="10" cy="22" r="3" fill="#78aaff"/></svg>');

// @property must sit at the top level; everything else goes in the layer.
const hoistProperties = css => {
  const props = [];
  const rest = css.replace(/@property\s+[^{]+\{[^}]*\}/g, m => { props.push(m); return ''; });
  return [props.join('\n'), rest];
};

/**
 * Assemble a full document: the front end's header, then the page.
 *
 * @param {object}  o
 * @param {string}  o.title    <title> text (already escaped by the caller if dynamic)
 * @param {string}  o.body     markup that goes inside the page, below the site header
 * @param {string} [o.css]     page-specific CSS, emitted after the shared layer
 * @param {string} [o.script]  contents of a trailing <script type="module">
 * @param {string} [o.width]   value for --wrap (default 960px)
 * @param {boolean}[o.full]    full-bleed app layout: no page padding, no page scroll,
 *                             no footer. The page's fixed layers start at --head-h.
 * @param {boolean}[o.noindex] emit <meta name="robots" content="noindex">
 * @param {string} [o.head]    extra <head> markup (meta/link tags), escaped by the caller
 * @param {string} [o.viewport] override the viewport meta (canvas pages lock pinch-zoom)
 */
export function pageShell(o) {
  const layout = o.full
    ? `  html, body { height:100%; overflow:hidden; }`
    : `  .legacy-doc { flex:1; width:100%; padding:1.5rem 1.25rem 4rem; }
  @media (max-width:640px) { .legacy-doc { padding:.75rem .75rem 3rem; } }`;
  const [props, css] = hoistProperties(`${TOKENS_CSS}
  :root { --wrap:${o.width || '960px'}; }
${REVERT_CSS}
${BASE_CSS}
${COMPONENTS_CSS}
${layout}
${o.css || ''}`);

  const page = o.full
    ? `${headerFor('other')}\n<div class="legacy">\n${o.body}\n</div>`
    : `<div class="app-shell flex flex-col bg-site-bg font-sans">\n${headerFor('other')}\n` +
      `<main class="legacy legacy-doc">\n${o.body}\n</main>\n${SITE_FOOTER}\n</div>`;

  return `<!doctype html>
<html lang="en" class="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="${o.viewport || 'width=device-width,initial-scale=1'}">
<meta name="theme-color" content="#0a0a0a">
${o.noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="icon" href="${FAVICON}">
<title>${o.title}</title>
<style>@layer properties, theme, base, legacy, components, utilities;</style>
<link rel="stylesheet" href="/style.css">
${o.head || ''}
<script>${THEME_BOOT_JS}</script>
<style>${props}
${UNLAYERED_CSS}
@layer legacy {
${css}
}
</style>
</head>
<body class="antialiased">
${page}
${o.script ? `<script type="module">\n${o.script}\n</script>` : ''}
</body></html>`;
}
