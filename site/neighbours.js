// Neighbours — what one different digit would have been worth.
//
// Treat every number as its six-digit zero-padded form and it has exactly 54
// neighbours: six positions times nine other digits, every one a legal roll in
// 0..999,999. That turns the range into a graph, and the questions become
// local ones: was this roll a peak or a valley, and how far off was the peak
// next door? The board shows all 54, shaded by how they compare; under it,
// the whole range walked once for the local peaks, the valleys, how much of
// it sits one digit from a mythic, and the cruellest near misses.
//
// Ported from rngdle_solver's /beta/nearmiss ("Near Misses"). The solver
// walks the 54 million neighbour pairs in a Web Worker over its own sweep;
// here the EP table is already shipped, so the walk is one synchronous pass
// over it — 54M typed-array reads, a few hundred milliseconds, done once.
// A number's own board is then 60 reads.

const NB_N = 1000000;                                   // 0..999,999; 1,000,000 has seven digits and no six-digit neighbours
const NB_POW = [100000, 10000, 1000, 100, 10, 1];
const NB_PLACES = ["100k", "10k", "1k", "100", "10", "1"];
const NB_DEFAULT = 123456;
const NB_TOP = 10;                                       // rows in each range-wide list

const NEIGHBOURS = (() => {
  const $ = id => document.getElementById(id);
  let ready = false, started = false, pending = null;
  let cur = NB_DEFAULT, range = null;                    // range: the whole-range pass

  // Signed and short: the board's cells are mostly negative deltas, and an
  // eight-digit one does not fit in a cell.
  const signed = n => {
    const a = Math.abs(n), s = n < 0 ? "-" : "";
    return a >= 1e6 ? `${s}${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${s}${(a / 1e3).toFixed(1)}k` : s + fmt(Math.round(a));
  };
  const tierOf = n => TIERS[tierOfN[n]];
  const pillOf = n => {
    const T = tierOf(n), p = RARITY.RARITY_PALETTE[T.key].pill;
    return `<span class="type-label inline-block rounded-sm px-1.5 py-0.5 ${p.bgClass} ${p.textClass} ${p.borderClass}">${escHtml(T.label)}</span>`;
  };
  // A stat tile. The rarity pill gets a line of its own: inline after the
  // figure it wrapped on its own in the narrow column, leaving a dangling "·".
  const tile = (k, v, sub, pill) => `<div class="min-w-0"><dt class="type-label mb-1 text-prose-3">${k}</dt>` +
    `<dd class="type-data text-lg font-bold text-prose">${v}</dd>` +
    (pill ? `<dd class="mt-1">${pill}</dd>` : "") +
    `<dd class="type-meta text-prose-3 normal-case mt-1">${sub}</dd></div>`;

  /* --- the whole range, once --------------------------------------------------- */
  // Two short top-lists kept by insertion: a full sort of a million candidates
  // to show ten rows would cost more than the whole pass.
  function keep(list, item, key) {
    if (list.length < NB_TOP) { list.push(item); list.sort((a, b) => b[key] - a[key]); return; }
    if (item[key] <= list[NB_TOP - 1][key]) return;
    list[NB_TOP - 1] = item;
    list.sort((a, b) => b[key] - a[key]);
  }
  function walkRange() {
    const t = table, mythic = tierCut[tierCut.length - 1];
    let peaks = 0, valleys = 0, nearMythic = 0, sumBest = 0, sumEP = 0;
    const cruel = [], summits = [];
    for (let n = 0; n < NB_N; n++) {
      const mine = t[n];
      sumEP += mine;
      let best = -1, bestN = -1, worse = 0;
      for (let p = 0; p < 6; p++) {
        const pw = NB_POW[p], d0 = ((n / pw) | 0) % 10, base = n - d0 * pw;
        for (let d = 0; d < 10; d++) {
          if (d === d0) continue;
          const e = t[base + d * pw];
          if (e > best) { best = e; bestN = base + d * pw; }
          if (e < mine) worse++;
        }
      }
      sumBest += best;
      if (worse === 54) { peaks++; keep(summits, { n, ep: mine }, "ep"); }
      if (worse === 0) valleys++;
      if (best >= mythic) nearMythic++;
      // A near miss is a poor roll with a spectacular neighbour. Ranked by ratio,
      // so it is not just the ten biggest numbers in the range.
      if (mine < mythic) keep(cruel, { n, ep: mine, best, to: bestN, ratio: best / Math.max(1, mine) }, "ratio");
    }
    return { peaks, valleys, nearMythic, meanBest: sumBest / NB_N, meanEP: sumEP / NB_N, cruel, summits, mythic };
  }

  /* --- one number's 54 neighbours ---------------------------------------------- */
  function board(n) {
    const t = table, mine = t[n], s = String(n).padStart(6, "0");
    const cells = [];
    let best = -1, bestN = -1, worst = Infinity;
    for (let p = 0; p < 6; p++) {
      const pw = NB_POW[p], d0 = Number(s[p]), base = n - d0 * pw;
      for (let d = 0; d < 10; d++) {
        const m = base + d * pw, e = t[m], self = d === d0;
        if (!self && e > best) { best = e; bestN = m; }
        if (!self && e < worst) worst = e;
        cells.push({ p, d, m, e, self });
      }
    }
    // Every cell tied at an extreme is marked, not just the first found — with 54
    // neighbours the worst score in particular is often shared. And only when the
    // extreme is real: on a local peak every swap loses, so a "best" star would
    // point at the least-bad way to make things worse.
    for (const c of cells) {
      c.best = !c.self && c.e === best && best > mine;
      c.worst = !c.self && c.e === worst && worst < mine && best !== worst;
    }
    // Shade on the log ratio against the number itself, so the scale reads the
    // same for a 3,000 EP roll and a 3,000,000 one.
    const lr = e => Math.log10(Math.max(1, e) / Math.max(1, mine));
    const span = Math.max(.35, ...cells.map(c => Math.abs(lr(c.e))));
    const shade = c => {
      if (c.self) return "";
      const r = lr(c.e) / span, a = Math.min(.85, Math.abs(r) * .9 + .08);
      return r >= 0
        ? `background:color-mix(in srgb, var(--status-success) ${(a * 100).toFixed(0)}%, var(--surface-dim))`
        : `background:color-mix(in srgb, var(--status-danger) ${(a * 70).toFixed(0)}%, var(--surface-dim))`;
    };
    $("nb-board").innerHTML = [0, 1, 2, 3, 4, 5].map(p => `<div class="nb-col">
      <div class="nb-head font-roll">${s[p]}</div>
      <div class="nb-cells">${cells.filter(c => c.p === p).map(c =>
        `<button type="button" class="nb-cell font-roll${c.self ? " is-self" : c.best ? " is-best" : c.worst ? " is-worst" : ""}" data-n="${c.m}" style="${shade(c)}"
          title="${fmt(c.m)} · ${fmt(c.e)} EP${c.best ? " · the best swap available" : c.worst ? " · the worst swap available" : ""}">${
          c.best ? '<span class="nb-mk">&#9733;</span>' : c.worst ? '<span class="nb-mk">&#9660;</span>' : ""}${c.d}<em>${
          c.self ? "this" : (c.e >= mine ? "+" : "") + signed(c.e - mine)}</em></button>`).join("")}</div>
      <div class="nb-foot font-roll">${NB_PLACES[p]}</div>
    </div>`).join("");

    const worse = cells.filter(c => !c.self && c.e < mine).length;
    $("nb-cur").innerHTML =
      tile("This number", `${signed(mine)} EP`, `${fmt(mine)} exactly`, pillOf(n)) +
      tile("Best neighbour", `${signed(best)} EP`, `at <a class="underline hover:text-prose" href="/n/${bestN}">${fmt(bestN)}</a>`, pillOf(bestN)) +
      tile("One digit gains", best > mine ? "+" + signed(best - mine) : "nothing",
        best > mine ? `${(best / Math.max(1, mine)).toFixed(1)}× this score` : "this is a local peak") +
      tile("Better than", String(worse), "of its 54 neighbours");
    $("nb-open").href = `/n/${n}`;
    $("nb-stat").textContent = fmt(mine);
    $("nb-stat-label").textContent = `EP · ${tierOf(n).label}`;
    $("nb-input").value = String(n);
    cur = n;
    document.title = `${fmt(n)} · Neighbours · RNGdle Sandbox`;
    if (location.pathname.startsWith("/neighbours") && location.pathname !== `/neighbours/${n}`) {
      history.replaceState(null, "", `/neighbours/${n}`);
    }
  }
  function set(n) {
    if (!Number.isInteger(n) || n < 0 || n >= NB_N) return false;
    board(n);
    return true;
  }

  /* --- the range-wide panels --------------------------------------------------- */
  function renderRange() {
    const R = range;
    $("nb-global").innerHTML =
      tile("One digit from mythic", `${(100 * R.nearMythic / NB_N).toFixed(1)}%`, `${fmt(R.nearMythic)} numbers have a mythic neighbour`) +
      tile("Local peaks", fmt(R.peaks), "beat all 54 of their neighbours") +
      tile("Local valleys", fmt(R.valleys), "lose to all 54") +
      tile("Mean best neighbour", signed(R.meanBest), `EP · against a mean roll of ${signed(R.meanEP)}`);
    const row = (n, right, sub) => `<button type="button" class="nb-row" data-n="${n}">
      <span class="nb-row-n font-roll">${fmt(n)}</span>${pillOf(n)}<span class="nb-row-s">${sub}</span><span class="nb-row-v font-roll">${right}</span></button>`;
    $("nb-cruel").innerHTML = R.cruel.map(c =>
      row(c.n, `${c.ratio >= 1000 ? signed(c.ratio) : Math.round(c.ratio)}×`, `${fmt(c.ep)} EP, next door ${signed(c.best)}`)).join("");
    $("nb-summits").innerHTML = R.summits.map(s => row(s.n, `${signed(s.ep)} EP`, "beats every neighbour")).join("");
  }

  /* --- controls ------------------------------------------------------------------ */
  document.getElementById("view-neighbours").addEventListener("click", e => {
    const b = e.target.closest("[data-n]");
    if (!b || !ready) return;
    set(Number(b.dataset.n));
    document.getElementById("view-neighbours").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  // The heading is the input, and the board follows every keystroke: each
  // digit typed re-renders for the number so far (1, 12, 123 …), so there is
  // nothing to submit. Enter just drops focus, and clicking away with the
  // field empty puts the number showing back into it.
  $("nb-input").addEventListener("input", e => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    if (!digits) { e.target.value = ""; return; }
    const n = parseInt(digits, 10);
    if (ready && n !== cur) set(n);              // set() rewrites the field as the canonical digits
    else e.target.value = String(n);
  });
  $("nb-form").addEventListener("submit", e => { e.preventDefault(); $("nb-input").blur(); });
  $("nb-input").addEventListener("blur", e => { if (!e.target.value.replace(/\D/g, "")) e.target.value = String(cur); });
  $("nb-input").addEventListener("focus", e => e.target.select());
  $("nb-random").addEventListener("click", () => { if (ready) set(Math.floor(Math.random() * NB_N)); });

  /* --- loading --------------------------------------------------------------------- */
  function status(text) {
    $("nb-status").hidden = !text;
    $("nb-status-text").textContent = text || "";
  }
  async function start() {
    if (started) return;
    started = true;
    try {
      status("Loading the EP index…");
      const t = await getTable();
      status("Walking 54 million neighbours…");
      await new Promise(r => setTimeout(r));      // let the status paint before the pass
      if (!tierOfN) deriveTiers(t);
      range = walkRange();
      ready = true;
      status("");
      $("nb-body").hidden = false;
      renderRange();
      set(pending ?? NB_DEFAULT) || set(NB_DEFAULT);
    } catch (err) {
      started = false;
      status(`Could not load the EP index: ${err && err.message || err}`);
    }
  }
  // The router's entry: open the tab on a number (or the default). Before the
  // table lands the request is remembered and honoured once it does.
  function show(n) {
    pending = n;
    if (!ready) { start(); return; }
    if (n == null) { if (location.pathname === "/neighbours") history.replaceState(null, "", `/neighbours/${cur}`); document.title = `${fmt(cur)} · Neighbours · RNGdle Sandbox`; return; }
    if (n !== cur) set(n);
  }
  return { show };
})();

function showNeighbours(n) { NEIGHBOURS.show(n); }

// showView (ep.js) calls showNeighbours() when the tab is opened; ep.js has
// already routed by the time this file runs, so a cold load starts itself.
if (!document.getElementById("view-neighbours").hidden) {
  const m = /^\/neighbours\/(\d{1,6})$/.exec(location.pathname);
  showNeighbours(m ? Number(m[1]) : null);
}
