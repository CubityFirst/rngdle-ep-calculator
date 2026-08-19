// Tests for the palette gallery (src/gallery.js) - the validation, the rate limit,
// the like toggle and the moderation gate, all against the real schema.sql.
//
//   node test/gallery.mjs
//
// D1 is stood up here as node:sqlite behind the same prepare/bind/first/all/run
// surface the Worker binding exposes, so every query below is the query that runs
// in production. This lives in the test and not in serve.mjs on purpose: the dev
// server has no bindings and the gallery answers 503 there, which is a state worth
// keeping honest. To exercise the real D1, use `npx wrangler dev`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handleGallery, handleMyLikes } from '../src/gallery.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL  ${name}${extra ? '\n        ' + extra : ''}`);
}

function freshDB() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  // D1 statements are immutable and bind() returns a new one; node:sqlite takes its
  // arguments at call time. Carrying them on the wrapper is the whole adapter.
  const wrap = (sql, args = []) => ({
    bind: (...next) => wrap(sql, next),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
  });
  return { prepare: sql => wrap(sql) };
}

const PROD_LIKE = [
  { word: 'TRASH', hex: '#733e0a', lo: 0 },
  { word: 'COMMON', hex: '#4a5565', lo: 2098 },
  { word: 'MYTHIC', hex: '#c10007', lo: 164953 },
];

// One caller = one IP. The gallery keys rate limiting and likes off a salted hash
// of it, so varying this is how a test plays a different person.
function call(url, { method = 'GET', body, ip = '10.0.0.1', headers = {} } = {}) {
  const req = new Request('http://x' + url, {
    method,
    headers: { 'cf-connecting-ip': ip, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { req, u: new URL('http://x' + url) };
}
async function api(env, url, opts) {
  const { req, u } = call(url, opts);
  const res = (await handleGallery(u, req, env)) || (await handleMyLikes(u, req, env));
  return { status: res.status, body: await res.json() };
}

// --------------------------------------------------------------------------
console.log('gallery');

{
  // No binding at all. Reading is an empty gallery (200, so a page load stays free
  // of console errors on a deployment that never had a database); writing is a 503,
  // because a publish that goes nowhere must not look like it worked.
  let r = await api({}, '/api/palettes');
  check('no DB -> read is 200 and empty', r.status === 200 && r.body.unconfigured === true
    && r.body.palettes.length === 0 && r.body.more === false, JSON.stringify(r.body));

  r = await api({}, '/api/palettes', { method: 'POST', body: { name: 'x', tiers: PROD_LIKE } });
  check('no DB -> write is 503', r.status === 503 && r.body.unconfigured === true, JSON.stringify(r.body));

  r = await api({}, '/api/palettes-liked');
  check('no DB -> liked is empty', r.status === 200 && r.body.liked.length === 0);
}

{
  const env = { DB: freshDB(), IP_SALT: 'test' };

  let r = await api(env, '/api/palettes');
  check('empty gallery lists nothing', r.status === 200 && r.body.palettes.length === 0 && r.body.more === false);

  // --- publishing ---------------------------------------------------------
  r = await api(env, '/api/palettes', { method: 'POST', body: { name: 'Deep Sea', author: 'ada', note: 'cold', tiers: PROD_LIKE } });
  check('publish -> 201 with an id', r.status === 201 && typeof r.body.id === 'string' && r.body.id.length >= 4, JSON.stringify(r.body));
  const id = r.body.id;
  check('publish echoes the tiers', r.body.tierCount === 3 && r.body.tiers[0].word === 'TRASH');

  r = await api(env, '/api/palettes');
  check('published palette is listed', r.body.palettes.length === 1 && r.body.palettes[0].id === id);
  check('author_key never leaves the server', !('author_key' in r.body.palettes[0]) && !('hidden' in r.body.palettes[0]));

  r = await api(env, '/api/palettes/' + id);
  check('fetch one by id', r.status === 200 && r.body.name === 'Deep Sea' && r.body.author === 'ada');

  // --- validation ---------------------------------------------------------
  const rejects = [
    ['no name', { name: '  ', tiers: PROD_LIKE }],
    ['name too long', { name: 'x'.repeat(41), tiers: PROD_LIKE }],
    ['one tier', { name: 'a', tiers: [PROD_LIKE[0]] }],
    ['26 tiers', { name: 'a', tiers: Array.from({ length: 26 }, (_, i) => ({ word: 'W' + i, hex: '#112233', lo: i })) }],
    ['bad hex', { name: 'a', tiers: [{ word: 'A', hex: 'red', lo: 0 }, { word: 'B', hex: '#123456', lo: 5 }] }],
    ['short hex', { name: 'a', tiers: [{ word: 'A', hex: '#123', lo: 0 }, { word: 'B', hex: '#123456', lo: 5 }] }],
    ['empty word', { name: 'a', tiers: [{ word: '', hex: '#112233', lo: 0 }, { word: 'B', hex: '#123456', lo: 5 }] }],
    ['word too long', { name: 'a', tiers: [{ word: 'x'.repeat(19), hex: '#112233', lo: 0 }, { word: 'B', hex: '#123456', lo: 5 }] }],
    ['negative floor', { name: 'a', tiers: [{ word: 'A', hex: '#112233', lo: -1 }, { word: 'B', hex: '#123456', lo: 5 }] }],
    ['duplicate floors', { name: 'a', tiers: [{ word: 'A', hex: '#112233', lo: 7 }, { word: 'B', hex: '#123456', lo: 7 }] }],
    ['tiers not a list', { name: 'a', tiers: 'nope' }],
  ];
  for (const [label, body] of rejects) {
    const rr = await api(env, '/api/palettes', { method: 'POST', body, ip: '10.0.0.9' });
    check('reject: ' + label, rr.status === 400 && typeof rr.body.error === 'string', `got ${rr.status} ${JSON.stringify(rr.body)}`);
  }

  // Out-of-order floors are sorted, not refused - a palette typed backwards is
  // still a palette.
  r = await api(env, '/api/palettes', {
    method: 'POST', ip: '10.0.0.2',
    body: { name: 'Backwards', tiers: [{ word: 'HIGH', hex: '#ffffff', lo: 900 }, { word: 'LOW', hex: '#000000', lo: 10 }] },
  });
  check('out-of-order floors are sorted', r.status === 201 && r.body.tiers[0].word === 'LOW', JSON.stringify(r.body.tiers));

  // Control characters are stripped rather than stored.
  r = await api(env, '/api/palettes', {
    method: 'POST', ip: '10.0.0.3',
    body: { name: 'Bell\u0007Name', tiers: PROD_LIKE },
  });
  check('control chars stripped from the name', r.status === 201 && !/\u0007/.test(r.body.name), JSON.stringify(r.body.name));
  check('a hyphen survives cleaning', /Bell Name/.test(r.body.name), JSON.stringify(r.body.name));

  r = await api(env, '/api/palettes', { method: 'POST', ip: '10.0.0.4', body: { name: 'Punc-tu&ted +1', tiers: PROD_LIKE } });
  check('punctuation survives cleaning', r.status === 201 && r.body.name === 'Punc-tu&ted +1', JSON.stringify(r.body.name));

  // --- dedupe + rate limit ------------------------------------------------
  r = await api(env, '/api/palettes', { method: 'POST', body: { name: 'Deep Sea again', tiers: PROD_LIKE } });
  check('identical repost is deduped', r.status === 200 && r.body.duplicate === true && r.body.id === id, JSON.stringify(r.body));

  let limited = null;
  for (let i = 0; i < 8 && !limited; i++) {
    const rr = await api(env, '/api/palettes', {
      method: 'POST', ip: '10.0.0.77',
      body: { name: 'spam ' + i, tiers: [{ word: 'A', hex: '#112233', lo: 0 }, { word: 'B', hex: '#445566', lo: 10 + i }] },
    });
    if (rr.status === 429) limited = i;
  }
  check('rate limit kicks in at 5/hour', limited === 5, `limited after ${limited}`);

  // --- likes --------------------------------------------------------------
  r = await api(env, '/api/palettes/' + id + '/like', { method: 'POST', ip: '10.0.0.5' });
  check('like -> 1', r.body.likes === 1 && r.body.liked === true, JSON.stringify(r.body));
  r = await api(env, '/api/palettes/' + id + '/like', { method: 'POST', ip: '10.0.0.5' });
  check('same voter toggles back off', r.body.likes === 0 && r.body.liked === false, JSON.stringify(r.body));
  await api(env, '/api/palettes/' + id + '/like', { method: 'POST', ip: '10.0.0.5' });
  await api(env, '/api/palettes/' + id + '/like', { method: 'POST', ip: '10.0.0.6' });
  r = await api(env, '/api/palettes/' + id);
  check('two voters -> 2 likes', r.body.likes === 2, JSON.stringify(r.body.likes));

  r = await api(env, '/api/palettes-liked', { ip: '10.0.0.5' });
  check('a voter can see their own likes', r.body.liked.includes(id));
  r = await api(env, '/api/palettes-liked', { ip: '10.0.0.99' });
  check('and not other people\'s', !r.body.liked.includes(id));

  r = await api(env, '/api/palettes?sort=top');
  check('sort=top puts the liked one first', r.body.palettes[0].id === id, JSON.stringify(r.body.palettes.map(p => [p.name, p.likes])));

  r = await api(env, '/api/palettes/nosuchid1/like', { method: 'POST' });
  check('liking a missing palette 404s', r.status === 404);

  // --- paging -------------------------------------------------------------
  r = await api(env, '/api/palettes?limit=2');
  check('limit pages', r.body.palettes.length === 2 && r.body.more === true);
  r = await api(env, '/api/palettes?limit=2&offset=2');
  check('offset pages', r.body.palettes.length === 2 && r.body.offset === 2);

  // --- hot ordering -------------------------------------------------------
  // Hearts have to actually lift something, and they have to do it in the ordering
  // people land on rather than only under an explicit tab.
  r = await api(env, '/api/palettes');
  check('hot is the default sort', r.body.sort === 'hot', JSON.stringify(r.body.sort));
  check('hearted palette leads the default list', r.body.palettes[0].id === id,
    JSON.stringify(r.body.palettes.map(p => [p.name, p.likes])));

  // ...without the list freezing: an unhearted palette published now still outranks
  // an equally unhearted one from a week ago.
  const old = await api(env, '/api/palettes', {
    method: 'POST', ip: '10.0.0.30',
    body: { name: 'Ancient', tiers: [{ word: 'A', hex: '#111111', lo: 0 }, { word: 'B', hex: '#222222', lo: 40 }] },
  });
  await env.DB.prepare('UPDATE palettes SET created = ? WHERE id = ?')
    .bind(Date.now() - 7 * 86400_000, old.body.id).run();
  const young = await api(env, '/api/palettes', {
    method: 'POST', ip: '10.0.0.31',
    body: { name: 'Fresh', tiers: [{ word: 'A', hex: '#333333', lo: 0 }, { word: 'B', hex: '#444444', lo: 41 }] },
  });
  r = await api(env, '/api/palettes');
  const rank = r.body.palettes.map(p => p.id);
  check('age decays rank', rank.indexOf(young.body.id) < rank.indexOf(old.body.id),
    `fresh at ${rank.indexOf(young.body.id)}, week-old at ${rank.indexOf(old.body.id)}`);

  // ...and one heart is enough to pull the week-old one back above the fresh one.
  for (let i = 0; i < 3; i++) {
    await api(env, '/api/palettes/' + old.body.id + '/like', { method: 'POST', ip: '10.0.1.' + i });
  }
  r = await api(env, '/api/palettes');
  const rank2 = r.body.palettes.map(p => p.id);
  check('hearts lift an older palette back up', rank2.indexOf(old.body.id) < rank2.indexOf(young.body.id),
    `week-old at ${rank2.indexOf(old.body.id)}, fresh at ${rank2.indexOf(young.body.id)}`);

  // The trade is meant to be legible: three hearts (9 days' worth) beats a week of
  // age, one heart (3 days') does not.
  const oneHeart = await api(env, '/api/palettes', {
    method: 'POST', ip: '10.0.0.32',
    body: { name: 'Week old, one heart', tiers: [{ word: 'A', hex: '#555555', lo: 0 }, { word: 'B', hex: '#666666', lo: 42 }] },
  });
  await env.DB.prepare('UPDATE palettes SET created = ? WHERE id = ?')
    .bind(Date.now() - 7 * 86400_000, oneHeart.body.id).run();
  await api(env, '/api/palettes/' + oneHeart.body.id + '/like', { method: 'POST', ip: '10.0.2.1' });
  r = await api(env, '/api/palettes');
  const rank3 = r.body.palettes.map(p => p.id);
  check('one heart does not outweigh a week', rank3.indexOf(oneHeart.body.id) > rank3.indexOf(young.body.id),
    `one-heart week-old at ${rank3.indexOf(oneHeart.body.id)}, fresh at ${rank3.indexOf(young.body.id)}`);

  r = await api(env, '/api/palettes?sort=new');
  check('sort=new is still newest-first', r.body.sort === 'new' && r.body.palettes[0].id === young.body.id);

  // --- heart rate limit ---------------------------------------------------
  // One voter can only heart a given palette once, so a flood has to span palettes -
  // and toggling the same one off and on again has to count too, or the cap is free
  // to walk around.
  let heartLimited = null;
  for (let i = 0; i < 70 && heartLimited === null; i++) {
    const rr = await api(env, '/api/palettes/' + young.body.id + '/like', { method: 'POST', ip: '10.9.9.9' });
    if (rr.status === 429) heartLimited = i;
  }
  check('heart rate limit kicks in at 60/hour', heartLimited === 60, `limited after ${heartLimited}`);

  r = await api(env, '/api/palettes/' + young.body.id + '/like', { method: 'POST', ip: '10.9.9.8' });
  check('the cap is per caller, not global', r.status === 200, JSON.stringify(r.body));

  // --- moderation ---------------------------------------------------------
  r = await api(env, '/api/palettes/' + id, { method: 'DELETE' });
  check('no ADMIN_TOKEN -> moderation refused', r.status === 503, JSON.stringify(r.body));

  const modEnv = { ...env, ADMIN_TOKEN: 'sekrit' };
  r = await api(modEnv, '/api/palettes/' + id, { method: 'DELETE' });
  check('wrong token -> 403', r.status === 403);
  r = await api(modEnv, '/api/palettes/' + id, { method: 'DELETE', headers: { 'x-admin-token': 'sekrit' } });
  check('right token hides it', r.status === 200 && r.body.hidden === true, JSON.stringify(r.body));
  r = await api(modEnv, '/api/palettes/' + id);
  check('hidden palette is gone from the api', r.status === 404);
  r = await api(modEnv, '/api/palettes');
  check('hidden palette is gone from the list', !r.body.palettes.some(p => p.id === id));

  // --- routing ------------------------------------------------------------
  r = await api(env, '/api/palettes', { method: 'PUT', body: {} });
  check('PUT is refused', r.status === 405);
  const stray = await handleGallery(new URL('http://x/api/other'), new Request('http://x/api/other'), env);
  check('an unrelated path falls through', stray === null);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
