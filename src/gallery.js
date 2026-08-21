// Palette gallery for the Box Lab (/beta/boxes) - the one part of this site that
// stores anything. Everything else is a pure function of the number you typed;
// this holds what other people invented, so it needs a database.
//
// Storage is D1, bound as `env.DB`. test/gallery.mjs stands up node:sqlite behind the
// same prepare/bind/first/all/run/batch surface, so the SQL below is the only copy and
// what the tests exercise is what production runs. Schema: schema.sql.
//
// Round trips are the cost that matters here, not CPU: every statement is a hop to a
// database that is not in this datacentre, and D1 bills the rows each one reads. So
// independent reads are folded into one statement with scalar subqueries, writes that
// belong together go through batch() (one hop, and one transaction), and every query
// has an index behind it - see schema.sql, where each index names the query it serves.
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
  likedCap: 1000,    // hearts /api/palettes-liked will report for one caller
};

// Default ordering: one heart is worth three days of freshness. Hearts and age are
// traded off additively rather than as a ratio, which matters here because palettes
// arrive days apart, not seconds - the usual divide-by-age-in-hours ranking decays
// so fast that a week-old entry could not be rescued by any realistic number of
// hearts, which is the opposite of what hearting is for. Plain arithmetic on
// purpose: SQLite's POWER() and LOG() sit behind a compile flag, and this has to
// run identically on D1 and under test.
//
// The rank was once written `(created - now)` and took `now` as a bind parameter. It
// no longer does, and the reason is worth keeping: `now` is one value for the whole
// query, so subtracting it shifts every row equally and cannot change the order. What
// it did change was whether the ordering could be indexed at all - a rank that depends
// on a parameter has to be computed per row and sorted, which meant the default sort
// read every visible palette and built a temp B-tree on each page load. Dropping the
// term leaves an expression of columns alone, which schema.sql indexes as palettes_hot.
//
// That index has to spell this expression identically, so the two move together.
const HEART_DAYS = 3;
const HOT_RANK = `(likes * ${HEART_DAYS}.0 + created / 86400000.0)`;

// The columns any palette is handed back with. tier_count is deliberately absent: it
// is always 1 and publicRow has never read it, so selecting it only paid to move it.
const COLS = 'id, name, author, note, tiers, created, likes';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
});
const bad = (message, status = 400) => json({ error: message }, status);

/**
 * Run several statements as one unit. D1's batch() sends them in a single round trip
 * and wraps them in a transaction, which is what the heart toggle needs - its delete
 * and its counter update are one change to the gallery, not two.
 *
 * The sequential fallback is for any binding without batch(). It is a real fallback,
 * not a pretence: the statements still run, just in as many hops and without the
 * transaction. Nothing in this file depends on it, and D1 always has batch().
 */
function runAll(db, statements) {
  if (typeof db.batch === 'function') return db.batch(statements);
  return statements.reduce(
    (chain, s) => chain.then(async acc => [...acc, await s.run()]),
    Promise.resolve([]),
  );
}

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
      return json({
        error: NO_DB, unconfigured: true,
        palettes: [], more: false, sort: 'new', offset: 0, cursor: null,
      });
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

// What each sort ranks by. `new` ranks by created, which is also every other sort's
// tiebreak - so for `new` the rank and the tiebreak are one column, and one comparison
// settles a position instead of two.
const RANK_BY = { top: 'likes', new: 'created', hot: HOT_RANK };

// Every ordering ends in rowid, and it is not decoration. A cursor says "resume strictly
// after this position", so the position has to identify exactly one row - if two
// palettes tie on rank and on created, a cursor cut from one of them excludes both and
// the other is never handed out. rowid is unique by construction, so the full sort key
// is too. SQLite appends rowid to every non-unique index in ascending order, which is
// why adding it costs no sort: it is the order the index was already in.
const TIEBREAK = 'rowid';

/**
 * Decode a page cursor: the sort position of the last row of the previous page.
 *
 * Cursors are opaque - read one out of a response, never build one. Anything that does
 * not parse is treated as absent rather than as an error, so a stale, truncated or
 * hand-edited link shows the first page instead of a 400.
 */
function parseCursor(raw) {
  if (!raw) return null;
  const parts = String(raw).split('_').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  return { rank: parts[0], created: parts[1], rid: parts[2] };
}

const cursorOf = row => `${row.rank}_${row.created}_${row.rid}`;

/**
 * The "strictly after this position" predicate for a lexicographic ordering, built as
 * the usual nested comparison: earlier terms decide, and a tie on one defers to the
 * next. Terms carry their own comparison because the ordering is not all one way -
 * rank and created descend, rowid ascends.
 *
 * @param {Array<{sql: string, cmp: string, value: number}>} terms  in ordering order
 * @returns {{sql: string, args: number[]}}  bind args, in the order the sql needs them
 */
function keysetAfter(terms) {
  const step = i => {
    const { sql, cmp, value } = terms[i];
    if (i === terms.length - 1) return { sql: `${sql} ${cmp} ?`, args: [value] };
    const rest = step(i + 1);
    return {
      sql: `(${sql} ${cmp} ? OR (${sql} = ? AND ${rest.sql}))`,
      args: [value, value, ...rest.args],
    };
  };
  return step(0);
}

async function listPalettes(url, db) {
  const asked = url.searchParams.get('sort');
  const sort = asked === 'top' || asked === 'new' ? asked : 'hot';
  const limit = Math.min(LIMITS.page, Math.max(1, Number(url.searchParams.get('limit')) || LIMITS.page));

  // Two ways to ask for a later page, and they cost very different amounts. OFFSET
  // makes the database walk and discard every row of every earlier page - rows D1
  // charges for and nobody ever sees, so page five costs five pages. A cursor seeks
  // straight into the index at the point the last page stopped, so every page costs
  // exactly one page. OFFSET stays for links and clients written before cursors
  // existed; a request carrying both is honouring the cursor, because a position is
  // more accurate than a page number.
  const cursor = parseCursor(url.searchParams.get('cursor'));
  const offset = cursor ? 0
    : Math.max(0, Math.min(5000, Number(url.searchParams.get('offset')) || 0));

  //  hot  hearts, decayed by age (the default)
  //  top  most hearted outright
  //  new  newest first
  //
  // For `new` the rank IS created, so naming it twice in the ordering would just be
  // comparing a column with itself - the sort key is (created DESC, rowid).
  //
  // Each term carries how it sorts, how "after" compares under that direction, and
  // where its value lives on a cursor - the three always move together.
  const rank = RANK_BY[sort];
  const BY_RANK    = { sql: rank,     dir: ' DESC', cmp: '<', of: c => c.rank };
  const BY_CREATED = { sql: 'created', dir: ' DESC', cmp: '<', of: c => c.created };
  const BY_ROWID   = { sql: TIEBREAK,  dir: '',      cmp: '>', of: c => c.rid };
  const keyTerms = sort === 'new'
    ? [BY_CREATED, BY_ROWID]
    : [BY_RANK, BY_CREATED, BY_ROWID];
  const order = keyTerms.map(t => t.sql + t.dir).join(', ');

  // Seek straight to the cursor's position in the index. Every sort has an index
  // leading with hidden, so this is a seek rather than a filter applied to rows that
  // had to be read first.
  const where = ['hidden = 0'];
  const args = [];
  if (cursor) {
    const seek = keysetAfter(keyTerms.map(t => ({ ...t, value: t.of(cursor) })));
    where.push(seek.sql);
    args.push(...seek.args);
  }

  // limit + 1 is the "is there another page" probe - cheaper than a second COUNT.
  // The rank and rowid come back with the row so the next cursor can be cut from it;
  // publicRow builds its output field by field, so neither reaches the client.
  const rows = await db.prepare(
    `SELECT ${COLS}, ${rank} AS rank, ${TIEBREAK} AS rid FROM palettes
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).bind(...args, limit + 1, offset).all();

  const found = rows.results || [];
  const more = found.length > limit;
  const page = more ? found.slice(0, limit) : found;
  const last = page[page.length - 1];
  return json({
    sort,
    offset,
    palettes: page.map(publicRow),
    more,
    cursor: more && last ? cursorOf(last) : null,
  });
}

// The one query that reads a palette by id: getPalette answers a request with it and
// loadDesign hands the same row to the share page as plain data. Two copies of one
// SELECT is two things to keep in step, and hidden = 0 is the half that matters -
// forget it in one copy and moderation stops reaching one of the two routes.
const selectOne = (db, id) =>
  db.prepare(`SELECT ${COLS} FROM palettes WHERE id = ? AND hidden = 0`).bind(id).first();

async function getPalette(id, db) {
  const row = await selectOne(db, id);
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
  const body = JSON.stringify(design);

  // Both of the questions a publish has to answer first, in one round trip. They are
  // independent - how many palettes this author posted in the last hour, and whether
  // this exact design is already up - and both are seeks on the same (author_key,
  // created) index, so asking separately bought nothing but a second hop.
  const pre = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM palettes
          WHERE author_key = ? AND created > ?) AS recent,
       (SELECT id FROM palettes
          WHERE author_key = ? AND tiers = ? AND hidden = 0 AND created > ?) AS dupe`
  ).bind(key, now - 3600_000, key, body, now - 86_400_000).first();

  if (pre && pre.recent >= LIMITS.perHour) {
    return bad(`That is ${LIMITS.perHour} palettes in an hour, which is enough for now. Try again later.`, 429);
  }

  // Republishing the identical palette is almost always a double-click or a retry,
  // so hand back what is already there instead of a duplicate row.
  if (pre && pre.dupe) return json({ id: pre.dupe, duplicate: true });

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
  const now = Date.now();
  const cutoff = now - 3600_000;

  // Everything hearting has to know, in one round trip. Three independent point
  // lookups, each on an index: does this palette exist and how many hearts has it,
  // how many hearts has this caller spent inside the window, and has this caller
  // already hearted this one. likes is NOT NULL in the schema, so a null there can
  // only mean there was no visible row to read it from.
  const pre = await db.prepare(
    `SELECT
       (SELECT likes FROM palettes WHERE id = ? AND hidden = 0) AS likes,
       (SELECT COUNT(*) FROM like_events WHERE voter_key = ? AND created > ?) AS spent,
       (SELECT 1 FROM palette_likes WHERE palette_id = ? AND voter_key = ?) AS had`
  ).bind(id, key, cutoff, id, key).first();

  if (!pre || pre.likes == null) return bad('No palette with that id.', 404);

  // Per-IP heart rate limit. The PK below already stops one caller counting twice
  // on one palette, but nothing stopped a toggle loop or a sweep across the whole
  // gallery, and hearts decide the default ordering - so they have to cost something.
  if (pre.spent >= LIMITS.heartsPerHour) {
    return bad(`That is ${LIMITS.heartsPerHour} hearts in an hour. Try again later.`, 429);
  }
  const had = !!pre.had;

  // All four writes as one batch: one round trip, and one transaction. The second
  // matters as much as the first - the toggle row and the denormalised count on
  // palettes are a single change to the gallery, and a failure between them used to
  // be able to leave a heart with no count or a count with no heart.
  const results = await runAll(db, [
    db.prepare('INSERT INTO like_events (voter_key, created) VALUES (?, ?)').bind(key, now),

    // like_events exists only to answer "how many hearts in the last hour", so
    // anything older is dead weight - and dead weight here is a stored identifier
    // that no longer does any work. Pruning on every write holds the table to roughly
    // one hour of activity, and like_events_created is what keeps the delete itself
    // touching only the expired rows instead of reading the table to find them.
    db.prepare('DELETE FROM like_events WHERE created <= ?').bind(cutoff),

    // Toggle. The PK on (palette_id, voter_key) is what makes this idempotent per voter.
    had
      ? db.prepare('DELETE FROM palette_likes WHERE palette_id = ? AND voter_key = ?').bind(id, key)
      : db.prepare('INSERT INTO palette_likes (palette_id, voter_key, created) VALUES (?, ?, ?)')
        .bind(id, key, now),

    // RETURNING is what removes the old read-it-back query: the new count travels home
    // with the update that produced it, so the caller still gets an authoritative
    // number without a fifth statement to fetch it.
    had
      ? db.prepare('UPDATE palettes SET likes = MAX(0, likes - 1) WHERE id = ? RETURNING likes').bind(id)
      : db.prepare('UPDATE palettes SET likes = likes + 1 WHERE id = ? RETURNING likes').bind(id),
  ]);

  // Prefer what the update returned. The fallback is the same arithmetic that update
  // just performed, for any binding whose batch hands back no rows - a count that can
  // only be stale if someone else hearted the same palette in the same instant, and
  // the next list load corrects it.
  const last = results && results[results.length - 1];
  const row = last && last.results && last.results[0];
  const likes = row && row.likes != null
    ? row.likes
    : (had ? Math.max(0, pre.likes - 1) : pre.likes + 1);

  return json({ id, likes, liked: !had });
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
    const row = await selectOne(db, id);
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
    // palette_likes is keyed (palette_id, voter_key), so a lookup by voter alone
    // cannot use that key and read the whole table on every Box Lab page load -
    // palette_likes_voter turns it into a covering read of this caller's rows only.
    //
    // The cap is a ceiling on the response, not on anyone's hearts: at 60 hearts an
    // hour, reaching it is deliberate work, and the cost of exceeding it is that some
    // of this caller's hearts draw unfilled until they un-heart something. Which ones
    // is whatever the index reaches first - there is no ordering here, because adding
    // one would cost a sort to decide something nobody past the cap will notice.
    const rows = await db.prepare(
      'SELECT palette_id FROM palette_likes WHERE voter_key = ? LIMIT ?'
    ).bind(key, LIMITS.likedCap).all();
    return json({ liked: (rows.results || []).map(r => r.palette_id) });
  } catch (e) {
    return json({ liked: [] });
  }
}
