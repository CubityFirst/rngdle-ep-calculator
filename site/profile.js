// Profiles — a real rngdle player's rolls, in the shape rngdle's own
// /u/<name> page puts them: the total, the best roll, the badge collection with
// its star levels, and the roll history. Several players at once (/u/a,b,c)
// pool their rolls into one such page, the way rngdle_solver's combined view
// does, with each roll saying whose it is.
//
// The rolls come from rngdle's public API through worker.js (it sends no CORS
// header, so the page cannot call it directly). Nothing else does: the EP, the
// tier, the badges and their levels are all recomputed here with the vendored
// engine, from the numbers alone. That is the same trick the rest of this
// sandbox plays — the numbers are rngdle's, the scoring is rngdle's own code
// running locally.
//
// Three things on rngdle's page are simply not in the API and are not guessed
// at here: the display-name colour, the favourite-badge row, and the exact
// "member since" date. The date shown is the first roll in the history, which
// is a lower bound, and it says so.

const PROFILE_API = "/api/rolls?u=";
let profileSummary = "";   // the copy button's payload, rebuilt per profile

// Badge levels are the stars on each pill, and rngdle computes them server-side
// — they are in no chunk. Derived instead from a profile with 100 rolls, by
// pairing every pill's star count against the times that badge was actually
// earned: the thresholds are Fibonacci minus one. Checked against all 82 badges
// on that profile, exact.
const STAR_THRESHOLDS = (() => {
  const out = [];
  for (let a = 1, b = 2; out.length < 16; [a, b] = [b, a + b]) out.push(b - 1);
  return out;                                    // 1, 2, 4, 7, 12, 20, 33, 54, 88, ...
})();
const starLevel = earned => STAR_THRESHOLDS.filter(t => earned >= t).length;
const stars = n => (n <= 5 ? "★".repeat(n) : `★×${n}`);

const profEl = id => document.getElementById(id);
const pnode = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// rngdle prints dates on the profile as en-GB day/month/year.
const rollDate = iso => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleDateString("en-GB");
};

// The roll-history rows and the best-roll chip are the number card again, at a
// smaller size: rngdle reuses the same rarity artifact styles and overrides the
// padding and text size.
function numberChip(n, tier, small) {
  const s = RARITY.RARITY_ARTIFACT_STYLES[tier];
  const chip = pnode(`
    <div class="relative overflow-hidden inline-flex items-center justify-center px-4 py-2 rounded-lg border-2 bg-gradient-to-br ${s.border} ${s.background} ${s.glow} ${s.shadow} ${small ? "!text-sm !px-2 !py-0.5" : ""}">
      <div class="absolute -inset-px overflow-hidden pointer-events-none rounded-lg dark:opacity-40" style="background: linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 40%, transparent 60%);"></div>
      <span class="relative z-10 font-roll font-bold tabular-nums text-xl sm:text-2xl ${s.textColor}"></span>
    </div>`);
  chip.querySelector("span").textContent = n;
  return chip;
}

// Every badge the player has ever earned, how many times, highest EP first —
// the order rngdle lists them in.
function badgeCollection(rolls) {
  const earned = new Map();
  for (const r of rolls) {
    for (const b of ENGINE.composeRollResult(r.number).badges) {
      earned.set(b.id, (earned.get(b.id) || 0) + 1);
    }
  }
  return [...earned.entries()]
    .map(([id, count]) => ({ id, count, info: ENGINE.getBadgeInfo(id) }))
    .filter(b => b.info)
    .sort((a, b) => b.info.score - a.info.score);
}

function collectedPill({ id, count, info }) {
  const rarity = RARITY.getRarityTailwind(info.score);
  const link = pnode(`<a href="/badges/${id.toLowerCase()}"></a>`);
  const pill = pnode(`
    <div class="type-meta normal-case inline-flex items-center rounded-full gap-1 px-2 py-0.5 ${rarity.bgClass} ${rarity.textClass} ${rarity.borderClass} hover:opacity-80 transition-opacity cursor-pointer"></div>`);
  pill.title = `${info.label} — earned ${fmt(count)} time${count === 1 ? "" : "s"} · level ${starLevel(count)}`;
  if (info.emoji) pill.append(pnode(`<span>${info.emoji}</span>`));
  const name = document.createElement("span");
  name.textContent = info.label;
  pill.append(name, pnode(`<span class="lowercase ml-1">${stars(starLevel(count))}</span>`));
  link.append(pill);
  return link;
}

// rngdle's heart, as a readout rather than a control: liking a roll needs an
// account, and there is nobody signed in here. The count only shows above zero,
// which is rngdle's own rule.
const HEART_PATH = "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5";
const heartCount = n => pnode(`
  <div class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs h-[22px] text-prose-3" title="${fmt(n)} like${n === 1 ? "" : "s"}">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         class="lucide lucide-heart h-3 w-3" aria-hidden="true"><path d="${HEART_PATH}"></path></svg>
    ${n > 0 ? `<span>${fmt(n)}</span>` : ""}
  </div>`);

// "@name", linking to that player's own profile — the solver's `userLink`.
function userLink(name, cls = "") {
  const a = pnode(`<a class="${cls}" href="/u/${encodeURIComponent(name)}"><span class="at">@</span></a>`);
  a.append(document.createTextNode(name));
  return a;
}

// One roll as rngdle's own card row. On a pooled view the owner sits by the
// date, which is the one thing rngdle's row never needs to say.
function rollRow(r, combined) {
  const tier = RARITY.getCardRarityTier(r.ep);
  const row = pnode(`
    <div class="block polished-card px-5 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="chip"></div>
          <div class="type-data type-meta text-muted"></div>
        </div>
        <div class="text-right">
          <div class="font-bold"><span class="type-data text-prose"></span></div>
          <div class="type-meta text-muted"></div>
        </div>
      </div>
      <div class="flex items-start gap-2 mt-1">
        <p class="poem flex-1 text-xs font-mono text-prose-2 lowercase"></p>
      </div>
    </div>`);
  row.querySelector(".chip").replaceWith(numberChip(r.number, tier, true));
  row.querySelector(".type-data.type-meta").textContent = rollDate(r.rolledAt);
  if (combined) {
    row.querySelector(".type-data.type-meta").before(userLink(r.owner, "type-meta normal-case text-prose-2 hover:underline"));
  }
  row.querySelector(".font-bold span").textContent = `${fmt(r.ep)} EP`;
  row.querySelector(".text-right .type-meta").textContent =
    `${fmt(r.badgeCount)} badge${r.badgeCount === 1 ? "" : "s"}`;

  // The poem is another player's writing: textContent, never innerHTML. rngdle
  // keeps the row either way and leaves a bare flex-1 spacer where the poem
  // would be, so the heart stays pinned right.
  const poem = row.querySelector(".poem");
  if (r.poem) poem.textContent = r.poem;
  else poem.replaceWith(pnode('<div class="flex-1"></div>'));
  // Coerced, not trusted: it is interpolated into markup, and it comes from
  // an API this site does not own.
  row.lastElementChild.append(heartCount(Number(r.heartCount) || 0));
  return row;
}

// The heading: one name, or several with a quiet "+" between them.
function setProfileHeading(names) {
  const h = profEl("profile-name");
  h.replaceChildren();
  names.forEach((n, i) => {
    if (i) h.append(pnode('<span class="plus">+</span>'));
    h.append(document.createTextNode(n));
  });
}

// The per-player line of a pooled view: rolls, EP, badges, streak, best roll.
function playerRow(m) {
  const tr = pnode(`<tr><td class="pr-who"></td><td class="pr-ep"></td><td class="pr-ep"></td><td class="pr-dim"></td><td class="pr-dim"></td><td class="pr-num"></td></tr>`);
  const [who, rolls, ep, badges, streak, best] = tr.children;
  who.append(userLink(m.username));
  rolls.textContent = fmt(m.rolls.length);
  ep.textContent = fmt(m.totalEP);
  badges.textContent = fmt(m.badges);
  streak.textContent = fmt(m.streak);
  if (m.best) {
    const a = pnode(`<a href="/n/${m.best.number}"></a>`);
    a.textContent = fmt(m.best.number);
    best.append(a, document.createTextNode(` (${fmt(m.best.ep)} EP)`));
  }
  return tr;
}

let profileRolls = [];          // the rolls on show: scored, owner-tagged, newest first
let profileCombined = false;    // more than one player pooled

// `members` is [{ username, rolls }], one or several. One player and several
// pooled are the same page — the solver draws them through one renderer too —
// and `combined` is what differs: owners on the rolls, a "by" on the best
// roll, and the Players table.
function renderProfile(members, capped) {
  const combined = members.length > 1;
  // Every number rescored here rather than trusted: rngdle sends totalScore, but
  // this sandbox exists to run the engine, so it runs the engine.
  const scored = [];
  for (const m of members) {
    for (const r of m.rolls) scored.push({ ...r, owner: m.username, ep: ENGINE.composeRollResult(r.number).totalScore });
  }
  // Newest first, which is the order rngdle hands one player's rolls in; a
  // pooled list interleaves the players by date. Stable, so ties keep it.
  scored.sort((a, b) => (Date.parse(b.rolledAt) || 0) - (Date.parse(a.rolledAt) || 0));
  const totalEP = scored.reduce((a, r) => a + r.ep, 0);
  const best = scored.reduce((a, r) => (!a || r.ep > a.ep ? r : a), null);
  const collection = badgeCollection(scored);

  setProfileHeading(members.map(m => m.username));
  // The router titled the tab from the URL; retitle from who actually loaded.
  document.title = `${members.map(m => m.username).join(" + ")} · RNGdle Sandbox`;
  const first = scored.map(r => r.rolledAt).filter(Boolean).sort()[0];
  profEl("profile-since").textContent = [
    combined ? `${members.length} players · ${fmt(scored.length)} roll${scored.length === 1 ? "" : "s"} pooled` : "",
    first ? `First roll seen ${rollDate(first)}` : "",
  ].filter(Boolean).join(" · ");
  profEl("profile-total-ep").textContent = fmt(totalEP);

  const bestWrap = profEl("profile-best");
  bestWrap.replaceChildren();
  profEl("profile-best-ep").replaceChildren();
  if (best) {
    const link = pnode(`<a href="/n/${best.number}" class="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-strong transition-transform hover:scale-105 active:scale-95"></a>`);
    link.append(numberChip(best.number, RARITY.getCardRarityTier(best.ep), false));
    bestWrap.append(link);
    profEl("profile-best-ep").append(document.createTextNode(`${fmt(best.ep)} EP`));
    if (combined) profEl("profile-best-ep").append(document.createTextNode(" · by "), userLink(best.owner, "hover:underline"));
  }

  profEl("profile-badge-count").textContent =
    `${fmt(collection.length)} unique badge${collection.length === 1 ? "" : "s"} collected`;
  const pills = profEl("profile-badges");
  pills.replaceChildren();
  for (const b of collection) pills.append(collectedPill(b));

  // Players: a line each, best collection first — the group's own leaderboard.
  profEl("profile-players").hidden = !combined;
  if (combined) {
    const rows = members.map(m => {
      const mine = scored.filter(r => r.owner === m.username);
      return {
        username: m.username, rolls: mine,
        totalEP: mine.reduce((a, r) => a + r.ep, 0),
        badges: badgeCollection(mine).length,
        streak: maxStreak(mine),
        best: mine.reduce((a, r) => (!a || r.ep > a.ep ? r : a), null),
      };
    }).sort((a, b) => b.totalEP - a.totalEP);
    profEl("profile-players-rows").replaceChildren(...rows.map(playerRow));
  }

  profileSummary = profileSummaryText(members.map(m => m.username), scored, collection);
  profEl("profile-copy").hidden = false;

  profEl("profile-roll-count").textContent =
    `${fmt(scored.length)} roll${scored.length === 1 ? "" : "s"}${capped ? "+" : ""}`;
  profileRolls = scored;
  profileCombined = combined;
  rollsDrawn = { official: false, compact: false };
  drawRolls();
}

function profileStatus(text, isError) {
  // Nothing to copy while it is loading or failed.
  if (text) { profEl("profile-copy").hidden = true; profileSummary = ""; profEl("profile-note").hidden = true; }
  const box = profEl("profile-status");
  box.hidden = !text;
  box.textContent = text || "";
  box.classList.toggle("text-danger", !!isError);
  profEl("profile-body").hidden = !!text;
}

// Names typed, pasted or taken off the URL: anything that is not a username
// character separates them, so "alice, bob" and "@alice @bob" both read as
// two, and the same name twice counts once. The solver's parseUsernames.
const MAX_COMBINE = 10;     // the solver's cap; each player is its own upstream walk
function parseUsernames(str) {
  const out = [], seen = new Set();
  for (const name of String(str || "").split(/[^A-Za-z0-9_-]+/)) {
    if (!name || name.length > 40 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

async function fetchRolls(username) {
  try {
    const res = await fetch(PROFILE_API + encodeURIComponent(username));
    const data = await res.json();
    if (!res.ok) return { username, error: data.error || `could not load ${username}` };
    return { username, rolls: data.rolls, capped: !!data.capped };
  } catch {
    return { username, error: "could not reach the roll API" };
  }
}

// `names` is the URL's list, one or several; `layout` its ?layout=, if any.
// Several players are fetched side by side, and one that fails does not sink
// the rest: it is named in a note over the page, as the solver does it.
let profileLoading = null;      // the lookup currently in flight, as its URL key
async function showProfile(names, layout) {
  const asked = parseUsernames(names.join(","));
  const wanted = asked.slice(0, MAX_COMBINE), dropped = asked.slice(MAX_COMBINE);
  const key = wanted.join(",");
  setProfileHeading(wanted);
  profEl("profile-luck").href = `/luck/${wanted.join(",")}`;     // the Luck tab's reading of the same players
  setRollsMode(layout === "compact" || layout === "official" ? layout : readRollsMode(), false);
  profileStatus(`Loading ${wanted.join(", ")}…`, false);
  profileLoading = key;
  const results = await Promise.all(wanted.map(fetchRolls));
  if (profileLoading !== key) return;              // a newer lookup won
  const ok = results.filter(r => !r.error), failed = results.filter(r => r.error);
  if (!ok.length) {
    profileStatus(failed.length === 1 ? failed[0].error : `Could not load ${failed.map(f => f.username).join(", ")}.`, true);
    return;
  }
  const withRolls = ok.filter(m => m.rolls.length), empty = ok.filter(m => !m.rolls.length);
  if (!withRolls.length) {
    profileStatus(`${ok.map(m => m.username).join(", ")} ${ok.length === 1 ? "has" : "have"} no rolls yet.`, false);
    return;
  }
  profileStatus("", false);
  const notes = [];
  if (failed.length) notes.push(`Couldn't load ${failed.map(f => `${f.username} (${f.error})`).join(", ")}.`);
  if (empty.length) notes.push(`${empty.map(m => m.username).join(", ")} ${empty.length === 1 ? "has" : "have"} no rolls yet.`);
  if (dropped.length) notes.push(`At most ${MAX_COMBINE} players can be pooled at once, so ${dropped.join(", ")} ${dropped.length === 1 ? "was" : "were"} left out.`);
  profEl("profile-note").hidden = !notes.length;
  profEl("profile-note").textContent = notes.join(" ");
  renderProfile(withRolls, ok.some(m => m.capped));
}

// The lookup form just routes to /u/<name> — or /u/<a>,<b> for several — and
// the router does the fetching, so a typed name and a pasted link land in
// exactly the same place.
profEl("profile-form").addEventListener("submit", e => {
  e.preventDefault();
  const names = parseUsernames(profEl("profile-input").value);
  if (names.length) navigate(`/u/${names.join(",")}`);
});

/* --- the roll history, in two layouts --------------------------------------- */
// Official is rngdle's own roll cards. Compact is rngdle_solver's rolls table
// — date, player, number, tier, EP, badge count — redrawn in this site's
// furniture, with the heart count and a mark for a poem in a last column.
// Both are drawn from `profileRolls` on demand, so a layout never opened costs
// nothing, and the choice is remembered and put in the URL exactly as the
// Badges tab's is.
const ROLLS_MODE_KEY = "rolls-mode";
const readRollsMode = () => {
  try { return localStorage.getItem(ROLLS_MODE_KEY) === "compact" ? "compact" : "official"; }
  catch { return "official"; }
};
let rollsMode = "official";
let rollsDrawn = { official: false, compact: false };

function rollTableRow(r, combined) {
  const tier = RARITY.getCardRarityTier(r.ep);
  const pill = RARITY.getRarityTailwindByTier(tier);
  const tr = pnode(`<tr><td class="pr-dim"></td><td class="pr-num"></td><td></td><td class="pr-ep"></td><td class="pr-dim"></td><td class="pr-dim"></td></tr>`);
  const [date, num, tierCell, ep, badges, extra] = tr.children;
  date.textContent = rollDate(r.rolledAt);
  if (combined) {
    const who = pnode('<td class="pr-who"></td>');
    who.append(userLink(r.owner));
    date.after(who);
  }
  const a = pnode(`<a href="/n/${r.number}"></a>`);
  a.textContent = fmt(r.number);
  num.append(a);
  const p = pnode(`<span class="pr-pill ${pill.bgClass} ${pill.textClass} ${pill.borderClass}"></span>`);
  p.textContent = pill.label;
  tierCell.append(p);
  ep.textContent = fmt(r.ep);
  badges.textContent = fmt(r.badgeCount);
  // Hearts and poem, the two things the card row has room for and a table
  // row does not: the count, and a mark whose tooltip is the poem itself.
  const hearts = Number(r.heartCount) || 0;
  if (hearts) extra.append(document.createTextNode(`♥ ${fmt(hearts)}`));
  if (r.poem) {
    const mark = pnode('<span class="pr-poem">✎</span>');
    mark.title = r.poem;                       // another player's writing: never markup
    if (hearts) extra.append(document.createTextNode(" "));
    extra.append(mark);
  }
  return tr;
}

function drawRolls() {
  if (!profileRolls.length || rollsDrawn[rollsMode]) return;
  rollsDrawn[rollsMode] = true;
  if (rollsMode === "official") {
    profEl("profile-rolls").replaceChildren(...profileRolls.map(r => rollRow(r, profileCombined)));
    return;
  }
  const head = ["Date", ...(profileCombined ? ["Player"] : []), "Number", "Tier", "EP", "Badges", ""];
  profEl("profile-rolls-head").replaceChildren(...head.map(t => { const th = document.createElement("th"); th.textContent = t; return th; }));
  profEl("profile-rolls-rows").replaceChildren(...profileRolls.map(r => rollTableRow(r, profileCombined)));
}

function setRollsMode(mode, persist = true) {
  rollsMode = mode;
  const compact = mode === "compact";
  paintModeToggle(profEl("rolls-mode"), mode);
  drawRolls();
  profEl("profile-rolls").hidden = compact;
  profEl("profile-rolls-compact").hidden = !compact;
  if (persist) { try { localStorage.setItem(ROLLS_MODE_KEY, mode); } catch { /* private mode */ } }
  // The address bar says which layout is showing, so a copied link opens the
  // same way; the history entry carries it too, for Back (ep.js reads it).
  if (/^\/u\/./.test(location.pathname)) {
    history.replaceState({ layout: mode }, "", location.pathname + (compact ? "?layout=compact" : ""));
  }
}

profEl("rolls-mode").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b) setRollsMode(b.dataset.mode);
});

/* --- the copyable summary -------------------------------------------------- */
// Tier bands, worked out from rngdle's own CARD_PERCENTILE_THRESHOLDS rather
// than typed in: the map holds each tier's upper bound, so a tier's label is
// built from the bound below it — uncommon starts where common ends (50), which
// is "Top 50%". trash and common are the two that read from the bottom.
// tools/check.js pins the seven strings this produces.
const TIER_ORDER = ["mythic", "anomaly", "epic", "rare", "uncommon", "common", "trash"];
const TIER_SQUARE = {
  mythic: "🟥", anomaly: "🟧", epic: "🟪", rare: "🟦",
  uncommon: "🟩", common: "⬜", trash: "🟫",
};
const tierBands = () => {
  const t = RARITY.CARD_PERCENTILE_THRESHOLDS;
  const rising = ["trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic"];
  const label = {};
  rising.forEach((tier, i) => {
    const name = tier[0].toUpperCase() + tier.slice(1);
    // trash and common describe the bottom of the range; the rest the top.
    label[tier] = i <= 1
      ? `${name} (Bottom ${t[tier]}%)`
      : `${name} (Top ${100 - t[rising[i - 1]]}%)`;
  });
  return label;
};

// Longest run of consecutive UTC days with at least one roll. UTC because that
// is the day rngdle rolls over on, which is also what the countdown counts to.
function maxStreak(rolls) {
  const days = [...new Set(rolls.map(r => (r.rolledAt || "").slice(0, 10)).filter(Boolean))].sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev !== null && t - prev === 86400000 ? run + 1 : 1;
    prev = t;
    if (run > best) best = run;
  }
  return best;
}

// `names` is one player or several; a pooled summary opens with who is in it,
// calls the streak "Combined" (it is the longest run of days on which someone
// rolled), and says whose the best roll was — the solver's own wording.
function profileSummaryText(names, scored, collection) {
  const bands = tierBands();
  const combined = names.length > 1;
  const counts = Object.fromEntries(TIER_ORDER.map(t => [t, 0]));
  let totalEP = 0, best = null;
  for (const r of scored) {
    counts[RARITY.getCardRarityTier(r.ep)]++;
    totalEP += r.ep;
    if (!best || r.ep > best.ep) best = r;
  }
  const lines = TIER_ORDER.map(t => `${TIER_SQUARE[t]} ${bands[t]} ${fmt(counts[t])}`);
  lines.push("");
  if (combined) lines.push(`👥 ${names.length} Players: ${names.map(n => `@${n}`).join(", ")}`);
  lines.push(`🧮 ${fmt(scored.length)} Total Rolls`);
  lines.push(`🔥 ${fmt(maxStreak(scored))} Day ${combined ? "Combined" : "Max"} Streak`);
  lines.push(`🏅 ${fmt(collection.length)} Badges`);
  lines.push(`📈 ${fmt(totalEP)} (Total) EP`);
  if (best) {
    const by = combined ? ` by @${best.owner}` : "";
    lines.push(`🎲 Best Roll: ${best.number} (${fmt(best.ep)} EP)${by} on ${(best.rolledAt || "").slice(0, 10)}`);
  }
  return lines.join("\n");
}

// Swaps to a tick for a moment, the way the Share button does.
const COPY_ICON = '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>';
const CHECK_ICON = '<path d="M20 6 9 17l-5-5"></path>';
let copyReset = null;

profEl("profile-copy").addEventListener("click", async () => {
  if (!profileSummary) return;
  const svg = profEl("profile-copy").querySelector("svg");
  const ok = await copyText(profileSummary);
  svg.innerHTML = ok ? CHECK_ICON : COPY_ICON;
  svg.setAttribute("class", `lucide lucide-${ok ? "check" : "copy"} h-4 w-4 pointer-events-none`);
  profEl("profile-copy").title = ok ? "Copied" : "Copy failed";
  clearTimeout(copyReset);
  copyReset = setTimeout(() => {
    svg.innerHTML = COPY_ICON;
    svg.setAttribute("class", "lucide lucide-copy h-4 w-4 pointer-events-none");
    profEl("profile-copy").title = "Copy summary";
  }, 2000);
});
