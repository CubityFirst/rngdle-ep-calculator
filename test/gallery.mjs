// Tests for the palette gallery (src/gallery.js) - the validation, the rate limits,
// the heart toggle, the hot ordering and the moderation gate, all against the real
// schema.sql.
//
//   node test/gallery.mjs
//
// D1 is stood up here as node:sqlite behind the same prepare/bind/first/all/run
// surface the Worker binding exposes, so every query below is the query that runs
// in production. This lives in the test and not in serve.mjs on purpose: the dev
// server has no bindings and the gallery is 503 there, which is a state worth
// keeping honest. To exercise the real D1, use `npx wrangler dev`.
//
// A submission is ONE tier somebody designed. Prod's seven are fixed reference in
// the UI and are never sent here, so nothing in this file describes a palette.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handleGallery, handleMyLikes, loadDesign } from '../src/gallery.js';

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

// A well-formed design, and a helper to bend one field at a time.
const DESIGN = {
  word: 'MOLTEN', from: '#fde68a', via: '#fffbeb', to: '#fca5a5',
  bd: '#f59e0b', ink: '#7c2d12', glow: '#f97316',
  glowSize: 26, glowAlpha: 55, shimmer: true, lo: 500000,
};
const bend = over => ({ ...DESIGN, ...over });

// One caller = one IP. The gallery keys rate limiting and hearts off a salted hash
// of it, so varying this is how a test plays a different person.
async function api(env, url, { method = 'GET', body, ip = '10.0.0.1', headers = {} } = {}) {
  const req = new Request('http://x' + url, {
    method,
    headers: { 'cf-connecting-ip': ip, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const u = new URL('http://x' + url);
  const res = (await handleGallery(u, req, env)) || (await handleMyLikes(u, req, env));
  return { status: res.status, body: await res.json() };
}
const publish = (env, over, opts = {}) =>
  api(env, '/api/palettes', {
    method: 'POST',
    body: { name: opts.name || 'A rarity', author: opts.author, note: opts.note, design: bend(over || {}) },
    ip: opts.ip,
  });

// --------------------------------------------------------------------------
console.log('gallery');

{
  // No binding at all. Reading is an empty gallery (200, so a page load stays free
  // of console errors on a deployment that never had a database); writing is a 503,
  // because a publish that goes nowhere must not look like it worked.
  let r = await api({}, '/api/palettes');
  check('no DB -> read is 200 and empty', r.status === 200 && r.body.unconfigured === true
    && r.body.palettes.length === 0 && r.body.more === false, JSON.stringify(r.body));

  r = await publish({}, {});
  check('no DB -> write is 503', r.status === 503 && r.body.unconfigured === true, JSON.stringify(r.body));

  r = await api({}, '/api/palettes-liked');
  check('no DB -> liked is empty', r.status === 200 && r.body.liked.length === 0);
}

{
  const env = { DB: freshDB(), IP_SALT: 'test' };

  let r = await api(env, '/api/palettes');
  check('empty gallery lists nothing', r.status === 200 && r.body.palettes.length === 0 && r.body.more === false);

  // --- publishing ---------------------------------------------------------
  r = await publish(env, {}, { name: 'Molten Gold', author: 'ada', note: 'from a furnace' });
  check('publish -> 201 with an id', r.status === 201 && typeof r.body.id === 'string' && r.body.id.length >= 4,
    JSON.stringify(r.body));
  const id = r.body.id;
  check('the design comes back whole',
    r.body.design.word === 'MOLTEN' && r.body.design.glowSize === 26 && r.body.design.shimmer === true,
    JSON.stringify(r.body.design));

  r = await api(env, '/api/palettes');
  check('published rarity is listed', r.body.palettes.length === 1 && r.body.palettes[0].id === id);
  check('author_key never leaves the server',
    !('author_key' in r.body.palettes[0]) && !('hidden' in r.body.palettes[0]));

  r = await api(env, '/api/palettes/' + id);
  check('fetch one by id', r.status === 200 && r.body.name === 'Molten Gold' && r.body.author === 'ada');

  // --- validation ---------------------------------------------------------
  const rejects = [
    ['no submission name', { name: '  ' }],
    ['name too long', { name: 'x'.repeat(41) }],
    ['no rarity name', { design: bend({ word: '  ' }) }],
    ['rarity name too long', { design: bend({ word: 'x'.repeat(19) }) }],
    ['bad border hex', { design: bend({ bd: 'red' }) }],
    ['short hex', { design: bend({ from: '#abc' }) }],
    ['missing ink', { design: bend({ ink: undefined }) }],
    ['glow size negative', { design: bend({ glowSize: -1 }) }],
    ['glow size too big', { design: bend({ glowSize: 999 }) }],
    ['glow alpha over 100', { design: bend({ glowAlpha: 140 }) }],
    ['negative floor', { design: bend({ lo: -5 }) }],
    ['design is a list', { design: [DESIGN] }],
    ['design missing', { design: undefined }],
    ['submission name is an object', { name: { toString: 1 } }],
    ['author is an object', { author: { toString: 1 } }],
  ];
  for (const [label, over] of rejects) {
    const payload = { name: 'A rarity', design: bend({}), ...over };
    const rr = await api(env, '/api/palettes', { method: 'POST', body: payload, ip: '10.0.0.9' });
    check('reject: ' + label, rr.status === 400 && typeof rr.body.error === 'string',
      `got ${rr.status} ${JSON.stringify(rr.body)}`);
  }

  // --- the effect dials ---------------------------------------------------
  // Every one of these is rendered straight into CSS on other people's pages, so
  // each has a stated ceiling and none of them may arrive unbounded.
  const fxRejects = [
    ['too many sparkles', { sparkles: 15 }],
    ['negative sparkles', { sparkles: -1 }],
    ['seed out of range', { seed: 10000 }],
    ['radius too big', { radius: 29 }],
    ['breathe too slow', { breathe: 81 }],
    ['unknown digit style', { inkStyle: 'neon' }],
    ['digit style is an object', { inkStyle: { toString: 1 } }],
    // Same hazard, other fields: String({toString:1}) throws a TypeError, and an
    // escaping TypeError would let a hostile payload choose the status code.
    ['rarity name is an object', { word: { toString: 1 } }],
    ['a colour is an object', { bd: { toString: 1 } }],
    ['bad sparkle colour', { spark: 'silver' }],
    ['unknown particle shape', { sparkShape: 'triangle' }],
    ['unknown particle motion', { sparkMotion: 'wiggle' }],
    ['particle shape is an object', { sparkShape: { toString: 1 } }],
    ['gradient angle over 360', { angle: 361 }],
    ['border wider than 8', { borderW: 9 }],
  ];
  for (const [label, over] of fxRejects) {
    const rr = await publish(env, over, { name: 'fx ' + label, ip: '10.0.0.11' });
    check('reject: ' + label, rr.status === 400 && typeof rr.body.error === 'string',
      `got ${rr.status} ${JSON.stringify(rr.body)}`);
  }

  // Absent effect fields describe a box without those effects - not a bad request.
  r = await publish(env, {}, { name: 'Plain', ip: '10.0.0.12' });
  check('effects default when absent',
    r.status === 201 && r.body.design.sparkles === 0 && r.body.design.holo === false
      && r.body.design.ring === false && r.body.design.pulse === false
      && r.body.design.radius === 12 && r.body.design.breathe === 30
      && r.body.design.inkStyle === 'solid' && r.body.design.spark === '#ffffff'
      && r.body.design.sparkShadow === false && r.body.design.sparkShape === 'star'
      && r.body.design.sparkMotion === 'twinkle' && r.body.design.borderW === 3
      && r.body.design.angle === 135,
    JSON.stringify(r.body.design));

  // ...and a fully decorated one survives the round trip intact.
  r = await publish(env, {
    sparkles: 12, seed: 4242, holo: true, ring: true, pulse: true,
    radius: 26, breathe: 55, inkStyle: 'gradient', spark: '#A7F3D0', sparkShadow: true,
    sparkShape: 'heart', sparkMotion: 'orbit', borderW: 6, angle: 300,
  }, { name: 'Everything on', ip: '10.0.0.13' });
  const fx = r.body.design;
  check('effects round-trip',
    fx.sparkles === 12 && fx.seed === 4242 && fx.holo === true && fx.ring === true
      && fx.pulse === true && fx.radius === 26 && fx.breathe === 55 && fx.inkStyle === 'gradient'
      && fx.spark === '#a7f3d0' && fx.sparkShadow === true
      && fx.sparkShape === 'heart' && fx.sparkMotion === 'orbit'
      && fx.borderW === 6 && fx.angle === 300,
    JSON.stringify(fx));

  // The seed is what makes a sparkle scatter reproducible everywhere it is drawn,
  // so it has to survive as the exact number that was sent.
  check('the sparkle seed is kept exactly', fx.seed === 4242, JSON.stringify(fx.seed));

  // Truthiness is normalised, so a design never carries a string where the renderer
  // expects a boolean.
  r = await publish(env, { holo: 'yes', ring: 0, pulse: 1 }, { name: 'Coerced', ip: '10.0.0.14' });
  check('booleans are normalised',
    r.body.design.holo === true && r.body.design.ring === false && r.body.design.pulse === true,
    JSON.stringify(r.body.design));

  // Cleaning keeps ordinary punctuation and drops only control characters.
  r = await publish(env, {}, { name: 'Bell\u0007Name', ip: '10.0.0.3' });
  check('control chars stripped', r.status === 201 && !/[\u0000-\u001f]/.test(r.body.name),
    JSON.stringify(r.body.name));
  check('and a space is left behind', /Bell Name/.test(r.body.name), JSON.stringify(r.body.name));

  r = await publish(env, { word: 'ICE' }, { name: 'Punc-tu&ted +1', ip: '10.0.0.4' });
  check('punctuation survives', r.status === 201 && r.body.name === 'Punc-tu&ted +1', JSON.stringify(r.body.name));

  // The rarity name is upper-cased on the way in, so it matches how prod writes its own.
  r = await publish(env, { word: 'quiet storm', lo: 12 }, { name: 'lowercase', ip: '10.0.0.8' });
  check('rarity name is upper-cased', r.body.design.word === 'QUIET STORM', JSON.stringify(r.body.design.word));

  // --- dedupe + submit rate limit -----------------------------------------
  r = await publish(env, {}, { name: 'Molten again' });
  check('identical repost is deduped', r.status === 200 && r.body.duplicate === true && r.body.id === id,
    JSON.stringify(r.body));

  let limited = null;
  for (let i = 0; i < 8 && limited === null; i++) {
    const rr = await publish(env, { lo: 100 + i }, { name: 'spam ' + i, ip: '10.0.0.77' });
    if (rr.status === 429) limited = i;
  }
  check('submit rate limit kicks in at 5/hour', limited === 5, `limited after ${limited}`);

  // --- hearts -------------------------------------------------------------
  r = await api(env, '/api/palettes/' + id + '/like', { method: 'POST', ip: '10.0.0.5' });
  check('heart -> 1', r.body.likes === 1 && r.body.liked === true, JSON.stringify(r.body));
  r = await api(env, '/api/palettes/' + id + '/like', { method: 'POST', ip: '10.0.0.5' });
  check('same voter toggles back off', r.body.likes === 0 && r.body.liked === false, JSON.stringify(r.body));
  await api(env, '/api/palettes/' + id + '/like', { method: 'POST', ip: '10.0.0.5' });
  await api(env, '/api/palettes/' + id + '/like', { method: 'POST', ip: '10.0.0.6' });
  r = await api(env, '/api/palettes/' + id);
  check('two voters -> 2 hearts', r.body.likes === 2, JSON.stringify(r.body.likes));

  r = await api(env, '/api/palettes-liked', { ip: '10.0.0.5' });
  check('a voter sees their own hearts', r.body.liked.includes(id));
  r = await api(env, '/api/palettes-liked', { ip: '10.0.0.99' });
  check('and not other people\'s', !r.body.liked.includes(id));

  r = await api(env, '/api/palettes?sort=top');
  check('sort=top puts the hearted one first', r.body.palettes[0].id === id,
    JSON.stringify(r.body.palettes.map(p => [p.name, p.likes])));

  r = await api(env, '/api/palettes/nosuchid1/like', { method: 'POST' });
  check('hearting a missing rarity 404s', r.status === 404);

  // --- hot ordering -------------------------------------------------------
  r = await api(env, '/api/palettes');
  check('hot is the default sort', r.body.sort === 'hot', JSON.stringify(r.body.sort));
  check('hearted rarity leads the default list', r.body.palettes[0].id === id,
    JSON.stringify(r.body.palettes.map(p => [p.name, p.likes])));

  const old = await publish(env, { lo: 40 }, { name: 'Ancient', ip: '10.0.0.30' });
  await env.DB.prepare('UPDATE palettes SET created = ? WHERE id = ?')
    .bind(Date.now() - 7 * 86400_000, old.body.id).run();
  const young = await publish(env, { lo: 41 }, { name: 'Fresh', ip: '10.0.0.31' });

  r = await api(env, '/api/palettes');
  let rank = r.body.palettes.map(p => p.id);
  check('age decays rank', rank.indexOf(young.body.id) < rank.indexOf(old.body.id),
    `fresh at ${rank.indexOf(young.body.id)}, week-old at ${rank.indexOf(old.body.id)}`);

  for (let i = 0; i < 3; i++) {
    await api(env, '/api/palettes/' + old.body.id + '/like', { method: 'POST', ip: '10.0.1.' + i });
  }
  r = await api(env, '/api/palettes');
  rank = r.body.palettes.map(p => p.id);
  check('hearts lift an older rarity back up', rank.indexOf(old.body.id) < rank.indexOf(young.body.id),
    `week-old at ${rank.indexOf(old.body.id)}, fresh at ${rank.indexOf(young.body.id)}`);

  // The trade is meant to be legible: three hearts (9 days' worth) beats a week of
  // age, one heart (3 days') does not.
  const oneHeart = await publish(env, { lo: 42 }, { name: 'Week old, one heart', ip: '10.0.0.32' });
  await env.DB.prepare('UPDATE palettes SET created = ? WHERE id = ?')
    .bind(Date.now() - 7 * 86400_000, oneHeart.body.id).run();
  await api(env, '/api/palettes/' + oneHeart.body.id + '/like', { method: 'POST', ip: '10.0.2.1' });
  r = await api(env, '/api/palettes');
  rank = r.body.palettes.map(p => p.id);
  check('one heart does not outweigh a week', rank.indexOf(oneHeart.body.id) > rank.indexOf(young.body.id),
    `one-heart week-old at ${rank.indexOf(oneHeart.body.id)}, fresh at ${rank.indexOf(young.body.id)}`);

  r = await api(env, '/api/palettes?sort=new');
  check('sort=new is still newest-first', r.body.sort === 'new' && r.body.palettes[0].id === young.body.id);

  // --- heart rate limit ---------------------------------------------------
  // One voter can only heart a given rarity once, so a flood has to span rarities -
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

  // --- paging -------------------------------------------------------------
  r = await api(env, '/api/palettes?limit=2');
  check('limit pages', r.body.palettes.length === 2 && r.body.more === true);
  r = await api(env, '/api/palettes?limit=2&offset=2');
  check('offset pages', r.body.palettes.length === 2 && r.body.offset === 2);

  // --- moderation ---------------------------------------------------------
  r = await api(env, '/api/palettes/' + id, { method: 'DELETE' });
  check('no ADMIN_TOKEN -> moderation refused', r.status === 503, JSON.stringify(r.body));

  const modEnv = { ...env, ADMIN_TOKEN: 'sekrit' };
  r = await api(modEnv, '/api/palettes/' + id, { method: 'DELETE' });
  check('wrong token -> 403', r.status === 403);
  r = await api(modEnv, '/api/palettes/' + id, { method: 'DELETE', headers: { 'x-admin-token': 'sekrit' } });
  check('right token hides it', r.status === 200 && r.body.hidden === true, JSON.stringify(r.body));
  r = await api(modEnv, '/api/palettes/' + id);
  check('hidden rarity is gone from the api', r.status === 404);
  r = await api(modEnv, '/api/palettes');
  check('hidden rarity is gone from the list', !r.body.palettes.some(p => p.id === id));

  // --- loadDesign, which the share page renders from -----------------------
  // It hands back plain data rather than a Response, and has to fail closed: the
  // share route calls it before deciding between a page and a 404.
  const live = (await api(env, '/api/palettes?sort=new')).body.palettes[0];
  let got = await loadDesign(env, live.id);
  check('loadDesign returns the design', got && got.id === live.id && got.design
    && typeof got.design.word === 'string', JSON.stringify(got && got.id));
  check('loadDesign hides the private columns',
    got && !('author_key' in got) && !('hidden' in got));

  check('loadDesign: unknown id -> null', (await loadDesign(env, 'nosuchid9')) === null);
  check('loadDesign: no database -> null', (await loadDesign({}, live.id)) === null);
  check('loadDesign: rubbish id -> null', (await loadDesign(env, '../../etc')) === null);
  check('loadDesign: empty id -> null', (await loadDesign(env, '')) === null);

  // A hidden rarity must stop resolving, or moderation would not reach shared links.
  await api(modEnv, '/api/palettes/' + live.id, { method: 'DELETE', headers: { 'x-admin-token': 'sekrit' } });
  check('loadDesign: hidden -> null', (await loadDesign(env, live.id)) === null);

  // --- routing ------------------------------------------------------------
  r = await api(env, '/api/palettes', { method: 'PUT', body: {} });
  check('PUT is refused', r.status === 405);
  const stray = await handleGallery(new URL('http://x/api/other'), new Request('http://x/api/other'), env);
  check('an unrelated path falls through', stray === null);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
