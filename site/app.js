// Uses ENGINE and RARITY, loaded by engine-shim.js.

/* --- formatting, matching rngdle's own ------------------------------------ */
const fmt = n => n.toLocaleString("en-US");
const formatPercentile = p => p >= 50
  ? `Top ${Math.round(100 - p) || "<1"}%`
  : `Bottom ${Math.round(p) || "<1"}%`;
const percentileColor = p =>
  p >= 95 ? "text-yellow-500" : p >= 80 ? "text-green-500"
  : p >= 50 ? "text-emerald-500" : p >= 20 ? "text-orange-500" : "text-red-500";

// ponytail: badge-card glow is a small separate map on rngdle; only the uncommon
// and rare values were observable, the rest follow the same ramp.
const BADGE_GLOW = {
  trash: "", common: "",
  uncommon: "shadow-[0_0_10px_rgba(16,185,129,0.25)]",
  rare: "shadow-[0_0_12px_rgba(59,130,246,0.3)]",
  epic: "shadow-glow-epic",
  anomaly: "shadow-glow-anomaly",
  mythic: "shadow-glow-mythic",
};

// Six digit slots, except for the one 7-digit roll: 1000000. rngdle sizes the
// card the same way — `d = Math.max(6, digitCount)`.
const MIN_SLOTS = 6;
const slotsFor = numStr => Math.max(MIN_SLOTS, numStr.length);
const el = id => document.getElementById(id);
const h = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

/* --- number card ---------------------------------------------------------- */
// The card is built ONCE and then mutated in place. Rebuilding it per frame
// would destroy every span, so `transition-all duration-500` on the digits
// would never run, `digit-settle` would restart, and `breathing` would reset
// ten times a second — which is exactly what makes a roll look choppy.
// No animate-breathing here: rngdle gates it on `!spinning && !pulsing`, so it
// is applied per-paint below rather than being permanent.
const CARD_BASE = "relative overflow-hidden inline-flex items-center justify-center px-8 py-5 rounded-xl border-3 bg-gradient-to-br transition-all duration-500";
const ROW_BASE = "relative z-10 font-roll font-bold tabular-nums flex items-center transition-all duration-500 [text-shadow:0_1px_2px_rgba(255,255,255,0.5)] dark:[text-shadow:0_1px_2px_rgba(255,255,255,0.2)]";
const DIGIT_BASE = "inline-block transition-all duration-500";

// Only touch the DOM when the value actually changes — a redundant className
// write is a wasted style recalc, and can restart a running animation.
const setClass = (node, cls) => { if (node.className !== cls) node.className = cls; };
const setText = (node, txt) => { if (node.textContent !== txt) node.textContent = txt; };

function createCard() {
  const card = h(`
    <div class="${CARD_BASE}">
      <div class="absolute -inset-px overflow-hidden pointer-events-none rounded-xl dark:opacity-40" style="background: linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 40%, transparent 60%);"></div>
      <div class="absolute -inset-px overflow-hidden pointer-events-none rounded-xl dark:opacity-10">
        <div class="absolute inset-0" style="background: linear-gradient(105deg, transparent 0%, transparent 40%, rgba(255,255,255,0.35) 50%, transparent 60%, transparent 100%) 0% 0% / 200% 100%; animation: 4s ease-in-out 0s infinite normal none running gem-shimmer;"></div>
      </div>
      <div class="${ROW_BASE}"></div>
    </div>`);
  return { card, row: card.lastElementChild, spans: [] };
}

// Grow the digit row on demand — still never rebuilding the spans that exist.
function ensureSpans(view, n) {
  while (view.spans.length < n) {
    const s = document.createElement("span");
    s.className = DIGIT_BASE;
    view.row.appendChild(s);
    view.spans.push(s);
  }
}

// digits: [{char, blank, revealed, spinning, settled}]
// rngdle's card, transcribed:
//   spinning              -> animate-attention-glow
//   pulsing               -> animate-finale-pulse
//   !spinning && !pulsing -> animate-breathing
//   pulsing && rarity     -> inline RARITY_FINALE_GLOW box-shadow
// The card pulses twice per roll: once when the digits land (still neutral, so
// no glow) and again when the rank is revealed (with the rarity glow) — that
// second one is the pop.
function paintCard(view, digits, tier, opts = {}) {
  const style = tier ? RARITY.RARITY_ARTIFACT_STYLES[tier] : RARITY.NEUTRAL_ARTIFACT_STYLE;
  const spinning = digits.some(d => d.spinning);
  const anyRevealed = digits.some(d => d.revealed && !d.blank);
  const pulsing = !!opts.pulsing;
  setClass(view.card, [
    CARD_BASE, style.border, style.background, style.glow,
    style.innerGlow.replace("shadow-inner ", ""), style.shadow,
    spinning ? "animate-attention-glow" : "",
    pulsing ? "animate-finale-pulse" : "",
    !spinning && !pulsing && anyRevealed ? "animate-breathing" : "",
    opts.extra || "",
  ].join(" ").replace(/\s+/g, " ").trim());

  const glow = pulsing && tier ? RARITY.RARITY_FINALE_GLOW[tier] : "";
  if (view.card.style.boxShadow !== glow) view.card.style.boxShadow = glow;

  const shown = digits.filter(d => !(d.blank && d.revealed)).length;
  const size = shown <= 3 ? "text-7xl" : shown === 4 ? "text-6xl" : shown === 5 ? "text-5xl" : "text-4xl";
  setClass(view.row, `${ROW_BASE} ${size}`);

  ensureSpans(view, digits.length);
  digits.forEach((d, i) => {
    const cls = [DIGIT_BASE];
    if (d.spinning) cls.push("animate-digit-spin", "text-gray-200", "dark:text-zinc-500");
    if (d.blank && d.revealed) cls.push("w-0", "opacity-0", "overflow-hidden");
    else if (!d.blank && d.revealed) cls.push(style.textColor);
    if (d.settled) cls.push("animate-digit-settle");
    setClass(view.spans[i], cls.join(" "));
    setText(view.spans[i], d.blank && d.revealed ? " " : d.char);
  });
  // Park any slots this number doesn't need (going 7 digits -> 6).
  for (let i = digits.length; i < view.spans.length; i++) {
    setClass(view.spans[i], `${DIGIT_BASE} w-0 opacity-0 overflow-hidden`);
    setText(view.spans[i], "");
  }
}

const digitsOf = numStr => {
  const slots = slotsFor(numStr);
  const pad = slots - numStr.length;
  return [...Array(slots)].map((_, i) => ({
    char: i < pad ? "" : numStr[i - pad], blank: i < pad, revealed: true,
  }));
};

/* --- badge digit diagram -------------------------------------------------- */
// rngdle's NumberMiniDiagram, transcribed. The contributor chips are not simply
// painted in: every badge card plays a staggered intro as it appears, and then
// replays the highlight on a loop for as long as the result is on screen.
//
//   intro   set every chip to the resting colours, then 0.2s per contributor
//           chip, power2.out, 0.08s apart — starting 300*index + 100ms after
//           the card mounts
//   loop    0.4s back to the resting colours (0.08s apart), a 0.1s beat, 0.4s
//           back to the highlight (0.08s apart), then 4s of rest, forever
//
// Chips are tinted per group, not all one colour: `groups` contributors take
// rngdle's four GROUP_HIGHLIGHT_COLORS, and the pair/trip badges alternate the
// rarity's primary and secondary over runs of the same digit — or over the odd
// and even digits, for ALTERNATOR. MOUNTAIN and VALLEY ripple outwards from
// their middle digit instead of sweeping left to right.
//
// Upstream this is GSAP; here it is the same timelines on the rAF tween this
// file already has for the roll.
const GROUP_HIGHLIGHT_COLORS = [
  { bg: "#93C5FD", border: "#2563EB" },
  { bg: "#86EFAC", border: "#059669" },
  { bg: "#FCD34D", border: "#D97706" },
  { bg: "#F9A8D4", border: "#DB2777" },
];
const MULTI_COLOR_BADGES = new Set([
  "TWO_PAIR", "THREE_PAIR", "CONTIGUOUS_TWO_PAIR", "CONTIGUOUS_THREE_PAIR",
  "FULL_HOUSE", "TRINITY", "ALTERNATOR",
]);
const RIPPLE_BADGES = new Set(["MOUNTAIN", "VALLEY"]);
const PARITY_BADGES = new Set(["ALTERNATOR"]);

const CHIP_INTRO_MS = 200, CHIP_LOOP_MS = 400, CHIP_STAGGER_MS = 80;
const CHIP_GROUP_GAP_MS = 100, CHIP_LOOP_GAP_MS = 100, CHIP_REST_MS = 4000;
const CHIP_CARD_DELAY_MS = 300, CHIP_START_MS = 100;
const CHIP_PROPS = ["backgroundColor", "color", "borderColor"];
const CHIP_BASE = "inline-flex items-center justify-center w-5 h-6 rounded-sm text-xs font-bold transition-colors duration-200";

// The resting colours are CSS variables, so they can arrive in any colour syntax
// the browser understands. rngdle normalises them through a 1x1 canvas; same
// here, except the components stay numbers because these get interpolated.
let chipCanvas = null;
function parseColor(value) {
  if (!chipCanvas) chipCanvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  chipCanvas.clearRect(0, 0, 1, 1);
  chipCanvas.fillStyle = "#000";     // so an unparseable value stays black
  chipCanvas.fillStyle = value;
  chipCanvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = chipCanvas.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}
const rgbaString = ([r, g, b, a]) => a >= 1
  ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
  : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;
const mixColor = (a, b, p) => a.map((v, i) => v + (b[i] - v) * p);

const chipResting = () => {
  const s = getComputedStyle(document.documentElement);
  return [
    parseColor(s.getPropertyValue("--surface-raised").trim()),
    parseColor(s.getPropertyValue("--prose-3").trim()),
    parseColor(s.getPropertyValue("--outline").trim()),
  ];
};
const chipHighlight = (bg, border) => [parseColor(bg), [0, 0, 0, 1], parseColor(border)];
const setChip = (node, colors) => CHIP_PROPS.forEach((p, i) => { node.style[p] = rgbaString(colors[i]); });

// A GSAP timeline's worth of colour tweens: each step carries its own start
// offset, so a stagger is just `i * 80`. `from` is read when the step starts,
// not when the timeline is built — that is what GSAP does, and it matters
// because the chips also carry a 200ms CSS colour transition.
function chipTimeline() {
  const steps = [];
  let raf = 0, dead = false;
  return {
    add(node, at, dur, to) { steps.push({ node, at, dur, to, from: null, done: false }); return this; },
    play(onDone) {
      const total = steps.reduce((m, s) => Math.max(m, s.at + s.dur), 0);
      const t0 = performance.now();
      const frame = now => {
        if (dead) return;
        const t = now - t0;
        for (const s of steps) {
          if (s.done || t < s.at) continue;
          if (!s.from) { const cs = getComputedStyle(s.node); s.from = CHIP_PROPS.map(p => parseColor(cs[p])); }
          const raw = Math.min(1, (t - s.at) / s.dur);
          const p = EASE.power2Out(raw);
          CHIP_PROPS.forEach((prop, i) => { s.node.style[prop] = rgbaString(mixColor(s.from[i], s.to[i], p)); });
          s.done = raw >= 1;
        }
        if (t < total) raf = requestAnimationFrame(frame);
        else { dead = true; onDone?.(); }
      };
      raf = requestAnimationFrame(frame);
      return this;
    },
    kill() { dead = true; cancelAnimationFrame(raf); },
  };
}

// Split contributor indices into the runs the two-tone badges colour: digits
// that share a value, in first-seen order — or the evens and the odds for
// ALTERNATOR, led by whichever the first contributor is.
function digitRuns(numStr, indices, badgeId) {
  if (badgeId && PARITY_BADGES.has(badgeId)) {
    const even = [], odd = [];
    for (const i of indices) (parseInt(numStr[i], 10) % 2 === 0 ? even : odd).push(i);
    const evenFirst = indices.length > 0 && parseInt(numStr[indices[0]], 10) % 2 === 0;
    return (evenFirst ? [even, odd] : [odd, even]).filter(g => g.length > 0);
  }
  const byDigit = new Map(), order = [];
  for (const i of indices) {
    const ch = numStr[i];
    if (!byDigit.has(ch)) { byDigit.set(ch, []); order.push(ch); }
    byDigit.get(ch).push(i);
  }
  return order.map(ch => byDigit.get(ch));
}

// Every index a badge lights up, in reading order — this is what decides the
// chips' static classes.
function contributorIndices(contributors, len) {
  const out = [];
  if (!contributors) return out;
  const c = contributors;
  if (c.type === "groups") { for (const g of c.groups) for (const i of g) if (i >= 0 && i < len) out.push(i); }
  else if (c.type === "indices") { for (const i of c.indices) if (i >= 0 && i < len) out.push(i); }
  else if (c.type === "range") { for (let i = c.start; i < c.end && i < len; i++) out.push(i); }
  else if (c.type === "whole") { for (let i = 0; i < len; i++) out.push(i); }
  return out;
}

// The animated set, in the order the stagger walks it, with the per-chip colours
// the tinted badges override. Recomputed per replay, as rngdle does.
function contributorParts(spans, numStr, contributors, hi, multi, badgeId) {
  const elements = [], colorMap = new Map(), borderColorMap = new Map();
  if (!contributors || !spans.length) return { elements, colorMap, borderColorMap };
  const c = contributors;
  if (c.type === "groups") {
    c.groups.forEach((g, gi) => {
      const col = GROUP_HIGHLIGHT_COLORS[gi % GROUP_HIGHLIGHT_COLORS.length];
      for (const i of g) if (i >= 0 && i < spans.length) {
        elements.push(spans[i]);
        colorMap.set(spans[i], col.bg);
        borderColorMap.set(spans[i], col.border);
      }
    });
  } else if (c.type === "indices") {
    const idx = c.indices.filter(i => i >= 0 && i < spans.length);
    for (const i of idx) elements.push(spans[i]);
    if (multi && idx.length) digitRuns(numStr, idx, badgeId).forEach((g, gi) => {
      const col = [hi.primary, hi.secondary][gi % 2];
      for (const i of g) colorMap.set(spans[i], col);
    });
  } else if (c.type === "range") {
    for (let i = c.start; i < c.end && i < spans.length; i++) elements.push(spans[i]);
  } else if (c.type === "whole") {
    elements.push(...spans);
  }
  return { elements, colorMap, borderColorMap };
}

// MOUNTAIN and VALLEY ripple out from the middle contributor — the peak or the
// dip, which is the digit the badge is about.
function rippleCenter(contributors, numStr) {
  const c = contributors;
  if (!c) return 0;
  if (c.type === "range") return Math.floor((c.start + c.end - 1) / 2);
  if (c.type === "groups") {
    const flat = c.groups.flat();
    if (flat.length > 0) { const s = [...flat].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
  }
  if (c.type === "indices" && c.indices.length > 0) {
    const s = [...c.indices].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  return c.type === "whole" ? Math.floor(numStr.length / 2) : 0;
}

// Live diagrams, so a re-render can stop the ones it is about to throw away —
// their loops would otherwise keep painting detached nodes forever.
let chipAnims = [];
function stopChipAnims() { for (const a of chipAnims) a.stop(); chipAnims = []; }

function digitDiagram(numStr, contributors, tier, badgeId) {
  const hi = RARITY.RARITY_PALETTE[tier].highlight;
  const multi = MULTI_COLOR_BADGES.has(badgeId);
  const active = new Set(contributorIndices(contributors, numStr.length));
  const wrap = h('<div class="inline-flex items-center gap-1 font-mono"></div>');
  const resting = chipResting();
  const spans = [...numStr].map((ch, i) => {
    const s = document.createElement("span");
    s.className = `${CHIP_BASE} ${active.has(i) ? "border" : "bg-surface-dim dark:bg-surface-raised text-prose-3 dark:text-prose-3"}`;
    s.textContent = ch;
    // rngdle leaves the chips unstyled until the intro's gsap.set lands, which
    // flashes a bare border for up to 300*index+100ms. Same colours, applied now.
    setChip(s, resting);
    wrap.appendChild(s);
    return s;
  });

  let tl = null, timer = null, started = false;
  const parts = () => contributorParts(spans, numStr, contributors, hi, multi, badgeId);
  const stop = () => { tl?.kill(); tl = null; clearTimeout(timer); timer = null; };

  const loop = () => {
    const { elements, colorMap, borderColorMap } = parts();
    if (!elements.length) return;
    tl?.kill();
    tl = chipTimeline();
    const rest = chipResting();
    elements.forEach((n, i) => tl.add(n, CHIP_STAGGER_MS * i, CHIP_LOOP_MS, rest));
    const back = CHIP_STAGGER_MS * (elements.length - 1) + CHIP_LOOP_MS + CHIP_LOOP_GAP_MS;
    elements.forEach((n, i) => tl.add(n, back + CHIP_STAGGER_MS * i, CHIP_LOOP_MS,
      chipHighlight(colorMap.get(n) || hi.primary, borderColorMap.get(n) || hi.border)));
    tl.play(() => { timer = setTimeout(loop, CHIP_REST_MS); });
  };

  const intro = () => {
    const rest = chipResting();
    for (const s of spans) setChip(s, rest);
    const { elements, colorMap } = parts();
    if (!elements.length) return;          // nothing to light up, so no loop either
    tl?.kill();
    tl = chipTimeline();
    let at = 0;
    if (contributors.type === "groups") {
      contributors.groups.forEach((g, gi) => {
        const col = GROUP_HIGHLIGHT_COLORS[gi % GROUP_HIGHLIGHT_COLORS.length];
        g.forEach((idx, j) => {
          if (idx >= 0 && idx < spans.length)
            tl.add(spans[idx], at + CHIP_STAGGER_MS * j, CHIP_INTRO_MS, chipHighlight(col.bg, col.border));
        });
        at += CHIP_STAGGER_MS * g.length + CHIP_GROUP_GAP_MS;
      });
    } else if (colorMap.size > 0) {
      // Only the two-tone `indices` badges reach here; `groups` was handled above.
      const idx = contributors.indices.filter(i => i >= 0 && i < spans.length);
      digitRuns(numStr, idx, badgeId).forEach((g, gi) => {
        const col = [hi.primary, hi.secondary][gi % 2];
        g.forEach((i, j) => tl.add(spans[i], at + CHIP_STAGGER_MS * j, CHIP_INTRO_MS, chipHighlight(col, hi.border)));
        at += CHIP_STAGGER_MS * g.length + CHIP_GROUP_GAP_MS;
      });
    } else if (RIPPLE_BADGES.has(badgeId)) {
      const mid = rippleCenter(contributors, numStr);
      for (const i of contributorIndices(contributors, spans.length))
        tl.add(spans[i], CHIP_STAGGER_MS * Math.abs(i - mid), CHIP_INTRO_MS, chipHighlight(hi.primary, hi.border));
    } else {
      elements.forEach((n, i) => tl.add(n, CHIP_STAGGER_MS * i, CHIP_INTRO_MS, chipHighlight(hi.primary, hi.border)));
    }
    tl.play(() => { timer = setTimeout(loop, CHIP_REST_MS); });
  };

  const anim = {
    wrap,
    // `index` is the card's place in the list, top-down, exactly as rngdle
    // passes it: the newest card is index 0, so during a roll every card starts
    // its intro 100ms after it lands.
    start(index) {
      if (started) return;
      started = true;
      timer = setTimeout(intro, CHIP_CARD_DELAY_MS * index + CHIP_START_MS);
    },
    stop,
  };
  chipAnims.push(anim);
  return anim;
}

/* --- the other badge footers ---------------------------------------------- */
// Not every badge points at digits. Four are about divisibility and one is
// about factors, and for those rngdle replaces the chip row with the sum
// itself — so they never animate. HARSHAD divides by its own digit sum, which
// is why the table stores a marker rather than a number.
const DIVISOR_BADGES = { ELEVEN: 11, DOZEN: 12, LUCKY_SEVEN_DIV: 7, HARSHAD: "digit_sum" };
const sumDigits = numStr => [...numStr].reduce((a, c) => a + Number(c), 0);
const divisorFor = (id, numStr) => {
  const d = DIVISOR_BADGES[id];
  return d === "digit_sum" ? sumDigits(numStr) : d;
};

const part = (cls, text) => {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
};
const tintedPart = (colour, text) => {
  const s = document.createElement("span");
  s.style.color = colour;
  s.textContent = text;
  return s;
};

// "121,212 = 12 × 10,101" — the number plain, the divisor emerald, the
// quotient in the info blue. rngdle formats the number and the quotient with
// separators but leaves the divisor bare.
function divisorDiagram(numStr, divisor) {
  const n = Number(numStr);
  const row = h('<div class="type-data type-meta text-prose-2"></div>');
  row.append(
    part("text-prose", fmt(n)),
    part("text-prose-3", " = "),
    part("text-emerald-600 dark:text-emerald-400", String(divisor)),
    part("text-prose-3", " × "),
    part("text-info", fmt(Math.floor(n / divisor))),
  );
  return row;
}

// A pronic number is k(k+1), so rngdle solves for k and prints both factors.
// Neither factor gets separators upstream — for a six-digit roll k is ~1000, so
// it never shows, but keep it exact.
function pronicDiagram(numStr) {
  const n = Number(numStr);
  const k = Math.floor((-1 + Math.sqrt(1 + 4 * n)) / 2);
  const row = h('<div class="type-data type-meta text-prose-2"></div>');
  row.append(
    part("text-prose", fmt(n)),
    part("text-prose-3", " = "),
    part("text-emerald-600 dark:text-emerald-400", String(k)),
    part("text-prose-3", " × "),
    part("text-info", String(k + 1)),
  );
  return row;
}

// EQUATION is the one badge that gets a diagram AND a line under it: the digits
// split into `a op b = c`. Its three parts are tinted with the first three
// GROUP_HIGHLIGHT_COLORS borders, so they name the chip groups directly above.
const EQUATION_OPS = { "+": "+", "-": "−", "*": "×", "/": "÷" };
function equationDiagram(numStr) {
  const eq = DIGITS.findEquation(numStr);
  if (!eq) return null;
  const [a, b, c] = eq.numbers;
  const row = h('<div class="type-data type-meta text-prose-2 mt-2"></div>');
  row.append(
    tintedPart(GROUP_HIGHLIGHT_COLORS[0].border, fmt(a)),
    part("text-prose-3", ` ${EQUATION_OPS[eq.op]} `),
    tintedPart(GROUP_HIGHLIGHT_COLORS[1].border, fmt(b)),
    part("text-prose-3", " = "),
    tintedPart(GROUP_HIGHLIGHT_COLORS[2].border, fmt(c)),
  );
  return row;
}

/* --- badge cards ---------------------------------------------------------- */
// rngdle keeps only the highest-EP badge per family; the rest are still earned
// but score nothing, because the higher tier already implies them. Group them so
// the superseded ones nest under the one that actually scored.
//
// The family tag comes from rngdle's own BADGE_DEFINITIONS: 39 families, 168
// members, 65 standalone badges. That was cross-checked member-for-member
// against the FAMILIES list in CubityFirst/rngdle-ep-calculator when it was 159
// members; on 2026-09-05 rngdle put CLEAN / CENTURY / MILLENNIUM / EPOCH / EON
// and the four SEMI_ badges into the DEEP_VOIDs' VOID_DEPTH family, so a round
// number now scores only its deepest zero-run badge.
function badgeGroups(badges) {
  const groups = [];
  const byFamily = new Map();
  for (const b of badges) {
    if (!b.family) { groups.push({ lead: b, rest: [] }); continue; }
    let g = byFamily.get(b.family);
    if (!g) { g = { lead: null, rest: [] }; byFamily.set(b.family, g); groups.push(g); }
    // Trust isScoring rather than list order — on an EP tie rngdle keeps the
    // first, which sorting alone would not tell us.
    if (b.isScoring && !g.lead) g.lead = b; else g.rest.push(b);
  }
  for (const g of groups) if (!g.lead) g.lead = g.rest.shift();   // shouldn't happen
  for (const g of groups) g.rest.sort((a, b) => b.score - a.score);
  return groups.filter(g => g.lead).sort((a, b) => b.lead.score - a.lead.score);
}

// A superseded family member: one thin row, no EP pill. Markup taken from
// rngdle's own rendering of the same thing.
function supersededRow(badge) {
  const row = h(`
    <div class="ml-4 rounded-lg px-3 py-2 bg-surface-raised/50">
      <div class="flex items-center gap-2">
        <span class="type-meta text-prose-3">└</span>
        <span class="text-sm flex-shrink-0 opacity-70"></span>
        <span class="type-meta font-medium text-prose-3"></span>
        <span class="type-meta text-prose-3 italic ml-auto">(earned)</span>
      </div>
    </div>`);
  const [, emoji, label] = row.firstElementChild.children;
  emoji.textContent = badge.emoji || "✨";
  label.textContent = badge.label;
  row.title = `Superseded — worth ${fmt(badge.score)} EP on its own`;
  return row;
}

function badgeGroupEl(group, numStr) {
  const wrap = h('<div class="space-y-1"></div>');
  const card = badgeCard(group.lead, numStr);
  wrap.appendChild(card);
  // The diagram's intro starts when the card appears, so the reveal needs to
  // reach it from the list entry it unhides.
  wrap._chipAnim = card._chipAnim;
  for (const b of group.rest) wrap.appendChild(supersededRow(b));
  // Only the scoring badge contributes; revealBadges reads this back.
  wrap.dataset.ep = group.lead.isScoring ? group.lead.score : 0;
  return wrap;
}

function badgeCard(badge, numStr) {
  const tier = RARITY.getBadgeRarityTier(badge.score);
  const pill = RARITY.RARITY_PALETTE[tier].pill;
  // A badge can be earned but score nothing: rngdle keeps only the highest
  // badge per family, so the rest are listed at +0 EP.
  const ep = badge.isScoring
    ? `<span class="type-data inline-flex items-center font-semibold whitespace-nowrap flex-shrink-0 bg-ep-surface text-ep border border-ep-outline rounded-full px-2 py-0.5 text-xs">+${fmt(badge.score)} EP</span>`
    : `<span class="type-data inline-flex items-center font-semibold whitespace-nowrap flex-shrink-0 bg-surface-dim dark:bg-surface-raised text-prose-3 border border-outline rounded-full px-2 py-0.5 text-xs" title="Superseded by a higher badge in the same family — worth ${fmt(badge.score)} EP on its own">+0 EP</span>`;
  const card = h(`
    <div class="border border-outline rounded-lg px-3 py-2 bg-surface ${badge.isScoring ? BADGE_GLOW[tier] : ""} text-left">
      <div class="flex items-start justify-between gap-2 mb-1">
        <div class="flex items-center gap-2 min-w-0 flex-wrap">
          <span class="text-base flex-shrink-0"></span>
          <span class="type-compact-title text-prose"></span>
          <span class="type-label px-1.5 py-0.5 rounded-sm flex-shrink-0 ${pill.bgClass} ${pill.textClass} ${pill.borderClass}">${pill.label}</span>
        </div>
        ${ep}
      </div>
      <p class="type-meta text-prose-3 mb-2"></p>
      <div class="pt-2 border-t border-outline-subtle"></div>
    </div>`);
  card.querySelector(".text-base").textContent = badge.emoji || "✨";
  card.querySelector(".type-compact-title").textContent = badge.label;
  card.querySelector("p").textContent = badge.description;

  // rngdle picks ONE of three footers, in this order — the divisor badges and
  // PRONIC never show chips at all, and a badge with nothing to point at gets
  // no footer rather than a row of dead grey chips.
  const footer = card.querySelector(".border-t");
  const divisor = divisorFor(badge.id, numStr);
  const contributors = ENGINE.getBadgeContributors(badge.id, Number(numStr));
  if (divisor !== undefined) {
    footer.appendChild(divisorDiagram(numStr, divisor));
  } else if (badge.id === "PRONIC") {
    footer.appendChild(pronicDiagram(numStr));
  } else if (contributors) {
    const diagram = digitDiagram(numStr, contributors, tier, badge.id);
    footer.appendChild(diagram.wrap);
    card._chipAnim = diagram;
    // EQUATION is the one badge that gets the chips AND a line underneath.
    if (badge.id === "EQUATION") {
      const eq = equationDiagram(numStr);
      if (eq) footer.appendChild(eq);
    }
  } else {
    footer.remove();
  }
  return card;
}

/* --- state ---------------------------------------------------------------- */
let value = "";        // current number as a string; "" = nothing yet
let analysis = null;   // ENGINE.composeRollResult(value)
let editing = true;    // showing the ?????? input rather than the finished card
let rolling = false;
let cardView = null;   // built once, reused for every roll and result
let timers = [], spinner = null;
let skipSequence = null;  // set while a roll is animating; jumps to the end
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
  if (spinner !== null) { clearInterval(spinner); spinner = null; }
}

function getCard() {
  if (!cardView) {
    cardView = createCard();
    cardView.card.title = "Click to type a different number";
    cardView.card.addEventListener("click", () => {
      if (rolling) return;          // mid-roll clicks are handled by the skip
      clearTimers();
      stopTweens();
      skipSequence = null;          // this roll's reveal is over
      editing = true;
      render();
    });
  }
  return cardView;
}

/* --- rendering ------------------------------------------------------------ */
// The ?????? is a shimmering display div with a transparent input laid over it,
// so it looks exactly like rngdle's but you can click it and type.
// rngdle's roll page has TWO layouts, not one, and the sandbox was only ever
// using the first. Before a roll the number sits low, 12–15vh down; the moment
// there is a number the whole page switches to a tight `p-2 sm:p-8` container
// and the card moves up under the header. Keeping the pre-roll padding after a
// roll is what left the rolled number stranded halfway down the page.
//
//   pre-roll   main  flex-1 flex flex-col items-center pt-[12vh] sm:pt-[15vh] px-4 sm:px-8 pb-8
//              inner w-full max-w-md sm:max-w-lg flex flex-col items-center text-center
//   rolled     main  flex-1 overflow-y-auto overflow-x-hidden p-2 sm:p-8
//              inner max-w-2xl mx-auto px-4 py-4
//
// Three deliberate differences, all because this shell is not rngdle's. The
// scrolling stays on the page rather than inside the main, since there is a
// footer under it here. The inner keeps `flex flex-col items-center` so ROLL
// AGAIN stays centred — rngdle has no such button, it is one roll a day. And
// the inner stays `max-w-2xl` in BOTH states rather than narrowing to
// `max-w-lg`: type into the ?????? here and the badge breakdown is on screen
// with no roll behind it, which is a state rngdle never has and which its
// narrower pre-roll column would squash.
//
// The padding, which is the part you see, is exact: `sm:p-8` (32px) plus
// `py-4` (16px) puts the card 48px under the header, as measured on rngdle.
const SANDBOX_MAIN_PRE = "flex-1 flex flex-col items-center pt-[12vh] sm:pt-[15vh] px-4 sm:px-8 pb-8";
const SANDBOX_MAIN_ROLLED = "flex-1 flex flex-col items-center p-2 sm:p-8";
const SANDBOX_INNER_PRE = "w-full max-w-2xl flex flex-col items-center text-center";
const SANDBOX_INNER_ROLLED = "w-full max-w-2xl mx-auto px-4 py-4 flex flex-col items-center text-center";

// rngdle switches on `null !== rolledNumber`, so this switches on there being a
// number at all — not on whether the ?????? is being edited. Clicking into a
// finished result to retype it should not throw the page back down to 15vh.
// It is only called from a render and from roll(), never from onInput, so
// clearing the field mid-edit leaves the page where it is instead of making it
// jump under the cursor on every keystroke.
function setSandboxLayout() {
  const main = el("view-sandbox");
  const preRoll = !value && !rolling;
  setClass(main, preRoll ? SANDBOX_MAIN_PRE : SANDBOX_MAIN_ROLLED);
  setClass(main.firstElementChild, preRoll ? SANDBOX_INNER_PRE : SANDBOX_INNER_ROLLED);
}

function renderSlot() {
  const slot = el("slot");
  setSandboxLayout();
  if (editing) {
    const wrap = h(`
      <div class="relative inline-block sandbox-edit">
        <div class="font-roll text-6xl sm:text-7xl font-bold tabular-nums tracking-wider select-none"></div>
        <input id="sandbox-input" type="text" inputmode="numeric" autocomplete="off"
               class="absolute inset-0 font-roll text-6xl sm:text-7xl font-bold tabular-nums tracking-wider"
               aria-label="Enter a number from 0 to 1000000">
      </div>`);
    const display = wrap.firstElementChild;
    display.textContent = value || "??????";
    display.classList.add(value ? "text-prose" : "animate-shimmer");
    showGenerate();   // editing can only happen when nothing is animating
    const input = wrap.querySelector("input");
    input.value = value;
    input.addEventListener("input", onInput);
    // Finishing the edit settles the number into its rarity card, as on rngdle;
    // clicking the card puts you back into editing.
    const settle = () => { if (value && editing && !rolling) { editing = false; render(); } };
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); settle(); } });
    input.addEventListener("blur", () => setTimeout(settle, 0));
    slot.replaceChildren(wrap);
    input.focus();
    input.setSelectionRange(value.length, value.length);
  } else {
    const view = getCard();
    if (!slot.contains(view.card)) slot.replaceChildren(view.card);
    paintCard(view, digitsOf(value), RARITY.getCardRarityTier(analysis.totalScore), { extra: "cursor-text" });
  }
}

/* --- tweening ------------------------------------------------------------- */
// rngdle drives its reveal with GSAP. These are the two easings it uses, and a
// ~20-line rAF tween so the sandbox can match them without pulling in GSAP.
const EASE = {
  // gsap "power2.out"
  power2Out: t => 1 - Math.pow(1 - t, 3),
  // gsap "back.out(s)" — overshoots past 1, which is why rngdle's revealed
  // rarity pill was captured mid-flight at scale(1.0768).
  backOut: s => t => 1 + (t - 1) * (t - 1) * ((s + 1) * (t - 1) + s),
};

const tweens = new Set();
function tween(ms, ease, onUpdate) {
  const start = performance.now();
  let raf = null, done = false;
  const handle = {
    stop() { if (!done) { done = true; cancelAnimationFrame(raf); tweens.delete(handle); } },
    finish() { if (!done) { this.stop(); onUpdate(ease(1), 1); } },
  };
  const step = now => {
    const t = Math.min(1, (now - start) / ms);
    onUpdate(ease(t), t);
    if (t < 1) raf = requestAnimationFrame(step);
    else { done = true; tweens.delete(handle); }
  };
  tweens.add(handle);
  raf = requestAnimationFrame(step);
  return handle;
}
const stopTweens = () => [...tweens].forEach(t => t.stop());

/* --- EP counter ----------------------------------------------------------- */
// Each badge tweens the pill from the running total to the new one over 0.5s
// with power2.out — rngdle's exact per-badge tween.
let epTween = null;
function stopEP() { epTween?.stop(); epTween = null; }

function setEPText(v) {
  const pill = el("ep-pill");
  if (pill) pill.textContent = `${fmt(Math.round(v))} EP`;
}

function tweenEP(from, to) {
  stopEP();
  epTween = tween(EP_TWEEN_MS, EASE.power2Out, p => setEPText(from + (to - from) * p));
}

const generateWrap = () => el("generate-wrap");
function showGenerate() {
  generateWrap().classList.remove("is-away");
  el("generate").disabled = false;
}
function hideGenerate() {
  generateWrap().classList.add("is-away");
  el("generate").disabled = true;
}

const NEUTRAL_PILL = RARITY.RARITY_PALETTE.common.pill;
const epPillHTML = (text, pill) =>
  `<div id="ep-pill" class="type-data inline-flex items-center font-semibold px-3 py-1 rounded-full transition-all duration-500 ${pill.bgClass} ${pill.textClass} ${pill.borderClass}">${text}</div>`;

// staged = mid-roll: rarity and percentile stay hidden until the badges are
// done, the EP pill reads "??? EP" in neutral colours, and the badge cards
// start invisible. Typing a number renders everything at once instead.
function renderResults(staged = false) {
  stopEP();
  stopChipAnims();      // the cards about to be replaced are still looping
  const rarityRow = el("rarity-row"), epRow = el("ep-row"), breakdown = el("breakdown");
  rarityRow.replaceChildren(); epRow.replaceChildren(); breakdown.replaceChildren();
  rarityRow.style.cssText = "";
  el("tagline").hidden = !!value;
  el("hint").hidden = !!value;
  el("generate").textContent = value ? "ROLL AGAIN" : "GENERATE";
  el("share-row").hidden = true;          // revealed with the rank
  el("share-label").textContent = "Share";
  if (!value) return;

  const score = analysis.totalScore;
  const pill = RARITY.RARITY_PALETTE[RARITY.getCardRarityTier(score)].pill;
  const pct = ENGINE.getPercentileForScore(score);

  const rarityEl = h(`<span id="rarity-pill" class="type-label px-2 py-0.5 rounded-sm ${pill.bgClass} ${pill.textClass} ${pill.borderClass}">${pill.label}</span>`);
  const bulletEl = h(`<span class="stats-part text-outline-strong">•</span>`);
  const pctEl = h(`<span class="stats-part type-ui font-medium ${percentileColor(pct)}">${formatPercentile(pct)}</span>`);
  rarityRow.append(rarityEl, bulletEl, pctEl);
  epRow.append(h(epPillHTML(staged ? "??? EP" : `${fmt(score)} EP`, staged ? NEUTRAL_PILL : pill)));

  // rngdle's lifetime row, under the EP pill. It belongs to the reveal, so it
  // only goes in for a roll — a typed number earns nothing and adds nothing.
  if (staged) epRow.append(h(`
    <div id="lifetime-row" class="flex flex-col items-center mt-1 transition-opacity duration-500" style="opacity:0">
      <div class="relative"><span class="type-data font-semibold text-prose-2" id="lifetime-ep">0 EP</span></div>
      <span class="type-meta text-prose-3">Your lifetime EP</span>
    </div>`));

  // The rank row goes in as one piece and pops in as one piece at stats:show,
  // which is how rngdle gates it — the pill and the percentile are not staged
  // apart.
  if (staged) {
    rarityRow.style.opacity = "0";
  } else {
    el("share-row").hidden = false;
  }

  const badges = analysis.badges;   // rngdle lists every badge earned, scoring or not
  const summary = h(`
    <div class="text-center pt-2 mb-2">
      <h2 class="type-section-title text-prose">Badge Breakdown</h2>
      <div id="badge-count" class="type-meta text-prose-3"><span class="font-semibold text-prose-2">${badges.length} badge${badges.length === 1 ? "" : "s"} earned</span></div>
    </div>`);
  breakdown.append(summary);
  if (staged) summary.querySelector("#badge-count").style.opacity = "0";

  const list = h('<div id="badge-list" class="space-y-3"></div>');
  for (const g of badgeGroups(badges)) list.appendChild(badgeGroupEl(g, value));
  breakdown.appendChild(list);
  // The entry tween is per CARD, not per group: rngdle gives the badge card and
  // each superseded row under it its own fromTo. They start together, so it
  // looks the same, but the group wrapper itself never moves.
  if (staged) for (const c of list.children) {
    c.hidden = true;                 // not just transparent: it must not hold space
    for (const row of c.children) row.style.cssText = `opacity:0;transform:${CARD_ENTER_FROM}`;
  }
  // Typing a number mounts every card at once, so the diagrams cascade down the
  // list on rngdle's 300ms-per-card delay. A staged roll starts each one as its
  // card lands instead.
  else [...list.children].forEach((c, i) => c._chipAnim?.start(i));
}

const render = () => { renderSlot(); renderResults(); };

function setValue(v) {
  value = v;
  analysis = v === "" ? null : ENGINE.composeRollResult(Number(v));
  return analysis;
}

function onInput(e) {
  let v = e.target.value.replace(/[^0-9]/g, "").slice(0, 7);
  if (v.length > 1) v = v.replace(/^0+/, "") || "0";
  if (Number(v) > 1000000) v = "1000000";
  e.target.value = v;
  const display = e.target.previousElementSibling;
  display.textContent = v || "??????";
  display.classList.toggle("animate-shimmer", !v);
  display.classList.toggle("text-prose", !!v);
  setValue(v);
  renderResults();
}

/* --- roll animation ------------------------------------------------------- */
// This is rngdle's own reveal schedule, transcribed from its roll page:
//
//   let r = 2000
//   for (e = 1; e <= d; e++) { at(r, `digits:reveal-${e}`)
//                              if (e < d) r += 1000 + 1000*((e-1)/(d-1))**2 }
//   at(r,        "number:collapse")
//   r += 1000;   badges, gap = 500 + 1000*(i/(n-1))**1.5
//                each tweens the EP pill 0.5s with power2.out
//   at(r+=1500,  "summary:show")
//   at(r+=1000,  "rarity:reveal")
//   at(r+=250,   "stats:show")
//
// So the rarity and percentile land ~2.75s AFTER the last badge, not with the
// number — and the card stays neutral until then. Digit gaps work out to
// 1000/1040/1160/1360/1640 for six digits, matching the 3002/4049/5205/6563/8203
// landings sampled off the live site.
// rngdle darkens the edges of the whole screen for the length of a roll — a
// fixed radial gradient over everything, fading in and out over 600ms. It goes
// up on the click and comes down at "reveal:end", the last step of the reveal.
const setVignette = on => el("vignette").classList.toggle("opacity-0", !on);

// The tail of rngdle's schedule, past the percentile:
//
//   totalEP:show      stats:show + 1000    the lifetime row fades in
//   totalEP:animate   +1500                counts up over 1.5s, power2.out,
//                                          with a +N floating off the total
//   reveal:end        +2000                the vignette lifts
//
// rngdle counts a signed-in player's lifetime EP. There are no accounts here,
// so the sandbox keeps its own running total in localStorage instead — every
// roll you take on this machine, added up. Typing a number is not a roll and
// does not count, which is also how rngdle treats it: it has no way to type one.
const LIFETIME_KEY = "lifetime-ep";   // the timings live with the rest of the schedule

const lifetimeEP = () => {
  try { return Number(localStorage.getItem(LIFETIME_KEY)) || 0; } catch { return 0; }
};
const saveLifetimeEP = v => {
  try { localStorage.setItem(LIFETIME_KEY, String(v)); } catch { /* private mode */ }
};

const setLifetimeText = v => setText(el("lifetime-ep"), `${fmt(Math.round(v))} EP`);
function showLifetimeRow(total) {
  const row = el("lifetime-row");
  if (!row) return;
  setLifetimeText(total);
  row.style.opacity = "1";     // the row carries transition-opacity duration-500
}

// rngdle floats the roll's own EP up off the total and fades it out, 1.5s.
function floatGain(score) {
  const anchor = el("lifetime-ep")?.parentElement;
  if (!anchor) return;
  const gain = h(`<span class="type-data absolute -top-1 left-full ml-1 text-sm text-success animate-float-up-fade">+${fmt(score)}</span>`);
  anchor.appendChild(gain);
  later(() => gain.remove(), FLOAT_UP_MS);
}

// Each badge card drops IN FROM ABOVE as it lands, it does not rise from below:
// rngdle tweens it `{opacity:0, y:-20, scale:.98} -> {opacity:1, y:0, scale:1}`
// over 0.35s with power2.out. A negative y is 20px up, so the card starts
// overlapping the one above it and settles down into its slot. The bezier is
// power2.out (GSAP's power2 is cubic, so this is easeOutCubic) — the same curve
// EASE.power2Out computes for the tweens that are not CSS transitions.
const CARD_ENTER_FROM = "translateY(-20px) scale(0.98)";
const CARD_ENTER_MS = 350, CARD_ENTER_BEZIER = "cubic-bezier(.33,1,.68,1)";
const CARD_ENTER_TRANSITION =
  `opacity ${CARD_ENTER_MS}ms ${CARD_ENTER_BEZIER}, transform ${CARD_ENTER_MS}ms ${CARD_ENTER_BEZIER}`;

const SPIN_MS = 100, PRE_ROLL_MS = 2000, SETTLE_MS = 400, FINALE_MS = 700;
const AFTER_COLLAPSE_MS = 1000, BEFORE_SUMMARY_MS = 1500;
const BEFORE_RARITY_MS = 1000, BEFORE_STATS_MS = 250, EP_TWEEN_MS = 500;
const TOTAL_EP_SHOW_MS = 1000, TOTAL_EP_ANIMATE_MS = 1500, REVEAL_END_MS = 2000;
const LIFETIME_TWEEN_MS = 1500, FLOAT_UP_MS = 1500;
const digitGap = (n, d) => (d <= 1 ? 1000 : 1000 + 1000 * Math.pow(n / (d - 1), 2));
const badgeGap = (i, n) => (n <= 1 ? 500 : 500 + 1000 * Math.pow(i / (n - 1), 1.5));

// Digit landings for d slots. Six: 2000, 3000, 4040, 5200, 6560, 8200.
const revealTimes = d => {
  const out = [PRE_ROLL_MS];
  for (let n = 1; n < d; n++) out.push(out[n - 1] + digitGap(n - 1, d));
  return out;
};

// rngdle's rarity reveal: the row fades and scales up with a back.out(1.7)
// overshoot, and the rarity pill inside pops harder with back.out(3) 100ms in.
// The number card and EP pill take their rarity colours at the same moment,
// riding the 500ms transition they already carry.
function revealRarity() {
  const row = el("rarity-row"), pill = el("rarity-pill");
  if (!row) return;
  tween(500, EASE.backOut(1.7), p => {
    row.style.opacity = p;
    row.style.transform = `scale(${0.9 + 0.1 * p})`;
  });
  later(() => {
    if (pill) tween(400, EASE.backOut(3), p => { pill.style.transform = `scale(${0.5 + 0.5 * p})`; });
  }, 100);
}

// "stats:show" and "summary:show" both use opacity 0 / y 10 -> power2.out 0.4s.
function fadeUp(nodes) {
  const list = [...nodes].filter(Boolean);
  if (!list.length) return;
  tween(400, EASE.power2Out, p => {
    for (const n of list) { n.style.opacity = p; n.style.transform = `translateY(${10 * (1 - p)}px)`; }
  });
}

function roll() {
  if (rolling) { skipSequence?.(); return; }
  clearTimers();
  rolling = true;
  editing = false;
  setSandboxLayout();        // tightens the moment a roll starts, as on rngdle;
                             // roll() never goes through render()

  const target = String(ENGINE.rollRandomNumber());
  const slots = slotsFor(target);          // 7 for the one 1000000 roll
  const pad = slots - target.length;
  const scramble = [...Array(slots)].fill("?");
  let revealed = 0, settledIdx = -1, tier = null, pulsing = false;

  // Read once, at the top: the roll is banked exactly once whether the reveal
  // runs to the end or gets skipped, and rolling again reads the new total.
  const lifetimeBefore = lifetimeEP();
  let credited = false;
  const creditRoll = () => {
    const after = lifetimeBefore + analysis.totalScore;
    if (!credited) { credited = true; saveLifetimeEP(after); }
    return after;
  };

  hideGenerate();
  setVignette(true);
  stopChipAnims();      // the previous roll's diagrams are still looping
  el("tagline").hidden = true;
  el("hint").hidden = true;
  el("rarity-row").replaceChildren();
  el("ep-row").replaceChildren();
  // The previous result's Share row would otherwise sit there through the whole
  // spin — nothing clears it until renderResults() runs at number:collapse, 8s
  // later, so a second roll showed Share and the countdown over the scrambling
  // digits and then took them away again.
  el("share-row").hidden = true;
  el("share").classList.remove("animate-share-highlight");
  el("share-label").textContent = "Share";
  el("breakdown").replaceChildren();

  const view = getCard();
  const slot = el("slot");
  if (!slot.contains(view.card)) slot.replaceChildren(view.card);

  const digits = () => [...Array(slots)].map((_, i) => {
    const blank = i < pad, done = i < revealed;
    return {
      char: done ? (blank ? "" : target[i - pad]) : scramble[i],
      blank, revealed: done, spinning: !done, settled: i === settledIdx,
    };
  });
  const paint = () => paintCard(view, digits(), tier, { pulsing, extra: rolling ? "" : "cursor-text" });
  const rescramble = () => {
    for (let i = revealed; i < slots; i++) scramble[i] = String(Math.floor(Math.random() * 10));
  };

  const land = n => {
    revealed = n + 1;
    settledIdx = n;
    rescramble();
    if (n === slots - 1) collapse();
    paint();
    later(() => { settledIdx = -1; paint(); }, SETTLE_MS);
  };

  // "number:collapse": the digits are all in, the card keeps its NEUTRAL
  // colours, and the staged results (hidden rarity, "??? EP", invisible badge
  // cards) go in behind them.
  const collapse = () => {
    if (spinner !== null) { clearInterval(spinner); spinner = null; }
    rolling = false;
    setValue(target);
    pulsing = true;           // pulse 1: digits landed, card still neutral
    renderResults(true);
    later(() => { pulsing = false; paint(); }, FINALE_MS);
    scheduleReveal();
  };

  // Everything after the digits: badges, then summary, rarity, percentile.
  const scheduleReveal = () => {
    // rngdle reveals the LOWEST EP badge first and prepends each new one, so the
    // list grows upward and ends in the descending order it is rendered in.
    // Sampled live on 103381: Six Digits(111) -> ... -> Equilibrium(1000).
    // The cards are already in descending order, so walk them backwards; because
    // the unrevealed ones are `hidden` the visible set is always the tail, which
    // renders exactly like rngdle's prepend.
    const order = [...el("badge-list").children].reverse();
    let at = AFTER_COLLAPSE_MS, running = 0;

    order.forEach((card, i) => {
      later(() => {
        card.hidden = false;
        card._chipAnim?.start(0);   // prepended, so index 0: a flat 100ms delay
        for (const row of card.children) row.style.transition = CARD_ENTER_TRANSITION;
        // Force a synchronous style flush so the browser computes the hidden
        // state (opacity 0, display block) before the change below — otherwise
        // the two coalesce into one recalc and the transition never runs, so
        // the card just pops in. requestAnimationFrame does NOT work here: it
        // fires before the next style recalc, and is paused in a hidden tab.
        void card.offsetHeight;
        for (const row of card.children) {
          row.style.opacity = "1";
          row.style.transform = "none";
        }
        const next = running + Number(card.dataset.ep || 0);
        tweenEP(running, next);
        running = next;
      }, at);
      if (i < order.length - 1) at += badgeGap(i, order.length);
    });

    at += BEFORE_SUMMARY_MS;
    later(() => fadeUp([el("badge-count")]), at);

    // rarity:reveal and stats:show carry different things than this file used to
    // think. Reading the two state flags back to their setters in rngdle's own
    // schedule — `ec` sets `en` at rarity:reveal, `eh` sets `ex` at stats:show —
    // the EP pill's colours and the Share row are gated on `en`, and the whole
    // rank row (pill • percentile, together) is gated on `ex` and carries the
    // back.out pop. So the colour lands first and the rank label follows it
    // 250ms later; the row is not split across the two steps.
    at += BEFORE_RARITY_MS;
    later(() => {
      tier = RARITY.getCardRarityTier(analysis.totalScore);
      pulsing = true;              // pulse 2: the card pops into its rank
      paint();                     // and eases into its rarity colours
      later(() => { pulsing = false; paint(); }, FINALE_MS);
      recolourEP();
      el("share-row").hidden = false;
    }, at);

    at += BEFORE_STATS_MS;
    later(() => revealRarity(), at);

    at += TOTAL_EP_SHOW_MS;
    later(() => showLifetimeRow(lifetimeBefore), at);

    at += TOTAL_EP_ANIMATE_MS;
    later(() => {
      const after = creditRoll();
      floatGain(analysis.totalScore);
      tween(LIFETIME_TWEEN_MS, EASE.power2Out,
        p => setLifetimeText(lifetimeBefore + (after - lifetimeBefore) * p));
    }, at);

    // reveal:end. rngdle turns the Share highlight on here, not with the button
    // itself. The skip stays armed until this point, so a click during the
    // lifetime count-up still jumps to the finished result.
    at += REVEAL_END_MS;
    later(() => {
      setVignette(false);
      el("share").classList.add("animate-share-highlight");
      showGenerate();
      skipSequence = null;
    }, at);
  };

  // Rolling takes ~8s on rngdle and the reveal a good while longer. That's fine
  // once a day, less so in a sandbox — so a click or keypress jumps to the end.
  // Stays armed through the whole reveal, not just the digits.
  skipSequence = () => {
    clearTimers();
    stopTweens();
    if (rolling) {
      if (spinner !== null) { clearInterval(spinner); spinner = null; }
      rolling = false;
      setValue(target);
      renderResults(true);
    }
    revealed = slots;
    settledIdx = -1;
    pulsing = false;
    tier = RARITY.getCardRarityTier(analysis.totalScore);
    paint();
    finishReveal();
    // clearTimers() dropped the scheduled lift and the two lifetime steps.
    setVignette(false);
    showLifetimeRow(creditRoll());
    showGenerate();
    skipSequence = null;
  };

  paint();  // "??????", all spinning, as on rngdle's first frame
  spinner = setInterval(() => { rescramble(); paint(); }, SPIN_MS);
  el("ep-row").replaceChildren(h(epPillHTML("??? EP", NEUTRAL_PILL)));
  revealTimes(slots).forEach((t, n) => later(() => land(n), t));
}

// Swap the EP pill from its neutral colours to the roll's rarity ones.
function recolourEP() {
  const pill = el("ep-pill");
  if (!pill) return;
  const p = RARITY.RARITY_PALETTE[RARITY.getCardRarityTier(analysis.totalScore)].pill;
  const drop = [NEUTRAL_PILL.bgClass, NEUTRAL_PILL.textClass, NEUTRAL_PILL.borderClass].join(" ").split(/\s+/);
  pill.classList.remove(...drop);
  pill.classList.add(...[p.bgClass, p.textClass, p.borderClass].join(" ").split(/\s+/));
}

// Jump the staged reveal to its finished state.
function finishReveal() {
  stopEP();
  [...el("badge-list").children].forEach((c, i) => {
    c.hidden = false;
    c.style.cssText = "";
    for (const row of c.children) row.style.cssText = "";
    c._chipAnim?.start(i);
  });
  const count = el("badge-count");
  if (count) count.style.cssText = "";
  const row = el("rarity-row");
  row.style.cssText = "";
  for (const n of row.querySelectorAll(".stats-part")) n.style.cssText = "";
  const pill = el("rarity-pill");
  if (pill) pill.style.cssText = "";
  const shareRow = el("share-row");
  shareRow.hidden = false;
  shareRow.style.cssText = "";
  el("share").classList.add("animate-share-highlight");
  recolourEP();
  setEPText(analysis.totalScore);
}

/* --- theme ---------------------------------------------------------------- */
function applyTheme(mode) {
  const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  for (const b of el("theme-toggle").children) {
    const on = b.dataset.theme === mode;
    b.classList.toggle("bg-prose", on);
    b.classList.toggle("text-surface", on);
    b.classList.toggle("text-prose-2", !on);
  }
  localStorage.setItem("theme", mode);
}
el("theme-toggle").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b) applyTheme(b.dataset.theme);
});
applyTheme(localStorage.getItem("theme") || "dark");

/* --- share ---------------------------------------------------------------- */
// rngdle's own share-text builder, transcribed, with the sandbox's wordmark and
// URL. One deliberate difference: rngdle drops the percentile line for middling
// rolls (it only prints Top when <= 50% and Bottom when < 10%); this always
// prints it, so the text matches what the page is showing.
const RARITY_SQUARE = {
  trash: "🟫", common: "⬜", uncommon: "🟩", rare: "🟦",
  epic: "🟪", anomaly: "🟧", mythic: "🟥",
};

function shareText() {
  if (!analysis) return "";
  const total = analysis.totalScore;
  const tier = RARITY.getCardRarityTier(total);
  const label = RARITY.RARITY_PALETTE[tier].pill.label;
  const pct = ENGINE.getPercentileForScore(total);

  const lines = [
    `RNGdle [Tools] 🎲 ${value}`,
    "",
    `${RARITY_SQUARE[tier]} ${label} • ${formatPercentile(pct)}`,
    "",
  ];
  for (const b of analysis.badges.slice(0, 3)) {
    lines.push(`${RARITY_SQUARE[RARITY.getBadgeRarityTier(b.score)]} ${b.emoji || "✨"} ${b.label}`);
  }
  const rest = analysis.badges.length - 3;
  if (rest > 0) lines.push(`+${rest} more`);
  lines.push("", `${fmt(total)} EP`, "https://rngdle.tools");
  return lines.join("\n");
}

/* --- next roll ------------------------------------------------------------ */
// rngdle's day rolls over at UTC midnight, and it prints the wait beside the
// Share button once the rank is up. Its format, transcribed: unpadded hours,
// two-digit minutes and seconds — "3h 33m 08s". Nothing here is gated on it;
// the sandbox rolls whenever you like. It just says when the real one resets.
const msUntilUTCMidnight = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
};

function paintNextRoll() {
  const total = Math.floor(msUntilUTCMidnight() / 1000);
  const m = Math.floor((total % 3600) / 60), s = total % 60;
  setText(el("next-roll"),
    `${Math.floor(total / 3600)}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`);
}
paintNextRoll();
setInterval(paintNextRoll, 1000);

/* --- share ---------------------------------------------------------------- */
el("share").addEventListener("click", async () => {
  const text = shareText();
  if (!text) return;
  const label = el("share-label");
  // Touch devices get the native share sheet, as on rngdle.
  if (navigator.share && matchMedia("(hover: none)").matches) {
    try { await navigator.share({ text }); return; }
    catch (err) { if (err.name === "AbortError") return; }
  }
  label.textContent = (await copyText(text)) ? "Copied" : "Copy failed";
  setTimeout(() => { label.textContent = "Share"; }, 2000);
});

// The async clipboard API is blocked in some embedded/sandboxed contexts, so
// fall back to the old selection trick before giving up.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

// Used by the EP page: open a specific number in the sandbox, no roll animation.
function openNumber(n) {
  finishAnyRoll();
  setValue(String(n));
  editing = false;
  render();
}

// Cut any in-flight reveal short (navigating away, or jumping to a number).
function finishAnyRoll() {
  if (skipSequence) skipSequence();
  clearTimers();
  stopTweens();
  stopChipAnims();   // the diagrams loop forever; don't do it off-view
}

el("generate").addEventListener("click", roll);

// Anywhere-click / any-key skips the reveal sequence. The GENERATE button has
// its own handler (roll() forwards to the skip while rolling), and clicks on
// the header controls should still work normally.
document.addEventListener("click", e => {
  if (skipSequence && !e.target.closest("#generate, header")) skipSequence();
});
document.addEventListener("keydown", e => {
  if (skipSequence && !e.metaKey && !e.ctrlKey && !e.altKey) skipSequence();
});

render();
