// The Worker's entry point (wrangler.toml: main). The front end under site/ is static,
// so there is not much here. Two jobs:
//
// 1. /api/rolls proxies rngdle's rolls API, which sends no `access-control-allow-origin`,
//    so the Profiles page cannot read it directly. One upstream page per 100 rolls, a
//    hard cap so a long history cannot turn into an unbounded fan-out, an identifying
//    user-agent, and a 5-minute edge cache so a refresh does not re-fetch.
//
//    /u/<a>,<b>/raw is the same data as CSV - one row per roll, or one per player with
//    ?by=player - for a spreadsheet's IMPORTDATA. The profile page is drawn in the
//    browser, so IMPORTHTML / IMPORTXML see nothing but the empty shell; this is the
//    server-rendered version of it, scored with the engine exactly as the page is.
//
// 2. The legacy tools. index.js - the badge engine, and the site this front end
//    replaced - still renders the tools that were never ported into site/ (/chains and
//    the /beta lab), and the engine and JSON APIs behind them. It is mounted below for
//    exactly those paths, with this origin passed in as FRONT_END so the redirects it
//    keeps for its retired pages land back on the shell. The "Other" tab lists the
//    tools from its catalogue (/api/other).
//
// Everything else is a static asset — the asset binding serves the app shell for any
// path it has no file for, which is what keeps /badges/pronic and friends working on
// a reload. The legacy paths run the Worker first (wrangler.toml), or a navigation
// to one of them would get the shell too.

import legacy, { legacyCatalogue, compute, cardTier } from "./index.js";

const VALID_USERNAME = /^[A-Za-z0-9_-]{1,40}$/;   // rngdle's own shape
const MAX_COMBINE = 10;                           // players pooled at once, as the page caps it
// /u/alice,bob/raw - the names as the Profiles route takes them, then /raw.
const RAW_PATH = /^\/u\/([A-Za-z0-9_,-]{1,450})\/raw\/?$/;
const PAGE = 100;                                 // the API's max page size
const MAX_ROLLS = 2000;                           // 20 upstream requests, worst case
const UPSTREAM = "https://www.rngdle.com/api/users";
// ASCII only: Node's fetch refuses a header value with a character above U+00FF, so an
// em dash here made every profile a 502 under `npm run serve`.
const UA = "rngdle.tools (+https://rngdle.tools) - profile view";
const CACHE = "public, max-age=300";

// What the legacy Worker answers: the tools themselves, their browser engine, and the
// JSON they read (/api is the scorer, /api/profile feeds /beta/collection, the
// palette routes are the Box Lab's gallery). Nothing the shell routes is in here —
// /grid, /badges, /u and the rest are this site's own — so the two never overlap.
const LEGACY = /^\/(?:beta\/|chains$|engine\.js$|api$|api\/(?:profile|palettes|palettes-liked)(?:\/|$))/;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...extra },
});

// Walk the pages until rngdle says there are no more, or we hit the cap.
async function fetchRolls(username) {
  const rolls = [];
  for (let offset = 0; offset < MAX_ROLLS; offset += PAGE) {
    const url = `${UPSTREAM}/${encodeURIComponent(username)}/rolls?limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) {
      // A miss on the first page means the user does not exist; later pages
      // failing just means we stop early with what we have.
      if (offset === 0) { const e = new Error("upstream"); e.status = res.status; throw e; }
      break;
    }
    const data = await res.json();
    const page = data.rolls || [];
    rolls.push(...page);
    if (!data.hasMore || page.length === 0) break;
  }
  return rolls;
}

// --- /u/<names>/raw: the profile as CSV --------------------------------------
// RFC 4180: a cell with a comma, a quote or a line break is quoted, quotes doubled,
// rows end in CRLF. A poem is another player's writing and can hold any of those.
const csvCell = v => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = cells => cells.map(csvCell).join(",") + "\r\n";

// The names between /u/ and /raw, each valid, none twice, at most MAX_COMBINE.
function rawNames(list) {
  const seen = new Set();
  for (const n of list.split(",")) if (VALID_USERNAME.test(n)) seen.add(n);
  return [...seen].slice(0, MAX_COMBINE);
}

const text = (body, status, extra = {}) => new Response(body, {
  status,
  headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", ...extra },
});

// Every figure is the engine's, from the number alone, as on the page: EP, tier and
// badge count are recomputed rather than read from rngdle's roll record, so a roll
// scored before a badge batch shows what it is worth today. Rolls come newest first,
// players interleaved by date, exactly as the pooled page lists them.
async function rawProfiles(names, byPlayer) {
  const loaded = await Promise.all(names.map(async username => {
    try { return { username, rolls: await fetchRolls(username) }; }
    catch (e) { return { username, error: e.status === 404 ? "not found" : "unreachable" }; }
  }));
  const ok = loaded.filter(m => m.rolls);
  const failed = loaded.filter(m => !m.rolls);
  if (!ok.length) {
    const allMissing = failed.every(m => m.error === "not found");
    return text(failed.map(m => `${m.username}: ${m.error}`).join("\n") + "\n", allMissing ? 404 : 502);
  }

  let body;
  if (byPlayer) {
    body = csvRow(["player", "rolls", "total_ep", "badges", "best_number", "best_ep", "first_roll", "last_roll", "capped"]);
    for (const m of ok) {
      const collected = new Set();
      let total = 0, best = null;
      for (const r of m.rolls) {
        const s = compute(r.number);
        total += s.totalEP;
        for (const b of s.badges) collected.add(b.id);
        if (!best || s.totalEP > best.ep) best = { number: r.number, ep: s.totalEP };
      }
      const dates = m.rolls.map(r => r.rolledAt).filter(Boolean).sort();
      body += csvRow([m.username, m.rolls.length, total, collected.size, best?.number, best?.ep,
        dates[0], dates[dates.length - 1], m.rolls.length >= MAX_ROLLS ? 1 : 0]);
    }
  } else {
    // badge_list is every badge the roll earned as "Label+EP", biggest first, in one
    // cell; a badge its family outranked is there with +0, earned but unpaid.
    body = csvRow(["date", "user", "roll", "tier", "ep", "badges", "hearts", "poem", "badge_list"]);
    const rows = [];
    for (const m of ok) for (const r of m.rolls) rows.push({ ...r, owner: m.username });
    rows.sort((a, b) => (Date.parse(b.rolledAt) || 0) - (Date.parse(a.rolledAt) || 0));
    for (const r of rows) {
      const s = compute(r.number);
      const list = s.badges.map(b => `${b.label}+${b.ep}`).join(", ");
      body += csvRow([r.rolledAt, r.owner, r.number, cardTier(s.totalEP), s.totalEP, s.count, r.heartCount ?? 0, r.poem || "", list]);
    }
  }
  const extra = { "cache-control": CACHE, "content-disposition": `inline; filename="${ok.map(m => m.username).join(",")}.csv"` };
  // A pooled list with a name that failed still answers for the rest; the miss is
  // in a header, since a CSV has nowhere to put a note.
  if (failed.length) extra["x-missing-players"] = failed.map(m => `${m.username} (${m.error})`).join(", ");
  return text(body, 200, { ...extra, "content-type": "text/csv; charset=utf-8" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /u/<a>,<b>/raw before the shell: run_worker_first lists /u/* for this.
    const raw = RAW_PATH.exec(url.pathname);
    if (raw) {
      if (request.method !== "GET") return text("GET only\n", 405);
      const names = rawNames(raw[1]);
      if (!names.length) return text("Provide usernames: letters, digits, - and _, comma-separated.\n", 400);
      return rawProfiles(names, url.searchParams.get("by") === "player");
    }

    if (url.pathname === "/api/rolls") {
      if (request.method !== "GET") return json({ error: "GET only" }, 405);
      const u = (url.searchParams.get("u") || "").trim();
      if (!VALID_USERNAME.test(u)) {
        return json({ error: "Provide u as a username: letters, digits, - and _." }, 400);
      }
      try {
        const rolls = await fetchRolls(u);
        // Only the fields the profile page draws. rngdle also returns an id and
        // an activityId; neither is shown here.
        return json({
          username: u,
          rolls: rolls.map(r => ({
            number: r.number,
            totalScore: r.totalScore,
            badgeCount: r.badgeCount,
            rolledAt: r.rolledAt,
            heartCount: r.heartCount,
            poem: r.poem,
          })),
          capped: rolls.length >= MAX_ROLLS,
        }, 200, { "cache-control": CACHE });
      } catch (e) {
        const missing = e.status === 404;
        return json({ error: missing ? "user not found" : "could not reach rngdle" },
          missing ? 404 : 502);
      }
    }

    // The old lab index is the Other tab now. Old links land there.
    if (url.pathname === "/beta" || url.pathname === "/beta/") {
      return Response.redirect(`${url.origin}/other`, 301);
    }

    // The Other tab's cards: the engine's own catalogue of what it still renders —
    // titles, blurbs, marks and findings — rather than a second copy of them in site/.
    if (url.pathname === "/api/other") {
      return json(legacyCatalogue(), 200, { "cache-control": CACHE });
    }

    if (LEGACY.test(url.pathname)) {
      return legacy.fetch(request, { ...env, FRONT_END: url.origin });
    }

    return env.ASSETS.fetch(request);
  },
};
