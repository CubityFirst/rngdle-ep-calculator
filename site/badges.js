// Badges — a map of every badge RNGdle can award, laid out the way rngdle's own
// /sets page lays out its collections: one card per set, click to open, the
// badges inside as rarity-coloured pills running highest EP first.
//
// rngdle's /sets is a progress tracker for a signed-in player: n/m earned, a
// percentage, a progress bar, and `???` in place of every badge you have not
// rolled yet. None of that means anything here — there are no accounts, and
// nothing to complete. So this is the same furniture with the scoreboard taken
// out: every badge is named, and nothing is counted against you.
//
// The sets are rngdle's, transcribed from the same chunk `tools/refresh.js`
// pulls the engine out of. The badges in them are looked up in the engine at
// runtime, so labels, emoji and EP can never drift from it.

const BADGE_SETS = [
  { name: "The Casino", icon: "🎰", description: "Poker hands and lucky rolls",
    badges: ["PAIR", "CONTIGUOUS_PAIR", "TWO_PAIR", "CONTIGUOUS_TWO_PAIR", "THREE_PAIR", "CONTIGUOUS_THREE_PAIR", "TRIPS", "CONTIGUOUS_TRIPS", "QUADS", "BOAT", "CONTIGUOUS_BOAT", "STRAIGHT", "FLUSH", "STRAIGHT_FLUSH", "ROYAL_FLUSH", "FIVE_OF_A_KIND", "LOW_BALL", "HIGH_ROLLER", "SNAKE_EYES", "BLACKJACK"] },
  { name: "Lucky Sevens", icon: "7️⃣", description: "The luckiest number",
    badges: ["LUCKY_SEVEN_DIV", "LUCKY_7", "JACKPOT", "JACKPOT_EXACT", "JACKPOT_FOUR", "JACKPOT_FIVE", "JACKPOT_SIX", "POWER_OF_SEVEN"] },
  { name: "Deep Space", icon: "🌌", description: "Mathematical powers and sequences",
    badges: ["SQUARE", "CUBE", "FOURTH_POWER", "FIFTH_POWER", "SIXTH_POWER", "SEVENTH_POWER", "EIGHTH_POWER", "NINTH_POWER", "TENTH_POWER", "FIBONACCI", "POWER_OF_TWO", "POWER_OF_THREE", "POWER_OF_FIVE", "POWER_OF_SEVEN", "OUROBOROS", "FACTORIAL", "HARSHAD", "SPY", "PRONIC"] },
  { name: "Sacred Geometry", icon: "📐", description: "Patterns and symmetry in digits",
    badges: ["ECHO", "MINI_ECHO", "RHYME", "SANDWICH", "BOOKENDS", "ASCENSION", "DECAY", "STEPS", "SLOPES", "CASCADE", "WATERFALL", "MOUNTAIN", "VALLEY", "HILLS", "MESA", "CANYON", "DUNES", "POCKET_MIRROR", "MINI_SCRAMBLE", "FRAMED_QUAD", "TURTLE", "ALTERNATOR", "ZIPPER", "PALINDROME", "MIRROR_BOOKENDS", "PAIRED_BOOKENDS", "BALANCED", "STROBOGRAMMATIC", "FIREFLY"] },
  { name: "Meme Culture", icon: "😏", description: "Internet favorites",
    badges: ["NICE", "NICE_EXACT", "VERY_NICE", "VERY_VERY_NICE", "BOTANIST", "BOTANIST_EXACT", "HOTBOX", "DEVIL", "DEVIL_EXACT", "LEET", "LEET_EXACT", "MEANING", "MEANING_EXACT", "DEEPER_MEANING", "UNIVERSAL_ANSWER", "SIXTY_SEVEN", "SIXTY_SEVEN_EXACT", "SIXTY_SEVEN_DOUBLE", "BRAINROT", "BIG_BROTHER", "BIG_BROTHER_EXACT", "SECRET_AGENT", "ULTIMEME", "ULTIMEME_EXACT", "ERROR_EXACT", "INFERNAL", "FOOTBALL_17776"] },
  { name: "Calculator Words", icon: "🔢", description: "Numbers that spell words upside-down",
    badges: ["HELL", "EXACT_HELL", "BOOB", "EXACT_BOOB", "HELLO"] },
  { name: "The Void", icon: "🕳️", description: "Zero-related badges",
    badges: ["VOID", "GHOST", "DEEP_VOID", "DEEP_VOID_THREE", "DEEP_VOID_FOUR", "DEEP_VOID_FIVE", "CLEAN", "CENTURY", "MILLENNIUM", "EPOCH", "EON"] },
  { name: "Flatliners", icon: "📊", description: "Repeated digit sequences",
    badges: ["CONTIGUOUS_TRIPS", "CONTIGUOUS_QUADS", "CONTIGUOUS_FIVES", "CONTIGUOUS_SIXES", "HOMOGENEOUS"] },
  { name: "Exact Numbers", icon: "✨", description: "Exact match meme numbers",
    badges: ["NICE_EXACT", "BOTANIST_EXACT", "DEVIL_EXACT", "EMERGENCY_EXACT", "LEET_EXACT", "MEANING_EXACT", "JACKPOT_EXACT", "EXACT_HELL", "EXACT_BOOB", "SIXTY_SEVEN_EXACT", "EIGHTY_SIX_EXACT", "ORIENTATION_EXACT", "CALENDAR_EXACT", "VERY_VERY_NICE", "HOTBOX", "MAYDAY", "UNIVERSAL_ANSWER", "BRAINROT", "GROUNDHOG_DAY", "BIG_BROTHER_EXACT", "ERROR_EXACT", "INFERNAL", "FOOTBALL_17776", "ALWAYS", "FULL_DAY", "ULTIMEME_EXACT", "TAU", "GOLDEN_RATIO"] },
  { name: "Periodic Table", icon: "⚗️", description: "Element-themed badges",
    badges: ["HYDROGEN", "HELIUM", "LITHIUM", "BERYLLIUM", "BORON", "CARBON", "NITROGEN", "OXYGEN", "FLUORINE"] },
  { name: "Digit Counts", icon: "🔢", description: "Badges based on number length",
    badges: ["ONE_DIGIT", "TWO_DIGITS", "THREE_DIGITS", "FOUR_DIGITS", "FIVE_DIGITS", "SIX_DIGITS"] },
  { name: "Mathematical Constants", icon: "🧮", description: "Famous numbers from mathematics",
    badges: ["PI", "E", "TAU", "TAU_SLICE_4", "TAU_SLICE_5", "GOLDEN_RATIO", "FIBONACCI", "PRIME"] },
  { name: "Basic Physics", icon: "⚛️", description: "Fundamental number properties",
    badges: ["EVEN", "ODD", "FEATHER", "HEAVY", "GROUNDED", "LIFTOFF", "EQUILIBRIUM", "COLOSSAL"] },
  { name: "Counting", icon: "🔢", description: "Consecutive multi-digit numbers",
    badges: ["CONSEC_QUAD_EXACT", "CONSEC_QUAD_SCRAMBLED", "CONSEC_QUAD_CONTAINS", "CONSEC_TRIPLE_EXACT", "CONSEC_TRIPLE_SCRAMBLED", "CONSEC_TRIPLE_CONTAINS", "CONSEC_PAIR_EXACT", "CONSEC_PAIR_ADJACENT", "CONSEC_PAIR_NEARBY", "ARITHMETIC", "GEOMETRIC", "EQUATION"] },
  { name: "Emergency Services", icon: "🚨", description: "Important numbers",
    badges: ["EMERGENCY", "EMERGENCY_EXACT", "MAYDAY", "ERROR", "ERROR_EXACT"] },
  { name: "On the Clock", icon: "⏰", description: "Numbers that tell time",
    badges: ["CALENDAR", "CALENDAR_EXACT", "GROUNDHOG_DAY", "FULL_DAY", "ALWAYS"] },
];

// rngdle's sets cover 174 of the 233 badges. The rest are real and rollable and
// simply belong to no collection, so a map has to carry them — this last group
// is the sandbox's own, not rngdle's.
const UNSORTED_SET = {
  name: "No Set", icon: "🗂️",
  description: "Badges that aren't part of any collection",
};

const badgeEl = id => document.getElementById(id);
const node = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const CHEVRON_DOWN = "m6 9 6 6 6-6", CHEVRON_UP = "m18 15-6-6-6 6";
const chevron = () => node(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
       class="lucide lucide-chevron-down h-5 w-5 text-prose-3" aria-hidden="true">
    <path d="${CHEVRON_DOWN}"></path>
  </svg>`);

// A set can name a badge the engine no longer defines — rngdle's own Calculator
// Words still lists BOOB, which split into BOOB_8008 and friends. Drop those
// rather than render a pill with no name; tools/check.js pins the list, so a
// rename upstream shows up as a failure instead of a silently shorter set.
const knownBadges = ids => ids
  .map(id => ({ id, info: ENGINE.getBadgeInfo(id) }))
  .filter(b => b.info)
  .sort((a, b) => b.info.score - a.info.score);   // rngdle's order: dearest first

// rngdle slugs a badge page as the id lower-cased — /badges/pronic, and
// /badges/lucky_seven_div with the underscores kept.
const badgeSlug = id => id.toLowerCase();
const idForSlug = slug => {
  const want = String(slug).toLowerCase();
  return BADGES.BADGE_DEFINITIONS.find(b => badgeSlug(b.id) === want)?.id ?? null;
};

// rngdle's BadgePill, in the size /sets uses. Two of its own slots are filled
// that /sets leaves empty: the emoji, because a map is easier to read with it,
// and the link — the component wraps itself in one when given an href, and adds
// exactly these three hover classes for it.
function badgePill({ id, info }) {
  const rarity = RARITY.getRarityTailwind(info.score);
  const pill = node(`
    <div class="type-meta normal-case inline-flex items-center rounded-full gap-1 px-2 py-0.5 ${rarity.bgClass} ${rarity.textClass} ${rarity.borderClass} hover:opacity-80 transition-opacity cursor-pointer"
         role="img"></div>`);
  pill.setAttribute("aria-label", `${info.label} badge, ${fmt(info.score)} EP`);
  pill.title = `${rarity.label} · ${fmt(info.score)} EP\n${info.description}`;
  if (info.emoji) pill.append(node(`<span>${info.emoji}</span>`));
  const name = document.createElement("span");
  name.textContent = info.label;
  pill.append(name);
  const link = node(`<a href="/badges/${badgeSlug(id)}"></a>`);
  link.append(pill);
  return link;
}

// One badge, laid out as rngdle's own badge page lays it out: the emoji, the
// name, the description, then a three-column card of rarity / EP / probability.
// Everything below that upstream is the signed-in half — level, times earned,
// lifetime EP, roll history — and there is no one to be signed in here.
// Returns the badge's info so the router can title the page, or null if the
// slug names nothing.
function showBadge(slug) {
  const id = idForSlug(slug);
  const info = id && ENGINE.getBadgeInfo(id);
  if (!info) return null;
  const rarity = RARITY.getRarityTailwind(info.score);
  badgeEl("badge-emoji").textContent = info.emoji || "✨";
  badgeEl("badge-title").textContent = info.label;
  badgeEl("badge-description").textContent = info.description;
  const pill = badgeEl("badge-rarity");
  pill.className = `type-label inline-block rounded-sm px-3 py-1 text-lg ${rarity.bgClass} ${rarity.textClass} ${rarity.borderClass}`;
  pill.textContent = rarity.label;
  badgeEl("badge-ep").textContent = `${fmt(info.score)} EP`;
  badgeEl("badge-probability").textContent = info.probability;
  badgeEl("badge-map").href = `/grid/${badgeSlug(id)}`;
  return info;
}

function setCard(set, badges) {
  const card = node(`
    <div class="rounded-lg border bg-surface shadow-sm overflow-hidden border-outline">
      <button class="w-full p-4 text-left hover:bg-surface-raised/50 transition-colors cursor-pointer" aria-expanded="false">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-2xl"></span>
            <div>
              <div class="flex items-center gap-2"><h3 class="type-subsection-title text-prose"></h3></div>
              <p class="type-meta text-prose-3"></p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <div class="type-data type-ui font-bold text-prose"></div>
              <div class="type-data type-meta text-prose-3">badges</div>
            </div>
          </div>
        </div>
      </button>
      <div class="border-t border-outline-subtle p-4 bg-surface-dim" hidden>
        <div class="flex flex-wrap gap-1"></div>
      </div>
    </div>`);

  card.querySelector(".text-2xl").textContent = set.icon;
  card.querySelector("h3").textContent = set.name;
  card.querySelector("p").textContent = set.description;
  card.querySelector(".text-right > div").textContent = badges.length;

  const arrow = chevron();
  card.querySelector("button .flex.items-center.gap-3:last-child").append(arrow);
  for (const b of badges) card.querySelector(".flex-wrap").append(badgePill(b));

  const button = card.querySelector("button"), panel = card.lastElementChild;
  button.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    arrow.setAttribute("class", `lucide lucide-chevron-${open ? "up" : "down"} h-5 w-5 text-prose-3`);
    arrow.firstElementChild.setAttribute("d", open ? CHEVRON_UP : CHEVRON_DOWN);
  });
  return card;
}

// Built once, on the first visit — 233 pills is cheap, but there is no reason
// to pay for it on a page load that never opens this tab.
//
// `layout` is the URL's ?layout=: a shared link names the layout it was copied
// in, and wins over the remembered one. Without it the tab reopens the way it
// was left.
let badgesBuilt = false;
function buildBadges(layout) {
  const mode = layout === "compact" || layout === "official" ? layout : readBadgesMode();
  if (badgesBuilt) { setBadgesMode(mode, false); return; }
  badgesBuilt = true;

  const list = badgeEl("badges-list");
  const inASet = new Set(BADGE_SETS.flatMap(s => s.badges));
  const unsorted = BADGES.BADGE_DEFINITIONS.map(b => b.id).filter(id => !inASet.has(id));

  let total = 0;
  for (const set of [...BADGE_SETS, { ...UNSORTED_SET, badges: unsorted }]) {
    const badges = knownBadges(set.badges);
    list.append(setCard(set, badges));
  }
  // Every badge, counted once — the sets overlap, so this is not their sum.
  total = BADGES.BADGE_DEFINITIONS.length;
  badgeEl("badges-total").textContent = fmt(total);
  setBadgesMode(mode, false);
}

/* --- Compact: rngdle_solver's badge index ---------------------------------- */
// The second layout is the solver's /badges page — one card per badge with the
// rule, the EP, rngdle's own share-of-rolls figure, who outranks whom in its
// family, and the lowest numbers that earn it — with a search box, rarity
// chips and a sort over the top. Redrawn in this site's furniture: rngdle's
// cards, pills and type, and none of the solver's colour. The solver tints
// each card's left edge by rarity; here the pill carries that alone, as it
// does everywhere else on the site.
//
// Its history panel and "newly added" banner are not here: they describe the
// solver's own port. Its "map →" link is, now that the Grid tab exists.

const BADGES_MODE_KEY = "badges-mode";
const BLURB = {
  official: "Every badge RNGdle can award, in its own collections.",
  compact: "Every badge RNGdle can award, one card each: the rule, the EP, how often it lands, and its family.",
};
const BADGE_TIERS = ["mythic", "anomaly", "epic", "rare", "uncommon", "common"];   // dearest first, as the pills run
const EXAMPLES_PER_CARD = 3;                                                       // the solver's count

const readBadgesMode = () => {
  try { return localStorage.getItem(BADGES_MODE_KEY) === "compact" ? "compact" : "official"; }
  catch { return "official"; }
};

// rngdle prints probability as a string — "0.10%", "1.00e-4%" — so the
// rarest-first sort reads it back.
const parsePercent = s => parseFloat(String(s).replace("%", ""));

// rngdle's family tags are ids (CONTIGUOUS_RUN, OF_A_KIND); read them as words.
const familyName = tag => tag.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

let compactCards = null;      // [{ el, id, label, score, prob, tier, search }], in BADGE_DEFINITIONS order
let compactTier = "";         // rarity chip in force; "" is All

function compactCard(def, info, family) {
  const tier = RARITY.getBadgeRarityTier(info.score);
  const rarity = RARITY.getRarityTailwindByTier(tier);
  const el = node(`
    <article class="bc-card rounded-lg border border-outline bg-surface shadow-sm" id="bc-${def.id}">
      <header class="bc-head">
        <span class="bc-emoji"></span>
        <h3 class="bc-name text-prose"><a class="hover:underline"></a></h3>
        <span class="bc-pill type-label ${rarity.bgClass} ${rarity.textClass} ${rarity.borderClass}"></span>
      </header>
      <p class="bc-desc type-meta normal-case text-prose-2"></p>
      <div class="bc-stats type-meta normal-case">
        <span class="bc-ep type-data font-semibold text-prose"></span>
        <span class="bc-prob text-prose-3" title="rngdle's own figure: the share of rolls that earn this badge"></span>
      </div>
    </article>`);
  el.querySelector(".bc-emoji").textContent = info.emoji || "✨";
  const name = el.querySelector(".bc-name a");
  name.href = `/badges/${badgeSlug(def.id)}`;
  name.textContent = info.label;
  el.querySelector(".bc-pill").textContent = rarity.label;
  el.querySelector(".bc-desc").textContent = info.description;
  el.querySelector(".bc-ep").textContent = `+${fmt(info.score)} EP`;
  el.querySelector(".bc-prob").textContent = `${info.probability} of numbers`;

  // Family: within one, only the highest-EP badge earned scores, so say who
  // outranks whom. Ties happen — the top POWER tiers share one EP.
  if (family) {
    const others = family.filter(o => o.id !== def.id);
    const list = arr => arr.map(o => {
      const a = node(`<a class="bc-jump" href="#bc-${o.id}"></a>`);
      a.textContent = `${o.emoji ? o.emoji + " " : ""}${o.label}`;
      return a;
    });
    const parts = [];
    const above = others.filter(o => o.score > info.score);
    const ties = others.filter(o => o.score === info.score);
    const below = others.filter(o => o.score < info.score);
    if (above.length) parts.push(["outranked by ", list(above)]);
    if (ties.length) parts.push(["ties with ", list(ties)]);
    if (below.length) parts.push(["outranks ", list(below)]);
    const fam = node(`<div class="bc-fam type-meta normal-case text-prose-3"><b class="text-prose-2"></b> · </div>`);
    fam.querySelector("b").textContent = `${familyName(def.family)} family`;
    parts.forEach(([verb, links], pi) => {
      if (pi) fam.append("; ");
      fam.append(verb);
      links.forEach((a, i) => { if (i) fam.append(", "); fam.append(a); });
    });
    el.append(fam);
  }

  const search = `${info.label} ${def.id} ${info.description} ${tier} ${rarity.label}`.toLowerCase();
  return { el, id: def.id, label: info.label, score: info.score, prob: parsePercent(info.probability), tier, search };
}

// Rarity chips: All, then one per tier with its count. The one in force wears
// its rarity's pill colours; the rest are plain outlines.
function compactChips(counts) {
  const wrap = badgeEl("bc-chips");
  const chip = (tier, label, count) => {
    const b = node(`<button type="button" class="bc-chip type-meta" data-tier="${tier}"><span></span><em></em></button>`);
    b.firstElementChild.textContent = label;
    b.lastElementChild.textContent = count;
    return b;
  };
  wrap.append(chip("", "All", compactCards.length));
  for (const t of BADGE_TIERS) wrap.append(chip(t, RARITY.getRarityTailwindByTier(t).label, counts[t]));
  paintChips();
}
function paintChips() {
  for (const b of badgeEl("bc-chips").children) {
    const t = b.dataset.tier, on = t === compactTier;
    let cls = "bc-chip type-meta";
    if (!on) cls += " border border-outline bg-surface text-prose-2 hover:text-prose hover:bg-surface-raised";
    else if (!t) cls += " border border-prose bg-prose text-surface";
    else { const r = RARITY.getRarityTailwindByTier(t); cls += ` ${r.bgClass} ${r.textClass} ${r.borderClass}`; }
    b.className = cls;
    b.setAttribute("aria-pressed", String(on));
  }
}

function compactCompare(a, b) {
  switch (badgeEl("bc-sort").value) {
    case "ep-asc": return a.score - b.score;
    case "prob-asc": return a.prob - b.prob || b.score - a.score;
    case "prob-desc": return b.prob - a.prob || b.score - a.score;
    case "name": return a.label.localeCompare(b.label);
    default: return b.score - a.score;
  }
}

function applyCompact() {
  const q = badgeEl("bc-search").value.trim().toLowerCase();
  const grid = badgeEl("bc-cards");
  let shown = 0;
  for (const c of compactCards.slice().sort(compactCompare)) {
    const ok = (!compactTier || c.tier === compactTier) && (!q || c.search.includes(q));
    c.el.hidden = !ok;
    if (ok) shown++;
    grid.append(c.el);     // re-appending moves it into sorted place
  }
  const n = compactCards.length;
  badgeEl("bc-count").textContent = shown === n ? `${fmt(n)} badges` : `${fmt(shown)} of ${fmt(n)} badges`;
}

// A family link: clear whatever filter hides the target, then land on it.
function revealCompact(id) {
  const c = compactCards.find(x => x.id === id);
  if (!c) return;
  if (c.el.hidden) {
    badgeEl("bc-search").value = "";
    compactTier = "";
    paintChips();
    applyCompact();
  }
  c.el.scrollIntoView({ block: "center" });
  c.el.classList.add("is-target");
  setTimeout(() => c.el.classList.remove("is-target"), 1600);
}

// The examples come from the badge index analysis.js already ships — one
// bitset per badge — fetched only once this layout is opened, and filled in
// under the cards once it lands. analysis.js loads after this file, so its
// helpers are reached by name at call time rather than at parse time.
async function fillCompactExamples() {
  if (typeof getBadgeTable !== "function") return;
  let bits;
  try { bits = await getBadgeTable(); } catch { return; }
  for (const c of compactCards) {
    const bi = badgeByIndex.get(c.id);
    if (bi === undefined) continue;
    const base = bi * ROW_BYTES, found = [];
    for (let byte = 0; byte < ROW_BYTES && found.length < EXAMPLES_PER_CARD; byte++) {
      const v = bits[base + byte];
      if (!v) continue;
      for (let bit = 0; bit < 8 && found.length < EXAMPLES_PER_CARD; bit++) if (v & (1 << bit)) found.push(byte * 8 + bit);
    }
    const ex = node(`<div class="bc-ex type-meta normal-case text-prose-3"></div>`);
    if (!found.length) ex.textContent = "No number earns this.";
    else {
      ex.append("e.g. ");
      found.forEach((n, i) => {
        if (i) ex.append(" · ");
        const a = node(`<a class="type-data hover:underline" href="/n/${n}"></a>`);
        a.textContent = fmt(n);
        ex.append(a);
      });
      // The solver's link into its /grid: every earner of this badge, lit up.
      const map = node(`<a class="bc-map hover:underline" href="/grid/${badgeSlug(c.id)}" title="Light up every number that earns this badge on the 1000×1000 map">map →</a>`);
      ex.append(" ", map);
    }
    c.el.append(ex);
  }
}

function buildCompact() {
  if (compactCards) return;
  const defs = BADGES.BADGE_DEFINITIONS;
  const infoOf = new Map(defs.map(d => [d.id, ENGINE.getBadgeInfo(d.id)]));
  const families = new Map();
  for (const d of defs) {
    if (!d.family) continue;
    if (!families.has(d.family)) families.set(d.family, []);
    const info = infoOf.get(d.id);
    families.get(d.family).push({ id: d.id, label: info.label, emoji: info.emoji, score: info.score });
  }
  const counts = Object.fromEntries(BADGE_TIERS.map(t => [t, 0]));
  compactCards = defs.map(d => {
    const c = compactCard(d, infoOf.get(d.id), families.get(d.family));
    counts[c.tier]++;
    return c;
  });
  compactChips(counts);
  applyCompact();
  fillCompactExamples();

  badgeEl("bc-search").addEventListener("input", applyCompact);
  badgeEl("bc-sort").addEventListener("change", applyCompact);
  badgeEl("bc-chips").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    compactTier = b.dataset.tier;
    paintChips();
    applyCompact();
  });
  badgeEl("bc-cards").addEventListener("click", e => {
    const a = e.target.closest("a.bc-jump");
    if (!a) return;
    e.preventDefault();      // ep.js's router would otherwise "navigate" to /badges
    revealCompact(a.getAttribute("href").slice("#bc-".length));
  });
}

// An Official / Compact switch, painted the way the header's theme toggle
// paints itself: the button in force is filled, the rest are quiet. Shared
// with the Profiles page's roll-history switch (profile.js loads after this).
function paintModeToggle(wrap, mode) {
  for (const b of wrap.children) {
    const on = b.dataset.mode === mode;
    b.classList.toggle("bg-prose", on);
    b.classList.toggle("text-surface", on);
    b.classList.toggle("text-prose-2", !on);
    b.setAttribute("aria-pressed", String(on));
  }
}

function setBadgesMode(mode, persist = true) {
  const compact = mode === "compact";
  badgeEl("badges-official").hidden = compact;
  badgeEl("badges-compact").hidden = !compact;
  badgeEl("view-badges").classList.toggle("is-compact", compact);
  badgeEl("badges-blurb").textContent = BLURB[compact ? "compact" : "official"];
  paintModeToggle(badgeEl("badges-mode"), mode);
  if (compact) buildCompact();
  if (persist) { try { localStorage.setItem(BADGES_MODE_KEY, mode); } catch { /* private mode */ } }
  // Keep the address bar shareable: it reads ?layout=compact whenever that is
  // what is showing, and plain /badges for the official layout. Only on the
  // map itself — a badge's own page has no layout. The layout is stamped on
  // the history entry too, so Back brings up what was showing (ep.js reads
  // it), not whatever is remembered.
  if (location.pathname === "/badges") {
    history.replaceState({ layout: mode }, "", compact ? "/badges?layout=compact" : "/badges");
  }
}

badgeEl("badges-mode").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b) setBadgesMode(b.dataset.mode);
});
