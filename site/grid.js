// Grid — every number from 0 to 999,999 as one pixel on a 1000×1000 map: the
// low three digits run left to right, the high three top to bottom, so n sits
// at (n % 1000, floor(n / 1000)). The default view shades each pixel by how
// many badges the number earns; Total EP shades by score on a log scale;
// Rarity paints each number's card tier; and picking a badge lights up every
// number that earns it, with the ones a higher family member supersedes
// optionally knocked back. Zoom and pan, hover for the number, click to open
// it in the sandbox.
//
// Ported from rngdle_solver's /grid, minus its in-browser sweep: the solver
// scores all million numbers in a Web Worker and caches the result in
// IndexedDB — the same cost the Analysis tab already avoided. Here everything
// is read off the two precomputed indexes, the EP table and the per-badge
// bitsets, so the only work on open is summing the bitsets into a badge count
// per number: ~29M byte reads, done in slices between frames so the status
// line can keep up. The solver's "extend to 10,000,000" mode has no table to
// read from and is not here.

const GRID_W = 1000, GRID_H = 1000, GRID_N = GRID_W * GRID_H;   // 1,000,000 itself has no pixel
const GRID_MAX_SCALE = 80;
// Perceptually uniform colour scales, as the solver ships them: grayscale by
// default, then matplotlib's viridis family (anchor stops, evenly spaced).
const GRID_CMAPS = {
  Grayscale: [[0, 0, 0], [255, 255, 255]],
  Viridis: [[68, 1, 84], [72, 40, 120], [62, 73, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37]],
  Magma: [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]],
  Inferno: [[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164]],
  Plasma: [[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33]],
  Cividis: [[0, 32, 76], [0, 42, 102], [45, 63, 112], [76, 85, 107], [108, 110, 107], [142, 136, 96], [179, 164, 77], [219, 194, 55], [255, 233, 69]],
};
// The grid's own sub-paths; a badge slug can never be one of these
// (tools/check.js pins it).
const GRID_FIXED_VIEWS = ["count", "ep", "rarity"];

// Badges per number for 0..999,999, summed over every bitset row. ~29M byte
// reads, but ~70ms in one synchronous pass — and in one pass on purpose:
// sliced across setTimeouts it took 13s in a background tab, where Chrome
// lets a timer fire once a second. Built once; the Neighbours tab reads it too.
let badgeCountTable = null;
function badgeCounts() {
  if (badgeCountTable) return badgeCountTable;
  const c = new Uint8Array(GRID_N), NB = badgeMeta.length, bytes = GRID_N >> 3;
  for (let i = 0; i < NB; i++) {
    const base = i * ROW_BYTES;
    for (let k = 0; k < bytes; k++) {
      const v = badgeBits[base + k];
      if (!v) continue;
      const n0 = k << 3;
      if (v & 1) c[n0]++; if (v & 2) c[n0 + 1]++; if (v & 4) c[n0 + 2]++; if (v & 8) c[n0 + 3]++;
      if (v & 16) c[n0 + 4]++; if (v & 32) c[n0 + 5]++; if (v & 64) c[n0 + 6]++; if (v & 128) c[n0 + 7]++;
    }
  }
  return (badgeCountTable = c);
}

const GRID = (() => {
  const $ = id => document.getElementById(id);
  const wrap = $("grid-map"), cv = $("grid-canvas"), ctx = cv.getContext("2d");
  const tip = $("grid-tip"), toast = $("grid-toast");
  const listEl = $("grid-list"), searchEl = $("grid-search"), viewsEl = $("grid-views");
  const titleEl = $("grid-title"), legendEl = $("grid-legend"), cmapSel = $("grid-cmap");
  const supBtn = $("grid-sup"), supModeEl = $("grid-supmode");

  let ready = false, started = false, pending = "";
  let counts = null, cmin = 0, cmax = 1, emin = 0, emax = 1;
  let doms = null;               // per badge row: the rows in its family that outrank it
  let tierRGB = null;            // [r, g, b] per card tier, in TIERS order
  let view = "count";            // "count" | "ep" | "rarity" | a badge row index
  let src = null;                // the 1000×1000 canvas being shown
  let member = null, sup = null; // the badge view's membership and superseded masks
  let supHide = false, supStyle = "grey";
  let cmapName = "Grayscale";
  let scale = 1, ox = 0, oy = 0, minScale = 1, cw = 0, ch = 0, dpr = 1;
  let toastTimer = 0;

  const flash = msg => {
    toast.textContent = msg; toast.classList.add("is-on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("is-on"), 1800);
  };
  const fmtPct = p => (p < 1 ? p.toFixed(3) : p.toFixed(2)) + "%";
  const isBadge = () => typeof view === "number";

  /* --- colour --------------------------------------------------------------- */
  function cmap(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const s = GRID_CMAPS[cmapName], n = s.length - 1, x = t * n, i = Math.floor(x), f = x - i;
    if (i >= n) return s[n];
    const a = s[i], b = s[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function lut() {
    const L = new Uint8ClampedArray(768);
    for (let i = 0; i < 256; i++) { const c = cmap(i / 255), q = i * 3; L[q] = c[0]; L[q + 1] = c[1]; L[q + 2] = c[2]; }
    return L;
  }
  const rgbStr = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  function cmapCSS() {
    const s = GRID_CMAPS[cmapName], n = s.length - 1;
    return s.map((c, i) => `${rgbStr(c)} ${Math.round(i / n * 100)}%`).join(",");
  }
  // Any CSS colour to [r, g, b], by painting it: the tier accents are whatever
  // rngdle's palette says — hex or oklch — and the canvas resolves either.
  function rgbOf(css) {
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const x = c.getContext("2d"); x.fillStyle = css; x.fillRect(0, 0, 1, 1);
    return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }

  /* --- painting the 1000×1000 source ---------------------------------------- */
  function painted(fill) {
    const c = document.createElement("canvas"); c.width = GRID_W; c.height = GRID_H;
    const x = c.getContext("2d"), img = x.createImageData(GRID_W, GRID_H);
    fill(img.data);
    x.putImageData(img, 0, 0);
    return c;
  }
  function paintCount() {
    const L = lut(), span = (cmax - cmin) || 1;
    return painted(d => {
      for (let i = 0; i < GRID_N; i++) {
        const q = (((counts[i] - cmin) / span * 255 + .5) | 0) * 3, p = i << 2;
        d[p] = L[q]; d[p + 1] = L[q + 1]; d[p + 2] = L[q + 2]; d[p + 3] = 255;
      }
    });
  }
  // EP spans seven decades, so the EP map is log-scaled.
  function paintEP() {
    const L = lut(), lo = Math.log(emin + 1), span = (Math.log(emax + 1) - lo) || 1;
    return painted(d => {
      for (let i = 0; i < GRID_N; i++) {
        const q = (((Math.log(table[i] + 1) - lo) / span * 255 + .5) | 0) * 3, p = i << 2;
        d[p] = L[q]; d[p + 1] = L[q + 1]; d[p + 2] = L[q + 2]; d[p + 3] = 255;
      }
    });
  }
  function paintRarity() {
    return painted(d => {
      for (let i = 0; i < GRID_N; i++) {
        const c = tierRGB[tierOfN[i]], p = i << 2;
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
      }
    });
  }
  // Members take the colour scale's hot end, non-members its dark end.
  // Superseded members ("Hide superseded" on): grey knocks them back to 30% of
  // the way up the scale; black paints them like non-members.
  function paintMember(m, s) {
    const hi = cmap(1), lo = cmap(0), f = supStyle === "black" ? 0 : .3;
    const hr = hi[0] | 0, hg = hi[1] | 0, hb = hi[2] | 0, lr = lo[0] | 0, lg = lo[1] | 0, lb = lo[2] | 0;
    const dr = (lr + (hr - lr) * f) | 0, dg = (lg + (hg - lg) * f) | 0, db = (lb + (hb - lb) * f) | 0;
    return painted(d => {
      for (let i = 0; i < GRID_N; i++) {
        const p = i << 2;
        if (!m[i]) { d[p] = lr; d[p + 1] = lg; d[p + 2] = lb; }
        else if (s && s[i]) { d[p] = dr; d[p + 1] = dg; d[p + 2] = db; }
        else { d[p] = hr; d[p + 1] = hg; d[p + 2] = hb; }
        d[p + 3] = 255;
      }
    });
  }

  /* --- reading the indexes ---------------------------------------------------- */
  // Which numbers earn badge row `bi`, straight off its bitset. Whole zero bytes
  // are skipped, so a sparse badge is a quick scan.
  function membershipOf(bi) {
    const m = new Uint8Array(GRID_N), base = bi * ROW_BYTES, bytes = GRID_N >> 3;
    for (let k = 0; k < bytes; k++) {
      const v = badgeBits[base + k];
      if (!v) continue;
      const n0 = k << 3;
      for (let b = 0; b < 8; b++) if (v & (1 << b)) m[n0 + b] = 1;
    }
    return m;
  }
  // Members where a family member that outranks `bi` is also earned, so `bi`
  // shows on the card but scores 0. Null when nothing outranks it.
  function supersededOf(bi, m) {
    const ds = doms[bi];
    if (!ds.length) return null;
    const s = new Uint8Array(GRID_N);
    for (let n = 0; n < GRID_N; n++) {
      if (!m[n]) continue;
      for (let k = 0; k < ds.length; k++) if (earns(n, ds[k])) { s[n] = 1; break; }
    }
    return s;
  }
  // Within a family only the highest-EP badge earned scores; on a tie the one
  // defined first wins (Eon over Semi-Eon and Deep Void (5) at 100,000).
  function dominators() {
    const fam = new Map();
    BADGES.BADGE_DEFINITIONS.forEach((d, i) => {
      if (!d.family) return;
      if (!fam.has(d.family)) fam.set(d.family, []);
      fam.get(d.family).push(i);
    });
    const out = badgeMeta.map(() => []);
    for (const idxs of fam.values()) {
      for (const a of idxs) for (const b of idxs) {
        if (b === a) continue;
        const sa = badgeMeta[a].score, sb = badgeMeta[b].score;
        if (sb > sa || (sb === sa && b < a)) out[a].push(b);
      }
    }
    return out;
  }
  /* --- the viewport ----------------------------------------------------------- */
  function resize() {
    dpr = window.devicePixelRatio || 1;
    cw = wrap.clientWidth; ch = wrap.clientHeight;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  }
  function fit() {
    minScale = Math.min(cw / GRID_W, ch / GRID_H);
    scale = minScale;
    ox = (cw - GRID_W * scale) / 2;
    oy = (ch - GRID_H * scale) / 2;
  }
  // The map can be dragged until an edge reaches the viewport's centre, not
  // just its edge, so a corner is easy to reach when zoomed in.
  function clampPan() {
    const w = GRID_W * scale, h = GRID_H * scale;
    ox = w <= cw ? (cw - w) / 2 : Math.min(cw / 2, Math.max(cw / 2 - w, ox));
    oy = h <= ch ? (ch - h) / 2 : Math.min(ch / 2, Math.max(ch / 2 - h, oy));
  }
  function render() {
    if (!src || !cw) return;
    clampPan();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cw, ch);           // the card's own surface shows around the map
    ctx.drawImage(src, ox, oy, GRID_W * scale, GRID_H * scale);
  }
  function numberAt(mx, my) {
    const sx = Math.floor((mx - ox) / scale), sy = Math.floor((my - oy) / scale);
    if (sx < 0 || sy < 0 || sx >= GRID_W || sy >= GRID_H) return null;
    return sy * GRID_W + sx;
  }
  function zoomAt(mx, my, factor) {
    const ns = Math.min(GRID_MAX_SCALE, Math.max(minScale, scale * factor));
    if (ns === scale) return;
    ox = mx - (mx - ox) * (ns / scale);
    oy = my - (my - oy) * (ns / scale);
    scale = ns; render();
  }
  const rel = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // Fires when the tab is first shown (display:none gives the wrap no size) and
  // on every window resize after; a fitted map refits, a zoomed one keeps its place.
  function onResize() {
    if (!wrap.clientWidth) return;
    const wasFit = scale <= minScale + 1e-6;
    resize();
    if (wasFit) fit();
    render();
  }

  /* --- views ------------------------------------------------------------------- */
  // A sub-path from the URL — "", "ep", "rarity" or a badge slug — to a view.
  function resolve(sub) {
    if (!sub || sub === "count") return "count";
    if (GRID_FIXED_VIEWS.includes(sub)) return sub;
    const id = idForSlug(sub);
    const bi = id == null ? undefined : badgeByIndex.get(id);
    return bi === undefined ? "count" : bi;
  }
  const subOf = v => typeof v === "number" ? badgeSlug(badgeMeta[v].id) : v === "count" ? "" : v;

  function selectView(v) {
    haltLife();
    tip.hidden = true;             // it described the old view; the next move redraws it
    view = v; member = null; sup = null;
    if (isBadge()) {
      member = membershipOf(v);
      sup = supHide ? supersededOf(v, member) : null;
      src = paintMember(member, sup);
    } else if (v === "ep") src = paintEP();
    else if (v === "rarity") src = paintRarity();
    else src = paintCount();
    syncList(); syncSup(); describe(); syncURL(); render();
  }
  // The address bar tracks the view — /grid, /grid/ep, /grid/rarity or
  // /grid/<badge slug> — so any view is a shareable link. Replaced, not
  // pushed: Back leaves the tab rather than stepping through every badge tried.
  function syncURL() {
    if (!location.pathname.startsWith("/grid")) return;
    const sub = subOf(view), path = "/grid" + (sub ? "/" + sub : "");
    if (location.pathname !== path) history.replaceState(null, "", path);
  }
  function syncList() {
    for (const b of viewsEl.children) b.classList.toggle("is-on", b.dataset.v === view);
    for (const b of listEl.querySelectorAll(".gr-item")) b.classList.toggle("is-on", Number(b.dataset.bi) === view);
    cmapSel.disabled = view === "rarity";
    cmapSel.title = view === "rarity" ? "The rarity view paints rngdle's tier colours" : "Colour scale";
  }
  function syncSup() {
    const off = !isBadge() || !doms[view].length;
    supBtn.disabled = off;
    supBtn.setAttribute("aria-pressed", String(supHide));
    for (const b of supModeEl.children) b.disabled = off;
    paintModeToggle(supModeEl, supStyle);
  }
  function describe() {
    const bar = grad => `<span class="gr-scale" style="background:linear-gradient(90deg,${grad})"></span>`;
    const hi = rgbStr(cmap(1)), lo = rgbStr(cmap(0));
    let title, legend, stat = fmt(GRID_N), statLabel = "numbers mapped", docTitle = "Grid";
    if (view === "count") {
      title = `Badge count · ${cmin} to ${cmax} badges per number`;
      legend = `<span>${cmin}</span>${bar(cmapCSS())}<span>${cmax} badges</span>`;
    } else if (view === "ep") {
      title = `Total EP · ${fmt(emin)} to ${fmt(emax)} EP, log scale`;
      legend = `<span>${compact(emin)}</span>${bar(cmapCSS())}<span>${compact(emax)} EP</span>`;
      docTitle = "Total EP on the grid";
    } else if (view === "rarity") {
      title = "Rarity · every number's card tier";
      legend = TIERS.map((T, i) => `<span><i class="gr-sw" style="background:${rgbStr(tierRGB[i])}"></i>${escHtml(T.label)}</span>`).reverse().join("");
      docTitle = "Rarity on the grid";
    } else {
      const b = badgeMeta[view], label = escHtml(b.label);
      let cnt = 0; for (let i = 0; i < GRID_N; i++) cnt += member[i];
      let sc = 0; if (sup) for (let i = 0; i < GRID_N; i++) sc += sup[i];
      title = `${b.emoji} ${b.label} · ${fmt(cnt)} of ${fmt(GRID_N)} (${fmtPct(cnt / GRID_N * 100)})` + (sup ? ` · ${fmt(sc)} superseded` : "");
      if (sup && supStyle === "grey") {
        const d = cmap(0).map((c, i) => c + (cmap(1)[i] - c) * .3);
        legend = `<span>none / superseded</span>${bar(`${lo} 0 33%, ${rgbStr(d)} 33% 67%, ${hi} 67% 100%`)}<span>scores ${label}</span>`;
      } else if (sup) {
        legend = `<span>none / superseded</span>${bar(`${lo} 0 50%, ${hi} 50% 100%`)}<span>scores ${label}</span>`;
      } else {
        legend = `<span>none</span>${bar(`${lo} 0 50%, ${hi} 50% 100%`)}<span>earns ${label}</span>`;
      }
      stat = fmt(cnt); statLabel = `earn ${b.label}`; docTitle = `${b.label} on the grid`;
    }
    titleEl.textContent = title;
    legendEl.innerHTML = legend;
    $("grid-stat").textContent = stat;
    $("grid-stat-label").textContent = statLabel;
    document.title = `${docTitle} · RNGdle Sandbox`;
  }

  /* --- the badge list ------------------------------------------------------------ */
  // Grouped the way the Analysis picker is: rngdle's own sets, then "No Set".
  function buildList() {
    listEl.replaceChildren();
    for (const g of badgeSetGroups()) {
      const group = anNode(`
        <div class="gr-group">
          <div class="gr-group-head type-ui"><span>${g.icon}</span> <span></span></div>
          <div class="gr-group-rows"></div>
        </div>`);
      group.querySelector(".gr-group-head span:last-child").textContent = g.name;
      group.dataset.name = g.name.toLowerCase();
      const rows = group.lastElementChild;
      for (const id of g.ids) {
        const b = badgeMeta[badgeByIndex.get(id)];
        const btn = anNode(`<button type="button" class="gr-item type-ui" data-bi="${b.i}"><span>${b.emoji}</span><span></span><em class="type-meta">${escHtml(b.rarity)}</em></button>`);
        btn.children[1].textContent = b.label;
        btn.dataset.search = `${b.label} ${b.id} ${b.rarity}`.toLowerCase();
        rows.appendChild(btn);
      }
      listEl.appendChild(group);
    }
    syncList();
  }
  function filterList() {
    const q = searchEl.value.trim().toLowerCase();
    let any = false;
    for (const g of listEl.querySelectorAll(".gr-group")) {
      const groupHit = !q || g.dataset.name.includes(q);
      let shown = 0;
      for (const b of g.querySelectorAll(".gr-item")) {
        const ok = groupHit || b.dataset.search.includes(q);
        b.hidden = !ok;
        if (ok) shown++;
      }
      g.hidden = !shown;
      if (shown) any = true;
    }
    $("grid-list-empty").hidden = any;
  }

  /* --- pointer: pan, pinch, hover, click ---------------------------------------- */
  // One pointer pans (and a click or tap opens the number); two pinch-zoom
  // toward their midpoint. touch-action:none on the canvas keeps the browser
  // from taking the gesture.
  const pointers = new Map();
  let moved = 0, lx = 0, ly = 0, pinch = null;
  function startPinch() {
    const p = [...pointers.values()];
    pinch = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2, scale, ox, oy };
    moved = 999;
  }
  function hoverText(n) {
    const ep = table[n], tier = TIERS[tierOfN[n]].label;
    if (view === "count") return `${counts[n]} badge${counts[n] === 1 ? "" : "s"} · ${fmt(ep)} EP`;
    if (view === "ep") return `${fmt(ep)} EP · ${tier}`;
    if (view === "rarity") return `${tier} · ${fmt(ep)} EP`;
    const b = badgeMeta[view];
    return member[n] ? `earns ${b.label}${sup && sup[n] ? " (superseded)" : ""}` : `no ${b.label}`;
  }
  function hover(x, y) {
    const n = numberAt(x, y);
    if (n === null) { tip.hidden = true; cv.style.cursor = "grab"; return; }
    tip.innerHTML = `<b>${fmt(n)}</b><span></span>`;
    tip.lastElementChild.textContent = `${hoverText(n)} · click to open`;
    tip.hidden = false;
    tip.style.left = `${Math.max(4, Math.min(cw - tip.offsetWidth - 4, x + 14))}px`;
    tip.style.top = `${Math.max(4, Math.min(ch - tip.offsetHeight - 4, y + 14))}px`;
    cv.style.cursor = "pointer";
  }
  cv.addEventListener("wheel", e => {
    e.preventDefault();
    const [mx, my] = rel(e);
    zoomAt(mx, my, e.deltaY < 0 ? 1.18 : 1 / 1.18);
  }, { passive: false });
  cv.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [x, y] = rel(e);
    pointers.set(e.pointerId, { x, y });
    try { cv.setPointerCapture(e.pointerId); } catch { /* already released */ }
    if (pointers.size === 1) { moved = 0; lx = x; ly = y; tip.hidden = true; }
    else if (pointers.size === 2) startPinch();
  });
  cv.addEventListener("pointermove", e => {
    const [x, y] = rel(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (pinch && pointers.size >= 2) {
      const p = [...pointers.values()];
      const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      const ns = Math.min(GRID_MAX_SCALE, Math.max(minScale, pinch.scale * dist / pinch.dist));
      const sx = (pinch.mx - pinch.ox) / pinch.scale, sy = (pinch.my - pinch.oy) / pinch.scale;
      scale = ns; ox = mx - sx * ns; oy = my - sy * ns; render();
      return;
    }
    if (pointers.size === 1 && pointers.has(e.pointerId)) {
      ox += x - lx; oy += y - ly; moved += Math.abs(x - lx) + Math.abs(y - ly); lx = x; ly = y; render();
      return;
    }
    if (pointers.size === 0 && ready) hover(x, y);
  });
  function endPointer(e) {
    const had = pointers.delete(e.pointerId);
    try { cv.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (pointers.size === 1) {         // pinch -> single drag: rebase, and it is not a tap
      const p = [...pointers.values()][0]; lx = p.x; ly = p.y; pinch = null; moved = 999;
    } else if (pointers.size === 0) {
      pinch = null;
      if (had && moved < 5 && ready) {
        const [x, y] = rel(e), n = numberAt(x, y);
        if (n !== null) navigate(`/n/${n}`);
      }
    }
  }
  cv.addEventListener("pointerup", endPointer);
  cv.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; });
  cv.addEventListener("pointerleave", () => { if (pointers.size === 0) tip.hidden = true; });
  cv.addEventListener("dblclick", e => { e.preventDefault(); const [mx, my] = rel(e); zoomAt(mx, my, 2.2); });
  // Right-click copies the map — the full 1000×1000, not the viewport — as a PNG.
  cv.addEventListener("contextmenu", async e => {
    e.preventDefault();
    if (!src) return;
    try {
      const blob = await new Promise((res, rej) => src.toBlob(b => b ? res(b) : rej(new Error("encode failed")), "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("Copied the map as a PNG");
    } catch (err) {
      flash(`Copy failed: ${err && err.message || err}`);
    }
  });

  /* --- controls ------------------------------------------------------------------ */
  $("grid-zin").addEventListener("click", () => zoomAt(cw / 2, ch / 2, 1.5));
  $("grid-zout").addEventListener("click", () => zoomAt(cw / 2, ch / 2, 1 / 1.5));
  $("grid-zfit").addEventListener("click", () => { fit(); render(); });
  $("grid-link").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); flash("Link copied"); }
    catch { flash("Copy failed"); }
  });
  viewsEl.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b && ready) selectView(b.dataset.v);
  });
  listEl.addEventListener("click", e => {
    const b = e.target.closest(".gr-item");
    if (b && ready) selectView(Number(b.dataset.bi));
  });
  searchEl.addEventListener("input", filterList);
  cmapSel.addEventListener("change", () => { cmapName = cmapSel.value; if (ready) selectView(view); });
  supBtn.addEventListener("click", () => {
    supHide = !supHide;
    if (isBadge()) selectView(view); else syncSup();
  });
  supModeEl.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    supStyle = b.dataset.mode;
    if (isBadge() && supHide) selectView(view); else syncSup();
  });

  /* --- Konami code: Conway's Game of Life seeded from the current view ------------ */
  // ↑↑↓↓←→←→BA turns the map into a torus-wrapped Game of Life. Alive cells
  // are the lit half of the view: members for a badge, above the midpoint for
  // count and EP, Rare and up for rarity. Esc — or the code again — stops it
  // and restores the view. Pan and zoom keep working while it runs.
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let konamiPos = 0, life = null;
  function lifeSeed() {
    const a = new Uint8Array(GRID_N);
    if (view === "count") { const mid = (cmin + cmax) / 2; for (let i = 0; i < GRID_N; i++) a[i] = counts[i] > mid ? 1 : 0; }
    else if (view === "ep") {
      const lo = Math.log(emin + 1), span = (Math.log(emax + 1) - lo) || 1;
      for (let i = 0; i < GRID_N; i++) a[i] = (Math.log(table[i] + 1) - lo) / span >= .5 ? 1 : 0;
    } else if (view === "rarity") { for (let i = 0; i < GRID_N; i++) a[i] = tierOfN[i] >= 3 ? 1 : 0; }
    else a.set(member);
    return a;
  }
  function paintLife() {
    const d = life.img.data, hi = cmap(1), lo = cmap(0), cur = life.cur;
    const hr = hi[0] | 0, hg = hi[1] | 0, hb = hi[2] | 0, lr = lo[0] | 0, lg = lo[1] | 0, lb = lo[2] | 0;
    let alive = 0;
    for (let i = 0; i < GRID_N; i++) {
      const p = i << 2;
      if (cur[i]) { alive++; d[p] = hr; d[p + 1] = hg; d[p + 2] = hb; } else { d[p] = lr; d[p + 1] = lg; d[p + 2] = lb; }
      d[p + 3] = 255;
    }
    life.canvas.getContext("2d").putImageData(life.img, 0, 0);
    src = life.canvas;
    titleEl.textContent = `Conway's Game of Life · generation ${life.gen} · ${fmt(alive)} alive`;
    render();
  }
  function stepLife() {
    if ($("view-grid").hidden) { stopLife(); return; }
    const cur = life.cur, nxt = life.nxt, W = GRID_W, H = GRID_H;
    for (let y = 0; y < H; y++) {
      const row = y * W, up = (y === 0 ? H - 1 : y - 1) * W, dn = (y === H - 1 ? 0 : y + 1) * W;
      for (let x = 0; x < W; x++) {
        const l = x === 0 ? W - 1 : x - 1, r = x === W - 1 ? 0 : x + 1;
        const nb = cur[up + l] + cur[up + x] + cur[up + r] + cur[row + l] + cur[row + r] + cur[dn + l] + cur[dn + x] + cur[dn + r];
        nxt[row + x] = (nb === 3 || (nb === 2 && cur[row + x])) ? 1 : 0;
      }
    }
    life.cur = nxt; life.nxt = cur; life.gen++;
    paintLife();
  }
  function haltLife() { if (life) { clearInterval(life.timer); life = null; } }
  function stopLife() { haltLife(); selectView(view); flash("Game of Life stopped"); }
  function startLife() {
    const canvas = document.createElement("canvas"); canvas.width = GRID_W; canvas.height = GRID_H;
    life = { cur: lifeSeed(), nxt: new Uint8Array(GRID_N), gen: 0, timer: 0, canvas, img: canvas.getContext("2d").createImageData(GRID_W, GRID_H) };
    paintLife();
    life.timer = setInterval(stepLife, 100);
    flash("Conway's Game of Life — Esc to stop");
  }
  document.addEventListener("keydown", e => {
    if ($("view-grid").hidden || !ready) return;
    if (life && e.key === "Escape") { stopLife(); return; }
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiPos = k === KONAMI[konamiPos] ? konamiPos + 1 : (k === KONAMI[0] ? 1 : 0);
    if (konamiPos === KONAMI.length) { konamiPos = 0; if (life) stopLife(); else startLife(); }
  });

  /* --- loading --------------------------------------------------------------------- */
  function status(text) {
    $("grid-status").hidden = !text;
    $("grid-status-text").textContent = text || "";
  }
  async function start() {
    if (started) return;
    started = true;
    try {
      status("Loading the EP index…");
      const t = await getTable();
      status("Loading the badge index…");
      await getBadgeTable();
      status("Counting badges…");
      await new Promise(r => setTimeout(r));      // let the status paint before the two passes
      if (!tierOfN) deriveTiers(t);
      counts = badgeCounts();
      let mn = 255, mx = 0, en = Infinity, ex = 0;
      for (let n = 0; n < GRID_N; n++) {
        const c = counts[n], v = t[n];
        if (c < mn) mn = c; if (c > mx) mx = c;
        if (v < en) en = v; if (v > ex) ex = v;
      }
      cmin = mn; cmax = mx; emin = en; emax = ex;
      doms = dominators();
      tierRGB = TIERS.map(T => rgbOf(T.accent));
      ready = true;
      status("");
      $("grid-body").hidden = false;
      buildList();
      selectView(resolve(pending));
      new ResizeObserver(onResize).observe(wrap);
      onResize();
    } catch (err) {
      started = false;
      status(`Could not load the indexes: ${err && err.message || err}`);
    }
  }
  // The router's entry: open the tab on a sub-path. Before the indexes land the
  // request is remembered and honoured once they do.
  function show(sub) {
    pending = sub || "";
    if (!ready) { start(); return; }
    const v = resolve(pending);
    if (v !== view || life) selectView(v);
    else { syncURL(); describe(); }
  }
  return { show };
})();

function showGrid(sub) { GRID.show(sub); }

// showView (ep.js) calls showGrid() when the tab is opened; ep.js has already
// routed by the time this file runs, so a cold load of /grid starts itself.
if (!document.getElementById("view-grid").hidden) {
  const m = /^\/grid\/([^/]+)$/.exec(location.pathname);
  showGrid(m ? decodeURIComponent(m[1]) : "");
}
