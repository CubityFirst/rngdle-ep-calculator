// Analysis — the EP distribution across every number from 0 to 1,000,000,
// filtered by digit length, EP range, rarity tier, and the badges a number
// must or must not earn. Ported from rngdle_solver's "Analyze all scores"
// panel, minus its in-browser sweep: that took 15s on 12 cores and minutes on
// a phone, so here both indexes are precomputed by tools/build-ep-table.js.
//
//   ep-table.bin.gz     EP per number (shared with the EP -> Number tab)
//   badge-table.bin.gz  one bitset per badge — bit n set when n earns it
//
// Everything after the two fetches is a typed-array scan on the main thread:
// a million iterations of a few bit tests and a table lookup is ~15ms, well
// under the 60ms debounce on the controls, so there is no worker to plumb.

const BADGE_TABLE_URL = "/badge-table.bin.gz";
const ROW_BYTES = Math.ceil(TABLE_LEN / 8);          // 125,001 bytes per badge row
const TIER_ORDER_LOW_FIRST = ["trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic"];
const HIST_STEP = 0.25;                              // histogram bucket width, in decades
const PREVIEW_LIMIT = 48;                            // matching numbers shown inline
const EXAMPLES_PER_BADGE = 12;                       // per badge, in the examples export

let badgeBits = null;        // Uint8Array, badge-major bitsets
let badgeLoading = null;
let tierOfN = null;          // Uint8Array, card tier index per number
let lenOfN = null;           // Uint8Array, digit count per number
let tierCut = null;          // exclusive EP ceilings of tiers 0..5; >= last is mythic
let anReady = false;

const anEl = id => document.getElementById(id);
const anNode = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const escHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// 1,234 -> 1.2K, 5,005,875 -> 5.0M, for axis ticks and bucket labels.
const compact = n => {
  n = Math.round(n);
  if (n < 1000) return String(n);
  const u = ["K", "M", "B"]; let i = -1, x = n;
  while (x >= 1000 && i < 2) { x /= 1000; i++; }
  return (x < 10 ? x.toFixed(1) : String(Math.round(x))) + u[i];
};

// Badges in BADGE_DEFINITIONS order — the same order the table's rows are in.
const badgeMeta = BADGES.BADGE_DEFINITIONS.map((b, i) => {
  const info = ENGINE.getBadgeInfo(b.id);
  return { i, id: b.id, label: info.label, emoji: info.emoji || "", score: info.score,
           rarity: RARITY.getRarityTailwind(info.score).label };
});
const badgeByIndex = new Map(badgeMeta.map(b => [b.id, b.i]));
const earns = (n, bi) => (badgeBits[bi * ROW_BYTES + (n >> 3)] >> (n & 7)) & 1;

// The picker groups badges the way the Badges tab does (not `badgeGroups` -
// app.js owns that name, and these classic scripts share one global scope): rngdle's own sets, then
// the sandbox's "No Set" for the rest. A badge in two sets is listed under both.
function badgeSetGroups() {
  const seen = new Set();
  const groups = BADGE_SETS.map(s => {
    const ids = s.badges.filter(id => badgeByIndex.has(id));
    ids.forEach(id => seen.add(id));
    return { name: s.name, icon: s.icon, ids };
  }).filter(g => g.ids.length);
  const rest = badgeMeta.filter(b => !seen.has(b.id)).map(b => b.id);
  if (rest.length) groups.push({ name: UNSORTED_SET.name, icon: UNSORTED_SET.icon, ids: rest });
  return groups;
}

// Tier accents are rngdle's own highlight borders (RARITY_PALETTE), so the
// histogram is painted in the colours the number card wears.
const TIERS = TIER_ORDER_LOW_FIRST.map(key => ({
  key,
  label: RARITY.RARITY_PALETTE[key].pill.label,
  accent: RARITY.RARITY_PALETTE[key].highlight.border,
}));

/* --- loading -------------------------------------------------------------- */
function anStatus(text, busy) {
  const box = anEl("an-status");
  box.hidden = !text;
  box.classList.toggle("is-busy", !!busy);
  anEl("an-status-text").textContent = text || "";
}

async function getBadgeTable() {
  if (badgeBits) return badgeBits;
  if (badgeLoading) return badgeLoading;
  badgeLoading = (async () => {
    const res = await fetch(BADGE_TABLE_URL);
    if (!res.ok) throw new Error(`${BADGE_TABLE_URL}: ${res.status} ${res.statusText}`);
    const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    const want = badgeMeta.length * ROW_BYTES;
    if (buf.byteLength !== want) throw new Error(`${BADGE_TABLE_URL} is ${buf.byteLength} bytes, expected ${want}`);
    badgeBits = new Uint8Array(buf);
    return badgeBits;
  })();
  try { return await badgeLoading; } finally { badgeLoading = null; }
}

// Card tier per number, derived rather than shipped: the cutoffs fall out of
// rngdle's own getCardRarityTier applied to the distinct EP totals, and the
// 1M-element fill is a few milliseconds.
function deriveTiers(t) {
  const tierIndex = Object.fromEntries(TIER_ORDER_LOW_FIRST.map((k, i) => [k, i]));
  tierCut = [];
  let prev = -1;
  for (const ep of distinctTotals()) {
    const ti = tierIndex[RARITY.getCardRarityTier(ep)];
    if (ti !== prev) { if (prev >= 0) tierCut.push(ep); prev = ti; }
  }
  const tierOf = v => { for (let i = 0; i < tierCut.length; i++) if (v < tierCut[i]) return i; return tierCut.length; };
  tierOfN = new Uint8Array(TABLE_LEN);
  lenOfN = new Uint8Array(TABLE_LEN);
  let len = 1, next = 10;
  for (let n = 0; n < TABLE_LEN; n++) {
    if (n === next) { len++; next *= 10; }
    lenOfN[n] = len;
    tierOfN[n] = tierOf(t[n]);
  }
}

// Tier i spans [tierCut[i-1], tierCut[i]) EP; both ends of the scale are open.
function tierRangeText(i) {
  if (i === 0) return `under ${fmt(tierCut[0])} EP`;
  if (i === tierCut.length) return `${fmt(tierCut[i - 1])} EP and up`;
  return `${fmt(tierCut[i - 1])}–${fmt(tierCut[i] - 1)} EP`;
}

let anStarted = false;
async function startAnalysis() {
  if (anStarted) return;
  anStarted = true;
  try {
    anStatus("Loading the EP index…", true);
    const t = await getTable();
    anStatus("Loading the badge index…", true);
    await getBadgeTable();
    deriveTiers(t);
    anReady = true;
    anStatus("");
    anEl("an-controls").hidden = false;
    anEl("an-results").hidden = false;
    buildTierChips();
    runFilter();
  } catch (err) {
    anStarted = false;
    anStatus(`Could not load the indexes: ${err && err.message || err}`);
  }
}

/* --- filter state --------------------------------------------------------- */
const required = new Set();     // badge indices a number must earn
const excluded = new Set();     // badge indices a number must not earn
const offLengths = new Set();   // digit lengths toggled off
const offTiers = new Set();     // tier indices toggled off

function epBounds() {
  const p = id => { const v = parseFloat(anEl(id).value.replace(/[^0-9.]/g, "")); return Number.isFinite(v) && v >= 0 ? v : null; };
  return { min: p("an-ep-min"), max: p("an-ep-max"), eq: p("an-ep-eq") };
}

// One pass over the table with every filter applied. `visit(n, ep, tier)` is
// called for each number passing the length, EP and badge filters, before the
// tier filter — the rarity breakdown is a facet count, so it sees every tier.
function scan(visit) {
  const t = table, ep = epBounds();
  const req = [...required], exc = [...excluded];
  const epMin = ep.min == null ? -Infinity : ep.min;
  const epMax = ep.max == null ? Infinity : ep.max;
  const epEq = ep.eq;
  let lenMask = 0xFE;
  for (const L of offLengths) lenMask &= ~(1 << L);
  outer: for (let n = 0; n < TABLE_LEN; n++) {
    if (!(lenMask & (1 << lenOfN[n]))) continue;
    const v = t[n];
    if (epEq != null ? v !== epEq : (v <= epMin || v >= epMax)) continue;
    for (let j = 0; j < req.length; j++) if (!earns(n, req[j])) continue outer;
    for (let j = 0; j < exc.length; j++) if (earns(n, exc[j])) continue outer;
    visit(n, v, tierOfN[n]);
  }
}

let filterTimer = null;
function scheduleFilter() { if (!anReady) return; clearTimeout(filterTimer); filterTimer = setTimeout(runFilter, 60); }

function runFilter() {
  if (!anReady) return;
  const NT = TIERS.length;
  const maxBucket = 2 + Math.ceil(Math.log10(Math.max(10, distinctTotals().at(-1))) / HIST_STEP);
  const counts = new Float64Array(maxBucket * NT);
  const tierAll = new Float64Array(NT), tierSum = new Float64Array(NT);
  const tierMin = new Float64Array(NT).fill(Infinity), tierMax = new Float64Array(NT);
  let total = 0, sum = 0, mn = Infinity, mx = 0, domain = 0;
  const preview = [];
  scan((n, v, t) => {
    domain++;
    tierAll[t]++; tierSum[t] += v;
    if (v < tierMin[t]) tierMin[t] = v;
    if (v > tierMax[t]) tierMax[t] = v;
    if (offTiers.has(t)) return;
    total++; sum += v; if (v < mn) mn = v; if (v > mx) mx = v;
    let b = v <= 0 ? 0 : 1 + Math.floor(Math.log10(v) / HIST_STEP);
    if (b >= maxBucket) b = maxBucket - 1;
    counts[b * NT + t]++;
    if (preview.length < PREVIEW_LIMIT) preview.push(n);
  });
  const buckets = [];
  for (let i = 0; i < maxBucket; i++) {
    const byTier = Array.from(counts.subarray(i * NT, i * NT + NT));
    buckets.push({ i, lo: i === 0 ? 0 : 10 ** ((i - 1) * HIST_STEP), hi: i === 0 ? 0 : 10 ** (i * HIST_STEP),
                   count: byTier.reduce((a, b) => a + b, 0), byTier });
  }
  const tiers = TIERS.map((_, t) => ({ tier: t, count: tierAll[t], share: domain ? tierAll[t] / domain : 0,
    mean: tierAll[t] ? tierSum[t] / tierAll[t] : 0, min: tierAll[t] ? tierMin[t] : 0, max: tierMax[t] }));
  renderStats({ total, mean: total ? sum / total : 0, min: total ? mn : 0, max: mx });
  renderChart(buckets, total);
  renderTiers(tiers, domain);
  renderPreview(preview, total);
  renderSummary(total);
}

/* --- controls ------------------------------------------------------------- */
function buildLengthTiles() {
  const wrap = anEl("an-lengths");
  for (let L = 1; L <= 7; L++) {
    const b = anNode(`<button type="button" class="an-len is-on font-roll" aria-pressed="true" data-len="${L}">${L}</button>`);
    b.title = L === 7 ? "7 digits — only 1,000,000" : `${L} digit${L === 1 ? "" : "s"}`;
    wrap.appendChild(b);
  }
  wrap.addEventListener("click", e => {
    const b = e.target.closest(".an-len");
    if (!b) return;
    const L = Number(b.dataset.len);
    if (offLengths.has(L)) offLengths.delete(L); else offLengths.add(L);
    if (offLengths.size === 7) offLengths.clear();          // never filter everything away
    syncLengthTiles();
    scheduleFilter();
  });
}
function syncLengthTiles() {
  for (const t of anEl("an-lengths").children) {
    const on = !offLengths.has(Number(t.dataset.len));
    t.classList.toggle("is-on", on);
    t.setAttribute("aria-pressed", String(on));
  }
}

function buildTierChips() {
  const wrap = anEl("an-tiers");
  wrap.replaceChildren();
  TIERS.forEach((t, i) => {
    const b = anNode(`<button type="button" class="an-tier is-on type-label" aria-pressed="true" data-tier="${i}">${t.label}</button>`);
    b.style.setProperty("--tc", t.accent);
    b.title = `${t.label} · ${tierRangeText(i)}`;
    wrap.appendChild(b);
  });
}
function toggleTier(i, isolate) {
  if (isolate) { offTiers.clear(); TIERS.forEach((_, j) => { if (j !== i) offTiers.add(j); }); }
  else if (offTiers.has(i)) offTiers.delete(i);
  else offTiers.add(i);
  if (offTiers.size === TIERS.length) offTiers.clear();
  syncTierChips();
  scheduleFilter();
}
function syncTierChips() {
  for (const b of anEl("an-tiers").children) {
    const on = !offTiers.has(Number(b.dataset.tier));
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}

// Each badge is tri-state — neutral, required (✓) or excluded (✕) — and the
// two are exclusive, so turning one on clears the other. A set's own button
// excludes every badge in it at once; a matching "require all" is left out,
// since almost no number can earn a whole set.
function buildBadgeList() {
  const list = anEl("an-badge-list");
  const filter = anEl("an-badge-search").value.trim().toLowerCase();
  list.replaceChildren();
  for (const g of badgeSetGroups()) {
    const ids = g.ids.filter(id => {
      if (!filter) return true;
      const b = badgeMeta[badgeByIndex.get(id)];
      return b.label.toLowerCase().includes(filter) || b.rarity.toLowerCase().includes(filter) || g.name.toLowerCase().includes(filter);
    });
    if (!ids.length) continue;
    const allOff = ids.every(id => excluded.has(badgeByIndex.get(id)));
    const group = anNode(`
      <div class="an-group">
        <div class="an-group-head">
          <span class="an-group-name type-ui"><span>${g.icon}</span> <span></span></span>
          <button type="button" class="an-group-x type-meta ${allOff ? "is-on" : ""}" data-set="${escHtml(g.name)}"
                  title="${allOff ? "Stop excluding this set" : "Exclude every badge in this set"}">${allOff ? "set excluded" : "exclude set"}</button>
        </div>
        <div class="an-group-rows"></div>
      </div>`);
    group.querySelector(".an-group-name span:last-child").textContent = g.name;
    const rows = group.lastElementChild;
    for (const id of ids) {
      const b = badgeMeta[badgeByIndex.get(id)];
      const row = anNode(`
        <div class="an-badge">
          <span class="an-tri" data-bi="${b.i}">
            <button type="button" data-act="do" class="${required.has(b.i) ? "is-on" : ""}" title="Require this badge" aria-pressed="${required.has(b.i)}">✓</button>
            <button type="button" data-act="dont" class="${excluded.has(b.i) ? "is-on" : ""}" title="Exclude this badge" aria-pressed="${excluded.has(b.i)}">✕</button>
          </span>
          <span class="an-badge-name type-ui"><span>${b.emoji}</span> <span></span></span>
          <em class="type-meta">${escHtml(b.rarity)}</em>
        </div>`);
      row.querySelector(".an-badge-name span:last-child").textContent = b.label;
      rows.appendChild(row);
    }
    list.appendChild(group);
  }
  if (!list.children.length) list.appendChild(anNode(`<p class="type-meta text-prose-3 normal-case px-1 py-2">No badge matches that.</p>`));
}

function setBadge(i, state) {
  required.delete(i); excluded.delete(i);
  if (state === "do") required.add(i);
  if (state === "dont") excluded.add(i);
}
function afterBadgeChange() { buildBadgeList(); renderSelected(); scheduleFilter(); }

function renderSelected() {
  const box = anEl("an-badge-sel");
  box.replaceChildren();
  const chips = (set, kind) => {
    const wrap = anNode(`<div class="an-sel-row"><span class="type-meta text-prose-3 normal-case"></span></div>`);
    wrap.firstElementChild.textContent = kind === "do" ? "Must earn:" : "Must not earn:";
    for (const i of set) {
      const b = badgeMeta[i];
      const chip = anNode(`<button type="button" class="an-chip an-chip-${kind} type-meta" data-bi="${i}" title="Remove"><span></span> ×</button>`);
      chip.firstElementChild.textContent = `${b.emoji} ${b.label}`;
      wrap.appendChild(chip);
    }
    return wrap;
  };
  if (required.size) box.appendChild(chips(required, "do"));
  if (excluded.size) box.appendChild(chips(excluded, "dont"));
  box.hidden = !required.size && !excluded.size;
}

function wireControls() {
  buildLengthTiles();
  buildBadgeList();

  anEl("an-badge-search").addEventListener("input", buildBadgeList);
  anEl("an-badge-list").addEventListener("click", e => {
    const setBtn = e.target.closest(".an-group-x");
    if (setBtn) {
      const g = badgeSetGroups().find(g => g.name === setBtn.dataset.set);
      if (!g) return;
      const idx = g.ids.map(id => badgeByIndex.get(id));
      const allOff = idx.every(i => excluded.has(i));
      for (const i of idx) setBadge(i, allOff ? null : "dont");
      afterBadgeChange();
      return;
    }
    const btn = e.target.closest(".an-tri button");
    if (!btn) return;
    const i = Number(btn.parentElement.dataset.bi);
    const act = btn.dataset.act;
    const on = act === "do" ? required.has(i) : excluded.has(i);
    setBadge(i, on ? null : act);
    afterBadgeChange();
  });
  anEl("an-badge-sel").addEventListener("click", e => {
    const chip = e.target.closest(".an-chip");
    if (!chip) return;
    setBadge(Number(chip.dataset.bi), null);
    afterBadgeChange();
  });
  anEl("an-clear").addEventListener("click", () => {
    required.clear(); excluded.clear(); offLengths.clear(); offTiers.clear();
    for (const id of ["an-ep-min", "an-ep-max", "an-ep-eq"]) anEl(id).value = "";
    anEl("an-ep-min").disabled = anEl("an-ep-max").disabled = false;
    syncLengthTiles();
    syncTierChips();
    afterBadgeChange();
  });

  // Digits only, shown with thousands separators like the EP tab's input.
  for (const id of ["an-ep-min", "an-ep-max", "an-ep-eq"]) {
    anEl(id).addEventListener("input", e => {
      const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 12);
      e.target.value = digits ? fmt(Number(digits)) : "";
      if (id === "an-ep-eq") anEl("an-ep-min").disabled = anEl("an-ep-max").disabled = !!digits;
      scheduleFilter();
    });
  }

  anEl("an-tiers").addEventListener("click", e => {
    const b = e.target.closest(".an-tier");
    if (b) toggleTier(Number(b.dataset.tier), e.shiftKey);
  });
  anEl("an-tier-breakdown").addEventListener("click", e => {
    const row = e.target.closest(".an-tb-row");
    if (row) toggleTier(Number(row.dataset.tier), e.shiftKey);
  });
  anEl("an-tier-breakdown").addEventListener("keydown", e => {
    const row = e.target.closest(".an-tb-row");
    if (!row || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    toggleTier(Number(row.dataset.tier), e.shiftKey);
  });

  anEl("an-export-csv").addEventListener("click", exportCsv);
  anEl("an-export-examples").addEventListener("click", exportExamples);
  anEl("an-copy").addEventListener("click", copyMatches);
}

/* --- results -------------------------------------------------------------- */
function renderStats(s) {
  const set = (id, v) => { anEl(id).textContent = v; };
  set("an-stat-total", fmt(s.total));
  set("an-stat-mean", s.total ? fmt(Math.round(s.mean)) : "—");
  set("an-stat-min", s.total ? fmt(s.min) : "—");
  set("an-stat-max", s.total ? fmt(s.max) : "—");
}

function renderSummary(total) {
  const parts = [];
  if (offLengths.size) {
    const on = [1, 2, 3, 4, 5, 6, 7].filter(L => !offLengths.has(L));
    parts.push(on.length === 1 ? `${on[0]}-digit numbers` : `${on.join(", ")}-digit numbers`);
  } else parts.push("every number from 0 to 1,000,000");
  const ep = epBounds();
  if (ep.eq != null) parts.push(`scoring exactly ${fmt(ep.eq)} EP`);
  else if (ep.min != null && ep.max != null) parts.push(`scoring between ${fmt(ep.min)} and ${fmt(ep.max)} EP`);
  else if (ep.min != null) parts.push(`scoring more than ${fmt(ep.min)} EP`);
  else if (ep.max != null) parts.push(`scoring less than ${fmt(ep.max)} EP`);
  if (required.size) parts.push(`earning ${[...required].map(i => badgeMeta[i].label).join(" + ")}`);
  if (excluded.size) parts.push(`not earning ${[...excluded].map(i => badgeMeta[i].label).join(", ")}`);
  if (offTiers.size) parts.push(`in ${TIERS.filter((_, i) => !offTiers.has(i)).map(t => t.label.toLowerCase()).join(" / ")}`);
  anEl("an-summary").textContent = `${fmt(total)} match: ${parts.join(", ")}.`;
}

// Log/log histogram of total EP, each bar stacked by card tier. Bar height is
// the bucket's count on a log scale; the segments split that height by share,
// so a segment shows composition rather than an absolute count — the tooltip
// carries the exact figures. Both scales are log because EP totals span seven
// decades and the counts span six.
function renderChart(buckets, total) {
  const chart = anEl("an-chart");
  if (!total) {
    chart.replaceChildren(anNode(`<p class="type-ui text-prose-3 normal-case text-center py-10">No numbers match these filters.</p>`));
    return;
  }
  let first = -1, last = 0;
  buckets.forEach((b, i) => { if (b.count > 0) { if (first < 0) first = i; last = i; } });
  const bs = buckets.slice(Math.max(first, 0), last + 1);
  const maxCount = Math.max(...bs.map(b => b.count));
  const W = 720, H = 300, padL = 44, padR = 10, padT = 10, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const nb = bs.length, slot = plotW / nb;
  const bw = Math.min(24, Math.max(3, slot - 3));           // thin marks, air in the slot
  const logTop = Math.log10(maxCount) + 1;
  const yOf = c => c > 0 ? padT + plotH - ((Math.log10(c) + 1) / logTop) * plotH : padT + plotH;
  const GAP = 2;                                              // surface gap between segments

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="EP distribution histogram, stacked by rarity tier">`;
  for (let p = 1; p <= maxCount; p *= 10) {
    const y = yOf(p).toFixed(1);
    svg += `<line class="an-grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`;
    svg += `<text class="an-tick" x="${padL - 6}" y="${(Number(y) + 3).toFixed(1)}" text-anchor="end">${compact(p)}</text>`;
  }
  svg += `<line class="an-axis" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"/>`;
  const tickEvery = Math.ceil(nb / 12);
  bs.forEach((b, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    const y = yOf(b.count), h = padT + plotH - y;
    let parts = "", off = 0;
    const segs = b.byTier.map((c, t) => [c, t]).filter(([c]) => c > 0);
    segs.forEach(([c, t], si) => {
      const segH = h * (c / b.count);
      const top = padT + plotH - off - segH;
      const isTop = si === segs.length - 1;
      const gap = isTop ? 0 : GAP;                            // gap above every segment but the last
      const drawH = Math.max(0, segH - gap);
      parts += isTop
        ? `<path fill="${TIERS[t].accent}" d="${roundedTop(x, top, bw, drawH, Math.min(4, bw / 2, drawH))}"/>`
        : `<rect fill="${TIERS[t].accent}" x="${x.toFixed(1)}" y="${(top + gap).toFixed(1)}" width="${bw.toFixed(1)}" height="${drawH.toFixed(1)}"/>`;
      off += segH;
    });
    const label = b.i === 0 ? "0 EP" : `${compact(b.lo)}–${compact(b.hi)} EP`;
    const pct = b.count / total * 100;
    const mix = segs.slice().reverse().map(([c, t]) => `${TIERS[t].label} ${fmt(c)}`).join(" · ");
    svg += `<g class="an-bar" data-tip="${escHtml(`${label}\n${fmt(b.count)} numbers (${pct.toFixed(pct < 1 ? 2 : 1)}%)\n${mix}`)}">` +
      `<rect class="an-hit" x="${(padL + i * slot).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${plotH}"/>${parts}</g>`;
    if (i % tickEvery === 0) {
      const lx = (padL + i * slot + slot / 2).toFixed(1), ly = padT + plotH + 14;
      svg += `<text class="an-tick" x="${lx}" y="${ly}" text-anchor="middle">${b.i === 0 ? "0" : compact(b.lo)}</text>`;
    }
  });
  svg += `<text class="an-tick" x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle">total EP (log scale) · bar height = numbers (log scale)</text></svg>`;
  chart.innerHTML = svg;
  chart.appendChild(anNode(`<div class="an-tip type-meta normal-case" hidden></div>`));
}

// A bar with the top two corners rounded and a square baseline end.
function roundedTop(x, y, w, h, r) {
  if (h <= 0) return "";
  r = Math.max(0, Math.min(r, h, w / 2));
  const f = v => v.toFixed(1);
  return `M${f(x)},${f(y + h)} V${f(y + r)} Q${f(x)},${f(y)} ${f(x + r)},${f(y)} H${f(x + w - r)} Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)} V${f(y + h)} Z`;
}

// One tooltip element, positioned by the pointer; the bar's text lives in a
// data attribute so the SVG stays free of hidden markup.
function wireChartTooltip() {
  const chart = anEl("an-chart");
  const clearHover = except => chart.querySelectorAll(".an-bar.is-hover").forEach(b => { if (b !== except) b.classList.remove("is-hover"); });
  chart.addEventListener("pointermove", e => {
    const tip = chart.querySelector(".an-tip");
    if (!tip) return;
    const bar = e.target.closest && e.target.closest(".an-bar");
    if (!bar) { tip.hidden = true; clearHover(null); return; }
    clearHover(bar);
    bar.classList.add("is-hover");
    tip.textContent = bar.dataset.tip;
    tip.hidden = false;
    const r = chart.getBoundingClientRect();
    const x = Math.min(e.clientX - r.left + 12, r.width - tip.offsetWidth - 4);
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, e.clientY - r.top - tip.offsetHeight - 10)}px`;
  });
  chart.addEventListener("pointerleave", () => {
    const tip = chart.querySelector(".an-tip");
    if (tip) tip.hidden = true;
    clearHover(null);
  });
}

// Largest-remainder apportionment into hundredths of a percent, so the shares
// shown sum to exactly 100.00% (rounding each on its own overshoots).
function apportion(tiers, domain) {
  const units = tiers.map(() => 0), rem = tiers.map(() => -1);
  if (!domain) return units;
  let used = 0;
  for (const t of tiers) {
    if (!t.count) continue;
    const exact = t.count / domain * 10000;
    units[t.tier] = Math.floor(exact); rem[t.tier] = exact - units[t.tier]; used += units[t.tier];
  }
  const order = rem.map((_, i) => i).filter(i => rem[i] >= 0).sort((a, b) => rem[b] - rem[a] || a - b);
  for (let k = 0, left = 10000 - used; k < left && order.length; k++) units[order[k % order.length]]++;
  return units;
}

// Rarity breakdown: the rows double as the legend and as tier toggles. Counts
// cover everything passing the other filters, whether or not the tier is shown.
function renderTiers(tiers, domain) {
  const out = anEl("an-tier-breakdown");
  const units = apportion(tiers, domain);
  const pct = t => !t.count ? "—" : units[t.tier] ? `${(units[t.tier] / 100).toFixed(2)}%` : "<0.01%";
  out.replaceChildren();
  const bar = anNode(`<div class="an-tb-bar"></div>`);
  for (const t of [...tiers].reverse()) {
    if (!t.count) continue;
    const seg = anNode(`<i></i>`);
    seg.style.width = `${(t.share * 100).toFixed(4)}%`;
    seg.style.background = TIERS[t.tier].accent;
    seg.title = `${TIERS[t.tier].label}: ${fmt(t.count)} (${pct(t)})`;
    bar.appendChild(seg);
  }
  out.appendChild(anNode(`<div class="an-tb-head"><span class="type-label text-prose-3">Rarity breakdown</span><span class="type-meta text-prose-3 normal-case">${fmt(domain)} numbers pass the other filters</span></div>`));
  out.appendChild(bar);
  const rows = anNode(`<div class="an-tb-rows"></div>`);
  for (const t of [...tiers].reverse()) {
    const T = TIERS[t.tier], on = !offTiers.has(t.tier);
    const row = anNode(`
      <div class="an-tb-row ${on ? "" : "is-off"} ${t.count ? "" : "is-empty"}" data-tier="${t.tier}" role="button" tabindex="0" aria-pressed="${on}">
        <span class="an-tb-sw"></span>
        <span class="an-tb-name type-label">${T.label}</span>
        <span class="an-tb-n type-data">${fmt(t.count)}</span>
        <span class="an-tb-p type-data">${pct(t)}</span>
        <span class="an-tb-track"><i></i></span>
        <span class="an-tb-ep type-meta normal-case">${t.count ? `mean ${fmt(Math.round(t.mean))} EP` : "—"}</span>
      </div>`);
    row.querySelector(".an-tb-sw").style.background = T.accent;
    const fill = row.querySelector(".an-tb-track i");
    fill.style.width = `${(t.share * 100).toFixed(4)}%`; fill.style.background = T.accent;
    row.title = `${T.label} · ${tierRangeText(t.tier)}` +
      (t.count ? `\nmatching: ${fmt(t.min)}–${fmt(t.max)} EP` : "\nno matching numbers") +
      (on ? "" : "\n(hidden from the chart, preview and exports)");
    rows.appendChild(row);
  }
  out.appendChild(rows);
  out.appendChild(anNode(`<p class="type-meta text-prose-3 normal-case mt-2">Click a tier to hide or show it; shift-click to show only that tier.</p>`));
}

function renderPreview(numbers, total) {
  const grid = anEl("an-preview");
  grid.replaceChildren();
  for (const n of numbers) {
    const pill = RARITY.RARITY_PALETTE[TIERS[tierOfN[n]].key].pill;
    grid.appendChild(anNode(`<a href="/n/${n}" title="Open ${fmt(n)} in the sandbox · ${fmt(table[n])} EP" class="font-roll tabular-nums text-sm px-2 py-1 rounded-sm border transition-opacity hover:opacity-70 ${pill.bgClass} ${pill.textClass} ${pill.borderClass}">${n}</a>`));
  }
  anEl("an-preview-note").textContent = total > numbers.length
    ? `The first ${fmt(numbers.length)} of ${fmt(total)}, lowest first.` : total ? "Every match, lowest first." : "";
  anEl("an-copy").disabled = anEl("an-export-csv").disabled = !total;
}

/* --- exports -------------------------------------------------------------- */
function download(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function matchingRows() {
  const rows = [];
  scan((n, v, t) => { if (!offTiers.has(t)) rows.push([n, v, TIERS[t].key]); });
  return rows;
}

function exportCsv() {
  const rows = matchingRows();
  const slug = [...required].map(i => badgeMeta[i].label).concat([...excluded].map(i => `no-${badgeMeta[i].label}`))
    .join("+").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const head = `# ${anEl("an-summary").textContent}\nnumber,totalEP,rarity`;
  download(`rngdle-${slug || "numbers"}.csv`, head + "\n" + rows.map(r => r.join(",")).join("\n"), "text/csv");
}

async function copyMatches() {
  const btn = anEl("an-copy");
  const rows = matchingRows().map(r => r[0]);
  try { await navigator.clipboard.writeText(rows.join("\n")); btn.textContent = `Copied ${fmt(rows.length)}`; }
  catch { btn.textContent = "Copy failed"; }
  setTimeout(() => { btn.textContent = "Copy all"; }, 1500);
}

// The first few numbers that earn each badge, read straight off its bitset row.
// Whole zero bytes are skipped, so even the rarest badge is a quick scan.
function exportExamples() {
  const lines = ["# RNGdle — example numbers for each badge",
    `# Columns: number, totalEP   (up to ${EXAMPLES_PER_BADGE} examples per badge, lowest first)`,
    "# Drawn from every number 0..1,000,000", ""];
  for (const b of badgeMeta) {
    const base = b.i * ROW_BYTES, found = [];
    for (let byte = 0; byte < ROW_BYTES && found.length < EXAMPLES_PER_BADGE; byte++) {
      const v = badgeBits[base + byte];
      if (!v) continue;
      for (let bit = 0; bit < 8 && found.length < EXAMPLES_PER_BADGE; bit++) if (v & (1 << bit)) found.push(byte * 8 + bit);
    }
    lines.push(`== ${b.emoji} ${b.label} (${b.rarity}) ==`);
    if (!found.length) lines.push("  (no number earns this)");
    for (const n of found) lines.push(`  ${String(n).padEnd(8)} ${fmt(table[n])} EP`);
    lines.push("");
  }
  download("rngdle-badge-examples.txt", lines.join("\n"), "text/plain");
}

/* --- entry ---------------------------------------------------------------- */
wireControls();
wireChartTooltip();
// showView (ep.js) calls startAnalysis() when the tab is opened; the indexes
// are only fetched then, so the other tabs pay nothing for this one. ep.js has
// already routed by the time this file runs, so a cold load of /analysis has
// to start itself.
if (!anEl("view-analysis").hidden) startAnalysis();
