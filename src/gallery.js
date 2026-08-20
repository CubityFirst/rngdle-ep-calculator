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
// What is stored is ONE tier somebody designed - a name and the colours of a single
// box. Prod's seven tiers are fixed reference in the UI and are never submitted or
// edited, so nothing here can overwrite them.
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
  glowSize: 60,      // px of blur; past this it stops being a box and becomes a lamp
  sparkles: 14,      // any more and they stop reading as sparkles and start as noise
  radius: 28,        // px corner radius
  borderW: 8,        // px border width
  angle: 360,        // gradient angle in degrees
  breathe: 8,        // seconds per breath; 0 turns it off
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
 * A stable per-submitter key: SHA-256 over a salt and the client IP, truncated.
 * Rate limiting and heart-dedupe key on this; the IP itself is never written.
 *
 * Be precise about what that buys, because it is easy to overstate. Someone who
 * reads the database alone cannot recover addresses. Someone who ALSO has IP_SALT
 * can recover all of them: IPv4 is 2^32 addresses and SHA-256 is built to be fast,
 * so enumerating the whole space is minutes of GPU time - and confirming one
 * suspected address is a single hash, which works against IPv6 too. The protection
 * is that the salt stays secret, not that the hash is one-way in practice.
 *
 * The key is also stable, so it links one person's submissions and hearts to each
 * other. This is pseudonymous data, not anonymous data.
 *
 * `env.IP_SALT` must be set in production (`npx wrangler secret put IP_SALT`). The
 * fallback below is a literal in this file, so with it every key is reversible by
 * anyone who can read the source - it exists so the tests run, and nothing else.
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
  // Only ever stringify a primitive. String({toString: 1}) throws a TypeError rather
  // than returning something useless, and a TypeError here would escape as a 500 -
  // so a hostile payload could pick the status code. Refuse the shape instead.
  if (v != null && typeof v !== 'string' && typeof v !== 'number') {
    throw new Invalid(`${field} has to be text.`);
  }
  const s = String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new Invalid(`${field} is longer than ${max} characters.`);
  return s;
}

// A submission is ONE tier that somebody designed - not a palette. Prod's seven are
// fixed reference and are never sent, so everything below describes a single box:
// its name, the colours of each part of it, and whether it shimmers.
const HEX = /^#[0-9a-f]{6}$/;

function cleanDesign(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Invalid('No tier design was sent.');

  const word = clean(raw.word, LIMITS.word, 'The rarity name').toUpperCase();
  if (!word) throw new Invalid('Give the rarity a name.');

  const colour = (key, label) => {
    if (raw[key] != null && typeof raw[key] !== 'string') throw new Invalid(`${label} has to be text.`);
    const v = String(raw[key] || '').trim().toLowerCase();
    if (!HEX.test(v)) throw new Invalid(`${label} needs to be a #rrggbb colour.`);
    return v;
  };
  // Same rules, but absent means the default rather than a bad request - so a design
  // written before this colour existed still loads.
  const optColour = (key, label, fallback) => (raw[key] == null ? fallback : colour(key, label));

  const size = Math.round(Number(raw.glowSize));
  if (!Number.isFinite(size) || size < 0 || size > LIMITS.glowSize) {
    throw new Invalid(`Glow size has to be between 0 and ${LIMITS.glowSize}.`);
  }
  const alpha = Math.round(Number(raw.glowAlpha));
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 100) {
    throw new Invalid('Glow strength has to be between 0 and 100.');
  }
  const lo = Math.floor(Number(raw.lo));
  if (!Number.isFinite(lo) || lo < 0 || lo > LIMITS.lo) {
    throw new Invalid(`The EP floor has to be between 0 and ${LIMITS.lo}.`);
  }

  // Whole-number dials, each with a stated ceiling. A design is rendered straight
  // into CSS on everyone else's page, so none of these may arrive unbounded.
  const count = (v, max, label) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Invalid(`${label} has to be between 0 and ${max}.`);
    return n;
  };

  // Enumerated values are whitelists, never free text. Each of these is interpolated
  // into a CSS class name on everyone else's page, so an unknown value is refused
  // rather than passed through and hoped about.
  const oneOf = (v, allowed, label, dflt) => {
    if (v == null) return dflt;
    if (typeof v !== 'string' || allowed.indexOf(v) < 0) {
      throw new Invalid(`${label} has to be one of: ${allowed.join(', ')}.`);
    }
    return v;
  };
  const inkStyle = oneOf(raw.inkStyle, ['solid', 'gradient', 'outline'], 'Digit style', 'solid');
  const sparkShape = oneOf(raw.sparkShape,
    ['star', 'star5', 'diamond', 'dot', 'ring', 'plus', 'heart', 'hexagon', 'shard', 'confetti'],
    'Particle shape', 'star');
  const sparkMotion = oneOf(raw.sparkMotion,
    ['twinkle', 'rise', 'fall', 'orbit', 'spin', 'burst'], 'Particle motion', 'twinkle');

  return {
    word,
    bd: colour('bd', 'The border colour'),
    from: colour('from', 'The gradient start'),
    via: colour('via', 'The gradient middle'),
    to: colour('to', 'The gradient end'),
    ink: colour('ink', 'The digit colour'),
    glow: colour('glow', 'The glow colour'),
    glowSize: size,
    glowAlpha: alpha,
    shimmer: !!raw.shimmer,
    // --- the extras, none of which prod has ---
    // Each of these defaults when absent rather than being required: a design is a
    // description of a box, and a caller that says nothing about sparkles means a box
    // without sparkles, not a bad request.
    sparkles: raw.sparkles == null ? 0 : count(raw.sparkles, LIMITS.sparkles, 'Sparkle count'),
    spark: optColour('spark', 'The sparkle colour', '#ffffff'),
    sparkShadow: !!raw.sparkShadow,
    spill: !!raw.spill,
    sparkShape,
    sparkMotion,
    // Sparkle placement is scattered from this seed, so one design looks the same
    // in the strip, in the gallery and on anyone else's screen.
    seed: raw.seed == null ? 0 : count(raw.seed, 9999, 'The sparkle seed'),
    holo: !!raw.holo,
    ring: !!raw.ring,
    pulse: !!raw.pulse,
    radius: raw.radius == null ? 12 : count(raw.radius, LIMITS.radius, 'Corner radius'),
    borderW: raw.borderW == null ? 3 : count(raw.borderW, LIMITS.borderW, 'Border width'),
    angle: raw.angle == null ? 135 : count(raw.angle, LIMITS.angle, 'Gradient angle'),
    // Tenths of a second, so the whole design stays integers over the wire.
    breathe: raw.breathe == null ? 30 : count(raw.breathe, LIMITS.breathe * 10, 'Breathing speed'),
    inkStyle,
    lo,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// DB row -> what the client sees. author_key and hidden never leave the server.
function publicRow(row) {
  let design = null;
  try { design = JSON.parse(row.tiers); } catch (e) { design = null; }
  return {
    id: row.id, name: row.name, author: row.author, note: row.note,
    design, created: row.created, likes: row.likes,
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
  const design = cleanDesign(payload.design);

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
  const body = JSON.stringify(design);
  const dupe = await db.prepare(
    'SELECT id FROM palettes WHERE author_key = ? AND tiers = ? AND hidden = 0 AND created > ?'
  ).bind(key, body, now - 86_400_000).first();
  if (dupe) return json({ id: dupe.id, duplicate: true });

  const id = newId();
  // tier_count stays in the schema and is always 1 now - one design per submission.
  await db.prepare(
    `INSERT INTO palettes (id, name, author, note, tiers, tier_count, created, author_key, likes, hidden)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, 0)`
  ).bind(id, name, author, note, body, now, key).run();

  return json({ id, name, author, note, design, created: now, likes: 0 }, 201);
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

  // This table exists only to answer "how many hearts in the last hour", so anything
  // older is dead weight - and dead weight here is a stored identifier that no longer
  // does any work. Pruning on every write holds the table to roughly one hour of
  // activity, which is also what keeps this delete scanning next to nothing.
  await db.prepare('DELETE FROM like_events WHERE created <= ?').bind(now - 3600_000).run();

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

/**
 * One published rarity, as plain data rather than a Response - for the share page,
 * which needs the design in hand to render OG tags and seed the editor.
 * Returns null when there is no database, no such id, or it has been hidden.
 */
export async function loadDesign(env, id) {
  const db = env && env.DB;
  if (!db || !/^[a-z0-9]{4,32}$/.test(String(id || ''))) return null;
  try {
    const row = await db.prepare(
      `SELECT id, name, author, note, tiers, tier_count, created, likes
         FROM palettes WHERE id = ? AND hidden = 0`
    ).bind(id).first();
    return row ? publicRow(row) : null;
  } catch (e) {
    return null;
  }
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
