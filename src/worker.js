// The Worker's entry point (wrangler.toml: main). The front end under site/ is static,
// so there is not much here. Two jobs:
//
// 1. /api/rolls proxies rngdle's rolls API, which sends no `access-control-allow-origin`,
//    so the Profiles page cannot read it directly. One upstream page per 100 rolls, a
//    hard cap so a long history cannot turn into an unbounded fan-out, an identifying
//    user-agent, and a 5-minute edge cache so a refresh does not re-fetch.
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

import legacy, { legacyCatalogue } from "./index.js";

const VALID_USERNAME = /^[A-Za-z0-9_-]{1,40}$/;   // rngdle's own shape
const PAGE = 100;                                 // the API's max page size
const MAX_ROLLS = 2000;                           // 20 upstream requests, worst case
const UPSTREAM = "https://www.rngdle.com/api/users";
const UA = "rngdle.tools (+https://rngdle.tools) — profile view";
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
