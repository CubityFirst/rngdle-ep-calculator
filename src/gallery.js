// Palette gallery for the Box Lab (/beta/boxes) - the one part of this site that
// stores anything. Everything else is a pure function of the number you typed;
// this holds what other people invented, so it needs a database.
//
// Storage is D1, bound as `env.DB`. `node serve.mjs` binds a node:sqlite shim that
// speaks the same prepare/bind/first/all/run surface against a local file, so the
// SQL below is the only copy and dev and prod cannot drift. Schema: schema.sql.
//
// Nothing here renders HTML - the routes return JSON and the Box Lab client draws
// it. That keeps beta.js free of any import from this module, and this module free
// of any import at all.
//
// Trust model: the write endpoint is open, so treat every field as hostile. Length
// caps, a strict shape check and a per-submitter rate limit are enforced below;
// the submitter's IP is salted and hashed for rate limiting and never stored.

const LIMITS = {
  body: 8192,        // bytes of JSON we will even parse
  name: 40,
  author: 24,
  note: 120,
  word: 18,
  tiers: 24,         // a palette longer than this is not a palette
  minTiers: 2,
  lo: 1e9,
  perHour: 5,        // submissions per author_key per hour
  heartsPerHour: 60, // heart/un-heart actions per voter_key per hour
  page: 24,
};

// Default ordering: one heart is worth three days of freshness. Hearts and age are
// traded off additively rather than as a ratio, which matters here because palettes
// arrive days apart, not seconds - the usual divide-by-age-in-hours ranking decays
// so fast that a week-old entry could not be rescued by any realistic number of
// hearts, which is the opposite of what hearting is for. Plain arithmetic on
// purpose: SQLite's POWER() and LOG() sit behind a compile flag, and this has to
// run identically on D1 and under test.
const HEART_DAYS = 3;
const HOT_RANK = `(likes * ${HEART_DAYS}.0 + (created - ?) / 86400000.0)`;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
});
const bad = (message, status = 400) => json({ error: message }, status);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * A stable per-submitter key: SHA-256 over the client IP and a salt, hex, truncated.
 * This is what rate limiting and like-dedupe key on, and it is deliberately all we
 * keep - the IP itself is never written anywhere.
 *
 * `env.IP_SALT` should be set (`npx wrangler secret put IP_SALT`). Without it the
 * hash is still not reversible to an IP by anyone reading the table, but it is
 * guessable by anyone who can enumerate IPs, so the fallback is a dev convenience
 * and not a production one.
 */
async function callerKey(request, env) {
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || '0.0.0.0';
  const data = new TextEncoder().encode((env && env.IP_SALT || 'rngdle-dev-salt') + '|' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

// URL-safe id. 10 chars of base32-ish alphabet is ~50 bits - far more than a
// gallery of hand-made palettes will ever need, and short enough to paste.
function newId() {
  const abc = '23456789abcdefghjkmnpqrstuvwxyz';
  const r = crypto.getRandomValues(new Uint8Array(10));
  return [...r].map(b => abc[b % abc.length]).join('');
}

// ---------------------------------------------------------------------------
// Validation
//
// Every one of these returns a cleaned value or throws a message meant to be read
// by whoever is submitting - the client shows it verbatim.
// ---------------------------------------------------------------------------

class Invalid extends Error {}

// Strip C0/C1 controls and collapse whitespace. Nothing below is rendered as HTML
// by the server, but the client interpolates it, so keep it boring.
function clean(v, max, field) {
  const s = String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new Invalid(`${field} is longer than ${max} characters.`);
  return s;
}

function cleanTiers(raw) {
  if (!Array.isArray(raw)) throw new Invalid('Tiers must be a list.');
  if (raw.length < LIMITS.minTiers) throw new Invalid(`A palette needs at least ${LIMITS.minTiers} tiers.`);
  if (raw.length > LIMITS.tiers) throw new Invalid(`A palette can have at most ${LIMITS.tiers} tiers.`);

  const tiers = raw.map((t, i) => {
    if (!t || typeof t !== 'object') throw new Invalid(`Tier ${i + 1} is not readable.`);
    const word = clean(t.word, LIMITS.word, `Tier ${i + 1}'s word`).toUpperCase();
    if (!word) throw new Invalid(`Tier ${i + 1} has no word.`);
    const hex = String(t.hex || '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Invalid(`Tier ${i + 1} ("${word}") has no valid #rrggbb colour.`);
    const lo = Math.floor(Number(t.lo));
    if (!Number.isFinite(lo) || lo < 0 || lo > LIMITS.lo) throw new Invalid(`Tier ${i + 1} ("${word}") has an EP floor outside 0..${LIMITS.lo}.`);
    return { word, hex, lo };
  });

  // Sorting rather than rejecting: a palette typed out of order is a fine palette,
  // it was just typed out of order. Equal floors are a real problem though - the
  // second tier could never be anything's landing tier - so those are refused.
  tiers.sort((a, b) => a.lo - b.lo);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].lo === tiers[i - 1].lo) {
      throw new Invalid(`"${tiers[i - 1].word}" and "${tiers[i].word}" both start at ${tiers[i].lo} EP - one of them could never be reached.`);
    }
  }
  return tiers;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// DB row -> what the client sees. author_key and hidden never leave the server.
function publicRow(row) {
  let tiers = [];
  try { tiers = JSON.parse(row.tiers); } catch (e) { tiers = []; }
  return {
    id: row.id, name: row.name, author: row.author, note: row.note,
    tiers, tierCount: row.tier_count, created: row.created, likes: row.likes,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Handle a /api/palettes[...] request. Returns a Response, or null if the path is
 * not a gallery route (so the caller falls through to its own 404).
 *
 * @param {URL}     url      the parsed request url
 * @param {Request} request
 * @param {object}  env      Worker bindings; env.DB is the D1 database
 */
export async function handleGallery(url, request, env) {
  const path = url.pathname.replace(/\/$/, '');
  if (path !== '/api/palettes' && !path.startsWith('/api/palettes/')) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, x-admin-token',
      },
    });
  }

  const db = env && env.DB;
  const NO_DB = 'The palette gallery is not configured on this deployment.';
  if (!db) {
    // Browsing a gallery that does not exist is an empty gallery, not a failure -
    // and answering 200 keeps a page load free of console errors on a deployment
    // that never had a database. Trying to WRITE to one is a real 503.
    if (request.method === 'GET') {
      return json({ error: NO_DB, unconfigured: true, palettes: [], more: false, sort: 'new', offset: 0 });
    }
    return json({ error: NO_DB, unconfigured: true }, 503);
  }

  const rest = path.slice('/api/palettes'.length).replace(/^\//, '');   // '' | '<id>' | '<id>/like'

  try {
    if (!rest) {
      if (request.method === 'GET') return await listPalettes(url, db);
      if (request.method === 'POST') return await createPalette(request, env, db);
      return bad('Use GET to browse or POST to publish.', 405);
    }

    const [id, action] = rest.split('/');
    if (!/^[a-z0-9]{4,32}$/.test(id)) return bad('No palette with that id.', 404);

    if (action === 'like' && request.method === 'POST') return await likePalette(id, request, env, db);
    if (!action && request.method === 'GET') return await getPalette(id, db);
    if (!action && request.method === 'DELETE') return await hidePalette(id, request, env, db);
    return bad('Not a palette route.', 404);
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    // A missing table is the overwhelmingly likely cause here and the fix is a
    // documented one-liner, so name it instead of returning a bare 500.
    if (/no such table/i.test(String(e && e.message))) {
      return json({ error: 'The gallery tables do not exist yet - apply schema.sql.', unconfigured: true }, 503);
    }
    return json({ error: 'The gallery could not answer that.' }, 500);
  }
}

async function listPalettes(url, db) {
  const asked = url.searchParams.get('sort');
  const sort = asked === 'top' || asked === 'new' ? asked : 'hot';
  const limit = Math.min(LIMITS.page, Math.max(1, Number(url.searchParams.get('limit')) || LIMITS.page));
  const offset = Math.max(0, Math.min(5000, Number(url.searchParams.get('offset')) || 0));

  //  hot  hearts, decayed by age (the default)
  //  top  most hearted outright
  //  new  newest first
  const order = sort === 'top' ? 'likes DESC, created DESC'
    : sort === 'new' ? 'created DESC'
    : `${HOT_RANK} DESC, created DESC`;
  // The rank expression is the only ordering that binds a parameter, and it has to
  // bind ahead of the LIMIT/OFFSET pair because it appears earlier in the statement.
  const args = sort === 'hot' ? [Date.now(), limit + 1, offset] : [limit + 1, offset];

  // limit + 1 is the "is there another page" probe - cheaper than a second COUNT.
  const rows = await db.prepare(
    `SELECT id, name, author, note, tiers, tier_count, created, likes
       FROM palettes WHERE hidden = 0 ORDER BY ${order} LIMIT ? OFFSET ?`
  ).bind(...args).all();

  const list = (rows.results || []).map(publicRow);
  const more = list.length > limit;
  return json({ sort, offset, palettes: more ? list.slice(0, limit) : list, more });
}

async function getPalette(id, db) {
  const row = await db.prepare(
    `SELECT id, name, author, note, tiers, tier_count, created, likes
       FROM palettes WHERE id = ? AND hidden = 0`
  ).bind(id).first();
  return row ? json(publicRow(row)) : bad('No palette with that id.', 404);
}

async function createPalette(request, env, db) {
  const raw = await request.text();
  if (raw.length > LIMITS.body) return bad('That palette is too large to publish.', 413);
  let payload;
  try { payload = JSON.parse(raw); } catch (e) { return bad('Could not read that as JSON.'); }

  const name = clean(payload.name, LIMITS.name, 'The name');
  if (!name) throw new Invalid('Give the palette a name.');
  const author = clean(payload.author, LIMITS.author, 'The author');
  const note = clean(payload.note, LIMITS.note, 'The note');
  const tiers = cleanTiers(payload.tiers);

  const key = await callerKey(request, env);
  const now = Date.now();

  const recent = await db.prepare(
    'SELECT COUNT(*) AS c FROM palettes WHERE author_key = ? AND created > ?'
  ).bind(key, now - 3600_000).first();
  if (recent && recent.c >= LIMITS.perHour) {
    return bad(`That is ${LIMITS.perHour} palettes in an hour, which is enough for now. Try again later.`, 429);
  }

  // Republishing the identical palette is almost always a double-click or a retry,
  // so hand back what is already there instead of a duplicate row.
  const body = JSON.stringify(tiers);
  const dupe = await db.prepare(
    'SELECT id FROM palettes WHERE author_key = ? AND tiers = ? AND hidden = 0 AND created > ?'
  ).bind(key, body, now - 86_400_000).first();
  if (dupe) return json({ id: dupe.id, duplicate: true });

  const id = newId();
  await db.prepare(
    `INSERT INTO palettes (id, name, author, note, tiers, tier_count, created, author_key, likes, hidden)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
  ).bind(id, name, author, note, body, tiers.length, now, key).run();

  return json({ id, name, author, note, tiers, tierCount: tiers.length, created: now, likes: 0 }, 201);
}

async function likePalette(id, request, env, db) {
  const key = await callerKey(request, env);
  const exists = await db.prepare('SELECT likes FROM palettes WHERE id = ? AND hidden = 0').bind(id).first();
  if (!exists) return bad('No palette with that id.', 404);

  const now = Date.now();
  // Per-IP heart rate limit. The PK below already stops one caller counting twice
  // on one palette, but nothing stopped a toggle loop or a sweep across the whole
  // gallery, and hearts decide the default ordering - so they have to cost something.
  const spent = await db.prepare(
    'SELECT COUNT(*) AS c FROM like_events WHERE voter_key = ? AND created > ?'
  ).bind(key, now - 3600_000).first();
  if (spent && spent.c >= LIMITS.heartsPerHour) {
    return bad(`That is ${LIMITS.heartsPerHour} hearts in an hour. Try again later.`, 429);
  }
  await db.prepare('INSERT INTO like_events (voter_key, created) VALUES (?, ?)').bind(key, now).run();

  // Toggle. The PK on (palette_id, voter_key) is what makes this idempotent per
  // voter; the count on palettes is a denormalisation kept in step right here.
  const had = await db.prepare(
    'SELECT 1 AS x FROM palette_likes WHERE palette_id = ? AND voter_key = ?'
  ).bind(id, key).first();

  if (had) {
    await db.prepare('DELETE FROM palette_likes WHERE palette_id = ? AND voter_key = ?').bind(id, key).run();
    await db.prepare('UPDATE palettes SET likes = MAX(0, likes - 1) WHERE id = ?').bind(id).run();
  } else {
    await db.prepare('INSERT INTO palette_likes (palette_id, voter_key, created) VALUES (?, ?, ?)')
      .bind(id, key, now).run();
    await db.prepare('UPDATE palettes SET likes = likes + 1 WHERE id = ?').bind(id).run();
  }

  const after = await db.prepare('SELECT likes FROM palettes WHERE id = ?').bind(id).first();
  return json({ id, likes: after ? after.likes : 0, liked: !had });
}

// Moderation. Guarded by env.ADMIN_TOKEN (`npx wrangler secret put ADMIN_TOKEN`);
// with no token set, nothing can be hidden through the API at all - which is the
// right default for a route that would otherwise be an open delete button.
async function hidePalette(id, request, env, db) {
  const token = env && env.ADMIN_TOKEN;
  if (!token) return bad('Moderation is not configured on this deployment.', 503);
  if (request.headers.get('x-admin-token') !== token) return bad('Not allowed.', 403);
  const res = await db.prepare('UPDATE palettes SET hidden = 1 WHERE id = ?').bind(id).run();
  return json({ id, hidden: true, changed: res && res.meta ? res.meta.changes : undefined });
}

// Which likes belong to this caller, so the gallery can show its own votes as
// already cast. Separate from the list so the list stays cacheable.
export async function handleMyLikes(url, request, env) {
  if (url.pathname.replace(/\/$/, '') !== '/api/palettes-liked') return null;
  const db = env && env.DB;
  if (!db) return json({ liked: [] });
  try {
    const key = await callerKey(request, env);
    const rows = await db.prepare('SELECT palette_id FROM palette_likes WHERE voter_key = ?').bind(key).all();
    return json({ liked: (rows.results || []).map(r => r.palette_id) });
  } catch (e) {
    return json({ liked: [] });
  }
}
