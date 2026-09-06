// Luck — what a roll is worth before you make it, and how lucky yours were.
//
// Every other tab is about the numbers; this one is about the player. The EP
// table is the exact distribution of scores over the whole roll space, so
// every "how likely was that?" question has a closed-form answer rather than
// a simulated one. The one that matters is best-of-N: if F is the EP
// distribution, the best of N independent rolls is below x with probability
// F(x)^N — which gives the typical best after N rolls, and, read the other
// way, exactly how lucky a real player's best roll was among everyone who
// rolled the same number of times.
//
// Ported from rngdle_solver's /beta/luck ("Luck Lab"). The solver sorts its
// own sweep in a Web Worker; here the shipped EP table is sorted once on
// open, ~150ms. Beyond the restyle: the roll counts read as days too (rngdle
// is one roll a day), the best-of-N slider is log-scaled to 10,000 with a
// milestone table under it, and a player's reading is a real URL
// (/luck/<name>) that the profile page links to. The solver's histogram of
// single-roll scores is not here: the Analysis tab already draws it.

const LUCK_MAX_ROLLS = 10000;               // the best-of-N slider's top
const LUCK_MILESTONES = [[1, "one roll"], [7, "a week"], [30, "a month"], [100, "100 days"], [365, "a year"], [1000, "1,000 days"], [3650, "ten years"]];
const LUCK_MAX_PLAYERS = 6;                 // the solver's cap on a comparison
const LUCK_ROWS = 8;                        // best rolls listed in a reading

const LUCK = (() => {
  const $ = id => document.getElementById(id);
  let ready = false, started = false, pending = null;
  let S = null, N = 0, lgMin = 0, lgMax = 1, tiers = null;   // S: every EP total, sorted; tiers: [{ key, label, accent, lo }]
  // The log axes run from the decade below the lowest score (1,000: nothing
  // scores under 1,759) to the top, rather than from 0 with an empty left half.
  const lg = ep => (Math.log10(Math.max(1, ep)) - lgMin) / (lgMax - lgMin);

  const playersOf = p => p <= 0 ? "no player" : p >= 1 ? "every player" : Math.round(1 / p) === 1 ? "nearly every player" : `1 in ${fmt(Math.round(1 / p))} players`;
  const pct = (p, d = 1) => `${(100 * p).toFixed(d)}%`;
  const tile = (k, v, sub, pill) => `<div class="min-w-0"><dt class="type-label mb-1 text-prose-3">${k}</dt>` +
    `<dd class="type-data text-lg font-bold text-prose">${v}</dd>` + (pill ? `<dd class="mt-1">${pill}</dd>` : "") +
    `<dd class="type-meta text-prose-3 normal-case mt-1">${sub}</dd></div>`;

  // Share of all rolls scoring at or below x, and its inverse.
  function cdf(x) {
    let lo = 0, hi = N;
    while (lo < hi) { const m = (lo + hi) >> 1; if (S[m] <= x) lo = m + 1; else hi = m; }
    return lo / N;
  }
  const quantile = p => S[Math.min(N - 1, Math.max(0, Math.round(p * N) - 1))];
  const tierIdx = ep => { let i = 0; for (let t = 1; t < tiers.length; t++) if (ep >= tiers[t].lo) i = t; return i; };
  const pillOf = ti => {
    const p = RARITY.RARITY_PALETTE[tiers[ti].key].pill;
    return `<span class="type-label inline-block rounded-sm px-1.5 py-0.5 ${p.bgClass} ${p.textClass} ${p.borderClass}">${escHtml(tiers[ti].label)}</span>`;
  };
  // P(best of n <= x) = F(x)^n, so the q-quantile of the best is the F = q^(1/n) quantile.
  const bestAt = (n, q) => quantile(Math.pow(q, 1 / n));
  const mythicP = n => 1 - Math.pow(cdf(tiers[tiers.length - 1].lo - .5), n);

  /* --- best of N --------------------------------------------------------------------- */
  // The slider is log-scaled: 0..1000 maps to 1..10,000 rolls.
  const sliderToN = v => Math.max(1, Math.round(Math.pow(10, v / 1000 * Math.log10(LUCK_MAX_ROLLS))));
  const nToSlider = n => Math.round(Math.log10(Math.max(1, n)) / Math.log10(LUCK_MAX_ROLLS) * 1000);
  const days = n => n === 1 ? "one daily roll" : n < 30 ? `${n} days of rolling` : n < 365 ? `${(n / 30.44).toFixed(1)} months of daily rolls` : `${(n / 365.25).toFixed(1)} years of daily rolls`;

  function bestOfN(n) {
    $("lk-n").value = String(n);
    $("lk-rolls").value = String(nToSlider(n));
    const med = bestAt(n, .5), lo = bestAt(n, .1), hi = bestAt(n, .9), pm = mythicP(n), top = tiers.length - 1;
    $("lk-bon").innerHTML =
      tile("Typical best", `${compact(med)} EP`, `the median player's best after ${fmt(n)} roll${n === 1 ? "" : "s"} — ${days(n)}`, pillOf(tierIdx(med))) +
      tile("Unlucky to lucky", `${compact(lo)} – ${compact(hi)}`, "EP · the middle 80% of players") +
      tile(`At least one ${tiers[top].label.toLowerCase()}`, pct(pm, pm < .001 ? 3 : 1), playersOf(pm));

    // The whole curve, so the slider has context: median best against rolls,
    // the 10–90 band around it, and the tier cutoffs across it.
    const W = 760, H = 210, L = 46, R = 64, T = 12, B = 30, lgN = Math.log10(LUCK_MAX_ROLLS);
    const plotW = W - L - R, plotH = H - T - B;
    const cx = k => L + Math.log10(k) / lgN * plotW, cy = v => T + plotH - lg(v) * plotH;
    const pts = [], band = [];
    for (let k = 1; k <= LUCK_MAX_ROLLS; k = k < 10 ? k + 1 : Math.round(k * 1.15)) {
      pts.push(`${cx(k).toFixed(1)},${cy(bestAt(k, .5)).toFixed(1)}`);
      band.push([cx(k), cy(bestAt(k, .9)), cy(bestAt(k, .1))]);
    }
    const topEdge = band.map(b => `${b[0].toFixed(1)},${b[1].toFixed(1)}`).join(" ");
    const botEdge = band.slice().reverse().map(b => `${b[0].toFixed(1)},${b[2].toFixed(1)}`).join(" ");
    let g = "", lastLabelY = -Infinity;
    // Cutoff lines for every tier; a label only where it will not sit on the
    // one below it — the low tiers are a few EP apart and crowd the bottom.
    tiers.forEach((t, i) => {
      if (!i) return;
      const y = cy(t.lo);
      if (y < T || y > T + plotH) return;
      g += `<line class="an-grid" x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}"/>`;
    });
    for (let i = tiers.length - 1; i > 0; i--) {
      const y = cy(tiers[i].lo);
      if (y < T || y > T + plotH || y - lastLabelY < 11) continue;
      g += `<text class="lk-tier" x="${W - R + 6}" y="${(y + 3).toFixed(1)}" fill="${tiers[i].accent}">${escHtml(tiers[i].label)}</text>`;
      lastLabelY = y;
    }
    g += `<polygon class="lk-band" points="${topEdge} ${botEdge}"/><polyline class="lk-line" points="${pts.join(" ")}"/>` +
      `<line class="lk-mark" x1="${cx(n).toFixed(1)}" y1="${T}" x2="${cx(n).toFixed(1)}" y2="${T + plotH}"/>` +
      `<circle class="lk-dot" cx="${cx(n).toFixed(1)}" cy="${cy(med).toFixed(1)}" r="3.5"/>` +
      `<line class="an-axis" x1="${L}" y1="${T + plotH}" x2="${W - R}" y2="${T + plotH}"/>`;
    for (const k of [1, 10, 100, 1000, 10000]) g += `<text class="an-tick" x="${cx(k).toFixed(1)}" y="${H - 8}" text-anchor="middle">${k >= 1000 ? `${k / 1000}k` : k} roll${k === 1 ? "" : "s"}</text>`;
    for (let e = Math.ceil(lgMin); e <= Math.floor(lgMax); e++) { const y = cy(Math.pow(10, e)); if (y >= T && y <= T + plotH) g += `<text class="an-tick" x="${L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${compact(Math.pow(10, e))}</text>`; }
    $("lk-curve").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Typical best score against number of rolls, with the middle 80% band">${g}</svg>`;
  }
  function milestones() {
    $("lk-milestones").innerHTML = LUCK_MILESTONES.map(([n, label]) => {
      const med = bestAt(n, .5), pm = mythicP(n);
      return `<tr><td class="pr-ep">${fmt(n)}</td><td class="pr-dim">${label}</td><td class="pr-ep">${compact(med)}</td><td>${pillOf(tierIdx(med))}</td><td class="pr-dim">${pct(pm, pm < .001 ? 3 : 1)}</td></tr>`;
    }).join("");
  }

  /* --- how lucky were yours ----------------------------------------------------------- */
  // Two independent readings of one set of rolls: how good the single best was
  // among players with that many rolls (F(best)^k), and whether the whole set
  // drifted high or low — percentiles are uniform, so their mean has a known
  // spread and a streak shows up as sigma.
  function score(nums) {
    const valid = nums.filter(n => Number.isInteger(n) && n >= 0 && n < TABLE_LEN);
    if (!valid.length) return null;
    const rows = valid.map(n => ({ n, ep: table[n], p: cdf(table[n]) })).sort((a, b) => b.ep - a.ep);
    const k = rows.length, best = rows[0], beat = Math.pow(best.p, k);
    const meanP = rows.reduce((s, r) => s + r.p, 0) / k;
    return { rows, k, best, beat, meanP, z: (meanP - .5) / Math.sqrt(1 / 12 / k), par: bestAt(k, .5) };
  }
  const verdictOf = b => b >= .999 ? "extraordinary" : b >= .99 ? "very lucky" : b >= .75 ? "lucky" : b >= .25 ? "about par" : b >= .01 ? "unlucky" : "brutal";
  const sigma = z => `${z >= 0 ? "+" : ""}${z.toFixed(2)}<span class="normal-case">σ</span>`;   // the site's caps would make it Σ

  function reading(nums, label) {
    const st = score(nums);
    if (!st) { $("lk-verdict").innerHTML = `<p class="type-ui text-prose-2 normal-case">No usable numbers — they need to be whole numbers from 0 to 1,000,000.</p>`; return; }
    const { rows, k, best, beat, meanP, z, par } = st;
    $("lk-verdict").innerHTML = `
      <div class="lk-vhead"><span class="type-subsection-title text-prose"></span><span class="type-meta text-prose-3 normal-case">${fmt(k)} roll${k === 1 ? "" : "s"} · ${days(k)}</span></div>
      <dl class="polished-card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5 lk-tiles">
        ${tile("Best roll", `${compact(best.ep)} EP`, `<a class="underline hover:text-prose" href="/n/${best.n}">${fmt(best.n)}</a> · ${(100 * best.p).toFixed(3)}th percentile`, pillOf(tierIdx(best.ep)))}
        ${tile("Luckier than", pct(beat), `of players with ${fmt(k)} rolls — <b class="text-prose-2">${verdictOf(beat)}</b>`)}
        ${tile(`Par for ${fmt(k)} rolls`, `${compact(par)} EP`, "what a median player's best would be", pillOf(tierIdx(par)))}
        ${tile("Overall drift", sigma(z), `mean percentile ${(100 * meanP).toFixed(1)} against 50 expected`)}
      </dl>
      <div class="lk-strip" title="Every roll by percentile, worst on the left">${rows.slice().sort((a, b) => a.p - b.p).map(r =>
        `<i style="left:${(100 * r.p).toFixed(3)}%;background:${tiers[tierIdx(r.ep)].accent}" title="${fmt(r.n)} · ${fmt(r.ep)} EP · ${(100 * r.p).toFixed(2)}th percentile"></i>`).join("")}</div>
      <div class="lk-stripax type-meta text-prose-3 normal-case"><span>worst possible</span><span>median</span><span>best possible</span></div>
      <div class="pr-table-wrap rounded-lg border border-outline bg-surface overflow-x-auto mt-4"><table class="pr-table">
        <thead><tr><th>Roll</th><th>Tier</th><th>Percentile</th><th>EP</th></tr></thead>
        <tbody>${rows.slice(0, LUCK_ROWS).map(r => `<tr><td class="pr-num"><a href="/n/${r.n}">${fmt(r.n)}</a></td><td>${pillOf(tierIdx(r.ep))}</td><td class="pr-dim">${(100 * r.p).toFixed(2)}th</td><td class="pr-ep">${fmt(r.ep)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${rows.length > LUCK_ROWS ? `<p class="type-meta text-prose-3 normal-case mt-2">The best ${LUCK_ROWS} of ${fmt(rows.length)}.</p>` : ""}`;
    $("lk-verdict").querySelector(".lk-vhead span").textContent = label;
  }

  // A player's rolls come through the site's own proxy (profile.js's fetchRolls),
  // scored here against the table rather than trusting the API's totals.
  async function loadPlayer(u) {
    const r = await fetchRolls(u);
    if (r.error) throw new Error(r.error);
    return { username: r.username, nums: r.rolls.map(x => x.number) };
  }
  // Several names rank the players against each other rather than pooling
  // their rolls — pooling is what /u does, and "who got luckier" only means
  // anything per player.
  async function compare(names) {
    const loaded = await Promise.all(names.map(u => loadPlayer(u).then(p => ({ ...p, st: score(p.nums) })).catch(e => ({ username: u, error: e.message }))));
    const ok = loaded.filter(p => p.st).sort((a, b) => b.st.beat - a.st.beat), bad = loaded.filter(p => !p.st);
    if (!ok.length) { $("lk-verdict").innerHTML = `<p class="type-ui text-prose-2 normal-case">${escHtml(bad.map(p => p.error || `${p.username} has no rolls yet`).join("; "))}</p>`; return; }
    $("lk-verdict").innerHTML = `
      <div class="lk-vhead"><span class="type-subsection-title text-prose">${ok.length} players</span><span class="type-meta text-prose-3 normal-case">ranked by how lucky their best roll was</span></div>
      <div class="pr-table-wrap rounded-lg border border-outline bg-surface overflow-x-auto"><table class="pr-table">
        <thead><tr><th>Player</th><th>Rolls</th><th>Best</th><th>Luckier than</th><th>Verdict</th><th>Drift</th></tr></thead>
        <tbody>${ok.map(p => `<tr class="lk-player" data-u="${escHtml(p.username)}" title="Click for the full reading">
          <td class="pr-who"><a href="/u/${escHtml(p.username)}">${escHtml(p.username)}</a></td><td class="pr-dim">${fmt(p.st.k)}</td>
          <td class="pr-ep">${compact(p.st.best.ep)}</td><td class="pr-ep">${pct(p.st.beat)}</td><td class="pr-dim">${verdictOf(p.st.beat)}</td><td class="pr-dim">${sigma(p.st.z)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="type-meta text-prose-3 normal-case mt-2">Click a row for that player's full reading.${bad.length ? ` Couldn't load ${escHtml(bad.map(p => p.username).join(", "))}.` : ""}</p>`;
    for (const tr of $("lk-verdict").querySelectorAll(".lk-player")) {
      tr.addEventListener("click", e => {
        if (e.target.closest("a")) return;                     // the name goes to the profile
        const p = ok.find(x => x.username === tr.dataset.u);
        reading(p.nums, p.username);
      });
    }
  }
  let lookup = null;                                            // the names in flight, so a stale answer is dropped
  async function players(names) {
    const key = names.join(",");
    lookup = key;
    $("lk-user").value = names.join(", ");
    $("lk-verdict").innerHTML = `<div class="flex items-center gap-3 type-ui text-prose-2 normal-case"><span class="an-spinner" aria-hidden="true"></span>Loading ${escHtml(names.join(", "))}…</div>`;
    try {
      if (names.length > 1) { await compare(names); return; }
      const p = await loadPlayer(names[0]);
      if (lookup !== key) return;
      reading(p.nums, p.username);
    } catch (err) {
      if (lookup === key) $("lk-verdict").innerHTML = `<p class="type-ui text-prose-2 normal-case">${escHtml(err.message)}</p>`;
    }
  }

  /* --- controls --------------------------------------------------------------------------- */
  $("lk-rolls").addEventListener("input", e => { if (ready) bestOfN(sliderToN(Number(e.target.value))); });
  $("lk-n").addEventListener("change", e => {
    const n = Math.min(LUCK_MAX_ROLLS, Math.max(1, parseInt(e.target.value.replace(/\D/g, ""), 10) || 1));
    if (ready) bestOfN(n);
  });
  // The lookup form routes to /luck/<names>, so a typed name and a shared link
  // land in the same place; several names, comma-separated, compare.
  $("lk-user-form").addEventListener("submit", e => {
    e.preventDefault();
    const names = parseUsernames($("lk-user").value).slice(0, LUCK_MAX_PLAYERS);
    if (names.length) navigate(`/luck/${names.join(",")}`);
  });
  $("lk-paste-go").addEventListener("click", () => {
    if (!ready) return;
    const nums = ($("lk-paste").value.match(/\d+/g) || []).map(Number);
    reading(nums, "Pasted rolls");
    if (location.pathname !== "/luck") history.replaceState(null, "", "/luck");
  });

  /* --- loading ------------------------------------------------------------------------------ */
  function status(text) {
    $("lk-status").hidden = !text;
    $("lk-status-text").textContent = text || "";
  }
  async function start() {
    if (started) return;
    started = true;
    try {
      status("Loading the EP index…");
      const t = await getTable();
      status("Sorting every score…");
      await new Promise(r => setTimeout(r));
      if (!tierOfN) deriveTiers(t);
      S = t.slice().sort(); N = S.length;
      lgMin = Math.floor(Math.log10(Math.max(1, S[0])));
      lgMax = Math.log10(S[N - 1]);
      tiers = TIERS.map((T, i) => ({ key: T.key, label: T.label, accent: T.accent, lo: i ? tierCut[i - 1] : 0 }));
      ready = true;
      status("");
      $("lk-body").hidden = false;
      let sum = 0; for (let i = 0; i < N; i++) sum += S[i];
      $("lk-stat").textContent = fmt(quantile(.5));
      $("lk-head").innerHTML =
        tile("Median roll", `${fmt(quantile(.5))} EP`, "half of all numbers score less", pillOf(tierIdx(quantile(.5)))) +
        tile("Mean roll", `${fmt(Math.round(sum / N))} EP`, "dragged up by the tail") +
        tile("Top 1% starts at", `${fmt(quantile(.99))} EP`, "the 99th percentile") +
        tile("Best possible", `${compact(S[N - 1])} EP`, "one number in the whole range");
      bestOfN(50); milestones();
      if (pending) players(pending);
    } catch (err) {
      started = false;
      status(`Could not load the EP index: ${err && err.message || err}`);
    }
  }
  // The router's entry: /luck, or /luck/<names> for a reading. Before the table
  // lands the names are remembered and looked up once it does.
  function show(names) {
    pending = names && names.length ? names : null;
    if (!ready) { start(); return; }
    if (pending) players(pending);
  }
  return { show };
})();

function showLuck(names) { LUCK.show(names); }

// showView (ep.js) calls showLuck() when the tab is opened; ep.js has already
// routed by the time this file runs, so a cold load starts itself.
if (!document.getElementById("view-luck").hidden) {
  const m = /^\/luck\/([^/]+)$/.exec(location.pathname);
  showLuck(m ? parseUsernames(decodeURIComponent(m[1])).slice(0, LUCK_MAX_PLAYERS) : null);
}
