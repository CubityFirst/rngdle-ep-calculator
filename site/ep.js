// EP -> Number. Given an EP total, list every number in 0..1000000 that scores
// exactly it.
//
// The badge engine has no inverse, so this is brute force — but precomputed.
// tools/build-ep-table.js sweeps the range once and writes ep-table.bin (a flat
// Uint32Array of EP-per-number, 4MB raw / ~1.6MB brotli over the wire). Doing
// that sweep in the browser instead took 15s on 12 cores and minutes on a
// phone. Fetched once, HTTP-cached after, then a lookup is a typed-array scan.

const MAX_N = 1000000;
const TABLE_LEN = MAX_N + 1;
const SHOWN_LIMIT = 600;          // cap the grid; the count is always exact
// Gzipped and inflated here rather than left to the CDN: Cloudflare only
// auto-compresses by content-type and skips application/octet-stream, so a raw
// .bin ships at the full 4MB. This also keeps the size win on any other host.
const TABLE_URL = "/ep-table.bin.gz";

let table = null;                 // Uint32Array | null
let distinct = null;              // sorted unique EP totals, built on demand
let loading = null;               // in-flight fetch

const epEl = id => document.getElementById(id);
const card = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

function status(text) {
  epEl("ep-status").hidden = !text;
  if (text) epEl("ep-status-text").textContent = text;
}

async function getTable() {
  if (table) return table;
  if (loading) return loading;
  loading = (async () => {
    status("Loading the EP index…");
    const res = await fetch(TABLE_URL);
    if (!res.ok) throw new Error(`${TABLE_URL}: ${res.status} ${res.statusText}`);
    const buf = await new Response(
      res.body.pipeThrough(new DecompressionStream("gzip"))
    ).arrayBuffer();
    if (buf.byteLength !== TABLE_LEN * 4) {
      throw new Error(`${TABLE_URL} is ${buf.byteLength} bytes, expected ${TABLE_LEN * 4}`);
    }
    // Written little-endian by the build script; every browser target is LE.
    table = new Uint32Array(buf);
    status("");
    return table;
  })();
  try { return await loading; } finally { loading = null; }
}

const distinctTotals = () => distinct || (distinct = [...new Set(table)].sort((a, b) => a - b));

// Closest EP totals that actually occur, for when the asked-for one does not.
function nearestReachable(target, count) {
  const all = distinctTotals();
  let lo = 0, hi = all.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (all[m] < target) lo = m + 1; else hi = m; }
  let a = lo - 1, b = lo, out = [];
  while (out.length < count && (a >= 0 || b < all.length)) {
    if (a < 0) out.push(all[b++]);
    else if (b >= all.length) out.push(all[a--]);
    else out.push(target - all[a] <= all[b] - target ? all[a--] : all[b++]);
  }
  return out.sort((x, y) => x - y);
}

/* --- rendering ------------------------------------------------------------ */
function copyRow(matches) {
  const p = card(`<p class="type-meta text-prose-3 mt-4 normal-case"><button class="underline hover:text-prose-2 cursor-pointer">Copy all ${fmt(matches.length)} to clipboard</button></p>`);
  p.querySelector("button").addEventListener("click", async e => {
    try { await navigator.clipboard.writeText(matches.join("\n")); e.target.textContent = "Copied"; }
    catch { e.target.textContent = "Copy failed"; }
  });
  return p;
}

function renderMatches(target, matches) {
  const res = epEl("ep-results");
  res.replaceChildren();

  if (!matches.length) {
    res.append(card(`
      <div class="border border-outline rounded-lg bg-surface px-4 py-6 normal-case">
        <p class="type-ui text-prose mb-1">No number scores exactly ${fmt(target)} EP.</p>
        <p class="type-meta text-prose-3">Totals are sums of fixed badge values, so most amounts are unreachable.</p>
      </div>`));
    const near = nearestReachable(target, 6);
    if (near.length) {
      const box = card('<div class="mt-4 normal-case"><p class="type-meta text-prose-3 mb-2">Nearest reachable totals:</p><div class="flex flex-wrap justify-center gap-1.5"></div></div>');
      const row = box.lastElementChild;
      for (const v of near) {
        const b = card(`<button class="type-meta px-2 py-1 rounded-sm border border-outline bg-surface text-prose-2 hover:border-outline-strong transition-colors cursor-pointer">${fmt(v)} EP</button>`);
        b.addEventListener("click", () => { epEl("ep-input").value = fmt(v); search(); });
        row.appendChild(b);
      }
      res.appendChild(box);
    }
    return;
  }

  // Every match has the same total, so the rarity is the same for all of them.
  const pill = RARITY.RARITY_PALETTE[RARITY.getCardRarityTier(target)].pill;
  res.appendChild(card(`
    <div class="flex flex-wrap items-center justify-center gap-2 mb-4 normal-case">
      <span class="type-data font-semibold px-3 py-1 rounded-full ${pill.bgClass} ${pill.textClass} ${pill.borderClass}">${fmt(target)} EP</span>
      <span class="text-outline-strong">•</span>
      <span class="type-label px-2 py-0.5 rounded-sm ${pill.bgClass} ${pill.textClass} ${pill.borderClass}">${pill.label}</span>
      <span class="text-outline-strong">•</span>
      <span class="type-ui text-prose-2">${fmt(matches.length)} number${matches.length === 1 ? "" : "s"}</span>
    </div>`));

  const grid = card('<div class="flex flex-wrap justify-center gap-1.5"></div>');
  for (const n of matches.slice(0, SHOWN_LIMIT)) {
    grid.appendChild(card(`<a href="/n/${n}" title="Open ${fmt(n)} in the sandbox" class="font-roll tabular-nums text-sm px-2 py-1 rounded-sm border transition-opacity hover:opacity-70 ${pill.bgClass} ${pill.textClass} ${pill.borderClass}">${n}</a>`));
  }
  res.appendChild(grid);

  if (matches.length > SHOWN_LIMIT) {
    res.appendChild(card(`<p class="type-meta text-prose-3 mt-4 normal-case">Showing the first ${fmt(SHOWN_LIMIT)} of ${fmt(matches.length)}.</p>`));
  }
  if (matches.length > 24) res.appendChild(copyRow(matches));
}

/* --- search --------------------------------------------------------------- */
let searching = false;
async function search() {
  if (searching) return;
  const raw = epEl("ep-input").value.replace(/[^0-9]/g, "");
  if (!raw) { epEl("ep-results").replaceChildren(); return; }
  const target = Number(raw);

  searching = true;
  epEl("ep-go").disabled = true;
  try {
    const t = await getTable();
    const matches = [];
    for (let n = 0; n < TABLE_LEN; n++) if (t[n] === target) matches.push(n);
    epEl("ep-status").hidden = true;
    renderMatches(target, matches);
  } catch (err) {
    epEl("ep-status").hidden = true;
    epEl("ep-results").replaceChildren(card(`
      <div class="border border-outline rounded-lg bg-surface px-4 py-6 normal-case">
        <p class="type-ui text-prose mb-1">Could not load the EP index.</p>
        <p class="type-meta text-prose-3"></p>
      </div>`));
    epEl("ep-results").querySelector(".type-meta").textContent = String(err && err.message || err);
  } finally {
    searching = false;
    epEl("ep-go").disabled = false;
  }
}

epEl("ep-form").addEventListener("submit", e => { e.preventDefault(); search(); });
epEl("ep-input").addEventListener("input", e => {
  const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 12);
  e.target.value = digits ? fmt(Number(digits)) : "";
});

/* --- routing -------------------------------------------------------------- */
// Real paths, not hashes:
//
//   /                    the sandbox
//   /ep                  EP -> Number
//   /analysis            the EP distribution, filtered
//   /grid                the 1000x1000 number map, shaded by badge count
//   /grid/ep             … by total EP;  /grid/rarity  … by card tier
//   /grid/<slug>         … lit up for one badge
//   /neighbours          the 54 numbers one digit away from 123456
//   /neighbours/<number> … from that number
//   /luck                the odds of a roll
//   /luck/<name>         … and how lucky that player's were; /luck/<a>,<b> ranks them
//   /badges              the badge map
//   /badges/<slug>       one badge — rngdle's own URL for it
//   /badges?layout=…     the map in a given layout (official | compact)
//   /u                   look up a player
//   /u/<name>            that player's profile — rngdle's own URL again
//   /other               the legacy tools, each on its own page under /beta/ or /chains
//   /n/<number>          open a specific number in the sandbox
//
// Workers Static Assets serves the app shell for any path it has no file for
// (`not_found_handling: single-page-application`), so these are real URLs: they
// survive a reload, a share and a right-click-open-in-new-tab. That does mean
// the site now needs to be served rather than opened off disk — `file://` has
// no such fallback, and every one of these links would 404 against it.
const VIEWS = {
  sandbox: { path: "/", title: "RNGdle Sandbox" },
  ep: { path: "/ep", title: "EP to Number · RNGdle Sandbox" },
  analysis: { path: "/analysis", title: "Analysis · RNGdle Sandbox" },
  grid: { path: "/grid", title: "Grid · RNGdle Sandbox" },
  neighbours: { path: "/neighbours", title: "Neighbours · RNGdle Sandbox" },
  luck: { path: "/luck", title: "Luck · RNGdle Sandbox" },
  badges: { path: "/badges", title: "Badges · RNGdle Sandbox" },
  profiles: { path: "/u", title: "Profiles · RNGdle Sandbox" },
  other: { path: "/other", title: "Other · RNGdle Sandbox" },
};

// Paths the Worker answers itself rather than the shell: the legacy tools under
// /beta/ and /chains, and their engine and APIs (worker.js). A click on one is a
// real navigation, and a cold load of one never runs this script at all.
const WORKER_PATHS = /^\/(?:beta|chains)(?:\/|$)|^\/engine\.js$|^\/api(?:\/|$)/;
const VIEW_BY_PATH = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [v.path, k]));

// Links shared while the site was on hashes still land in the right place.
function legacyPath(hash) {
  const h = hash.replace(/^#/, "");
  if (!h) return null;
  if (VIEWS[h]) return VIEWS[h].path;
  const n = /^n=(\d+)$/.exec(h);
  if (n) return `/n/${n[1]}`;
  const b = /^badge=(.+)$/.exec(h);
  if (b) return `/badges/${b[1]}`;
  return null;
}

// `layoutHint` is the layout a history entry recorded (badges.js stamps it on
// the entry), so Back returns to what was showing rather than what is stored.
function showView(path, layoutHint) {
  // The query is only read on /badges, where ?layout= picks the map's layout;
  // everywhere else it is carried but ignored.
  const [pathOnly, query = ""] = path.split("?");
  const clean = pathOnly.replace(/\/+$/, "") || "/";
  const num = /^\/n\/(\d+)$/.exec(clean);
  const slug = /^\/badges\/(.+)$/.exec(clean);
  // One player, or several comma-separated (/u/alice,bob) pooled into one view.
  const who = /^\/u\/([A-Za-z0-9_-]{1,40}(?:,[A-Za-z0-9_-]{1,40})*)$/.exec(clean);
  // The grid's sub-path: ep, rarity, or a badge slug (grid.js resolves it, and
  // a slug that names nothing falls back to the badge-count view).
  const gridSub = /^\/grid\/([^/]+)$/.exec(clean);
  // The Neighbours tab's number; a bare /neighbours opens on its default.
  const nbNum = /^\/neighbours\/(\d{1,6})$/.exec(clean);
  // The Luck tab's players, one or several comma-separated, as /u takes them.
  const luckWho = /^\/luck\/([A-Za-z0-9_-]{1,40}(?:,[A-Za-z0-9_-]{1,40})*)$/.exec(clean);
  // A badge slug that names nothing falls back to the map rather than the roll
  // page — a stale link should land somewhere related.
  const badge = slug ? showBadge(decodeURIComponent(slug[1])) : null;
  const view = badge ? "badge"
    : slug ? "badges"
    : who ? "profile"
    : gridSub ? "grid"
    : nbNum ? "neighbours"
    : luckWho ? "luck"
    : VIEW_BY_PATH[clean] || "sandbox";
  epEl("view-sandbox").hidden = view !== "sandbox";
  epEl("view-ep").hidden = view !== "ep";
  epEl("view-analysis").hidden = view !== "analysis";
  epEl("view-grid").hidden = view !== "grid";
  epEl("view-neighbours").hidden = view !== "neighbours";
  epEl("view-luck").hidden = view !== "luck";
  epEl("view-badges").hidden = view !== "badges";
  epEl("view-badge").hidden = view !== "badge";
  epEl("view-profiles").hidden = view !== "profiles";
  epEl("view-profile").hidden = view !== "profile";
  epEl("view-other").hidden = view !== "other";
  document.title = badge ? `${badge.label} · RNGdle Sandbox`
    : who ? `${who[1].split(",").join(" + ")} · RNGdle Sandbox`
    : VIEWS[view].title;
  // One badge is still the Badges tab as far as the nav is concerned.
  const tabView = view === "badge" ? "badges" : view === "profile" ? "profiles" : view;
  for (const tab of document.querySelectorAll(".nav-tab")) {
    tab.classList.toggle("is-active", tab.dataset.view === tabView);
  }
  if (view !== "sandbox") {
    finishAnyRoll();              // don't leave a roll animating out of sight
    if (view === "ep") epEl("ep-input").focus();
    // analysis.js loads after this file, so a cold load of /analysis starts
    // itself once that script has run; this covers navigating there later.
    if (view === "analysis" && typeof startAnalysis === "function") startAnalysis();
    // grid.js loads after this file too, and covers its own cold load the same way.
    if (view === "grid" && typeof showGrid === "function") showGrid(gridSub ? decodeURIComponent(gridSub[1]) : "");
    if (view === "neighbours" && typeof showNeighbours === "function") showNeighbours(nbNum ? Number(nbNum[1]) : null);
    if (view === "luck" && typeof showLuck === "function") showLuck(luckWho ? luckWho[1].split(",") : null);
    if (view === "badges") buildBadges(new URLSearchParams(query).get("layout") || layoutHint);
    if (view === "badge") scrollTo(0, 0);
    if (view === "profiles") epEl("profile-input").focus();
    if (view === "profile") { scrollTo(0, 0); showProfile(who[1].split(","), new URLSearchParams(query).get("layout") || layoutHint); }
    // other.js loads after this file, as the others do.
    if (view === "other" && typeof showOther === "function") showOther();
  } else if (num) {
    openNumber(Math.min(Number(num[1]), MAX_N));
  }
}

function navigate(path) {
  if (path !== location.pathname + location.search) history.pushState(null, "", path);
  showView(path);
}

// Route our own links rather than reloading the shell for them. Anything that
// is not a plain left-click on a same-origin link — a new tab, a download, an
// external link, a modified click — is left to the browser.
addEventListener("click", e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest("a");
  if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
  if (WORKER_PATHS.test(a.pathname)) return;
  e.preventDefault();
  navigate(a.pathname + a.search);
});

addEventListener("popstate", () => showView(location.pathname + location.search, history.state?.layout));

// The tabs drop their labels on narrower screens (extra.css), so each carries
// its name as a tooltip.
for (const tab of document.querySelectorAll(".nav-tab")) tab.title = tab.textContent.trim();

// One-time upgrade for a hash URL from before the switch.
const legacy = legacyPath(location.hash);
if (legacy) history.replaceState(null, "", legacy);
showView(location.pathname + location.search);
