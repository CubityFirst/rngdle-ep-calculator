// /u/<names>/raw - the profile as CSV - against a stubbed rngdle.
//
//   node test/raw.mjs
//
// The Worker's only upstream is rngdle's rolls API, so `fetch` is replaced with a
// stand-in that serves two players from a table (paged, as rngdle pages) and 404s
// the rest. The engine is real: every EP, tier and badge in the CSV comes from
// compute(), so the numbers below are pinned to what the number card says.
import { compute } from '../src/index.js';
import worker from '../src/worker.js';

const ROLLS = {
  alice: [
    { number: 111111, totalScore: 1, badgeCount: 1, rolledAt: '2026-09-03T08:00:00.000Z', heartCount: 2, poem: 'a poem, with "quotes"\nand a line break' },
    { number: 42, totalScore: 1, badgeCount: 1, rolledAt: '2026-09-01T08:00:00.000Z', heartCount: 0, poem: null },
  ],
  bob: [
    { number: 100000, totalScore: 1, badgeCount: 1, rolledAt: '2026-09-02T08:00:00.000Z', heartCount: 0, poem: null },
  ],
};

let upstreamCalls = 0;
globalThis.fetch = async (url) => {
  upstreamCalls++;
  const m = /\/api\/users\/([^/]+)\/rolls\?limit=(\d+)&offset=(\d+)$/.exec(String(url));
  if (!m || !ROLLS[m[1]]) return new Response('{}', { status: 404 });
  const all = ROLLS[m[1]], offset = Number(m[3]), page = all.slice(offset, offset + Number(m[2]));
  return Response.json({ rolls: page, hasMore: offset + page.length < all.length });
};
const shell = new Response('<!doctype html>shell', { headers: { 'content-type': 'text/html' } });
const env = { ASSETS: { fetch: async () => shell.clone() } };
const get = (path) => worker.fetch(new Request(`https://rng.test${path}`), env);

const must = (cond, msg) => { if (!cond) throw new Error(msg); };
// A CSV parser sufficient for what the Worker writes: quoted cells, doubled quotes,
// line breaks inside quotes, CRLF rows.
function parseCsv(text) {
  const rows = [[]]; let cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { rows[rows.length - 1].push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { rows[rows.length - 1].push(cell); cell = ''; rows.push([]); i++; }
    else cell += c;
  }
  if (rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

// --- one row per roll, two players pooled -----------------------------------
{
  const res = await get('/u/alice,bob/raw');
  must(res.status === 200, `pooled: status ${res.status}`);
  must(res.headers.get('content-type') === 'text/csv; charset=utf-8', 'pooled: content-type');
  must(res.headers.get('access-control-allow-origin') === '*', 'pooled: CORS header');
  must(!res.headers.get('x-missing-players'), 'pooled: nothing should be missing');
  const text = await res.text();
  must(text.includes('\r\n') && !/[^\r]\n/.test(text.replace(/"[^"]*"/g, '')), 'rows must end in CRLF');
  const rows = parseCsv(text);
  must(rows[0].join() === 'date,user,roll,tier,ep,badges,hearts,poem,badge_list', `header: ${rows[0].join()}`);
  must(rows.length === 4, `pooled: ${rows.length - 1} rows, expected 3`);
  // Newest first, players interleaved by date.
  must(rows.slice(1).map(r => r[1]).join() === 'alice,bob,alice', `order: ${rows.slice(1).map(r => `${r[1]}@${r[0]}`).join(' ')}`);
  const a = rows[1], s = compute(111111);
  must(a[2] === '111111' && Number(a[4]) === s.totalEP && Number(a[5]) === s.count, `alice 111111: ${a.join(' | ')}`);
  must(a[3] === 'anomaly' || a[3] === 'mythic' || a[3] === 'epic' || a[3] === 'rare', `tier is a card tier name, got ${a[3]}`);
  must(a[6] === '2', 'hearts');
  must(a[7] === 'a poem, with "quotes"\nand a line break', `poem round-trips through quoting: ${JSON.stringify(a[7])}`);
  // The badge list: every earned badge as Label+EP, biggest first, superseded ones +0.
  const list = a[8].split(', ');
  must(list.length === s.count, `badge_list has ${list.length} entries, expected ${s.count}`);
  must(list[0] === `${s.badges[0].label}+${s.badges[0].ep}`, `badge_list starts ${list[0]}`);
  must(list.some(x => /\+0$/.test(x)), '111111 has superseded badges, so some entry should be +0');
  must(list.includes('Pair+0') && list.includes('Six Digits+111'), `expected Pair+0 and Six Digits+111 in ${a[8]}`);
  console.log(`ok  /u/alice,bob/raw: 3 rolls, newest first, ${list.length} badges listed on 111111`);
}

// --- one row per player --------------------------------------------------------
{
  const rows = parseCsv(await (await get('/u/alice,bob/raw?by=player')).text());
  must(rows[0].join() === 'player,rolls,total_ep,badges,best_number,best_ep,first_roll,last_roll,capped', `player header: ${rows[0].join()}`);
  must(rows.length === 3, 'two player rows');
  const alice = rows[1];
  const ep1 = compute(111111), ep2 = compute(42);
  must(alice[0] === 'alice' && alice[1] === '2', 'alice: 2 rolls');
  must(Number(alice[2]) === ep1.totalEP + ep2.totalEP, 'alice: total_ep is the engine sum');
  const distinct = new Set([...ep1.badges, ...ep2.badges].map(b => b.id)).size;
  must(Number(alice[3]) === distinct, `alice: ${alice[3]} distinct badges, expected ${distinct}`);
  // 42 is the exact Universal Answer, a mythic, so it is the best roll despite 111111's haul.
  must(ep2.totalEP > ep1.totalEP, 'fixture: 42 should out-score 111111');
  must(alice[4] === '42' && Number(alice[5]) === ep2.totalEP, `alice: best roll ${alice[4]} (${alice[5]})`);
  must(alice[6] === '2026-09-01T08:00:00.000Z' && alice[7] === '2026-09-03T08:00:00.000Z', 'alice: first/last');
  must(alice[8] === '0', 'alice: not capped');
  console.log('ok  ?by=player: totals, distinct badges, best roll, first/last');
}

// --- misses, bad input, trailing slash, and the shell for the rest ------------
{
  let res = await get('/u/alice,nobody/raw');
  must(res.status === 200 && res.headers.get('x-missing-players') === 'nobody (not found)', 'one miss in a pool is a header');
  must(parseCsv(await res.text()).length === 3, 'the rest still answers');
  res = await get('/u/nobody/raw');
  must(res.status === 404 && (await res.text()).includes('nobody: not found'), 'an unknown lone name is a 404');
  res = await get('/u/alice/raw/');
  must(res.status === 200, 'trailing slash is fine');
  res = await get('/u/alice/raw?by=player');
  must(parseCsv(await res.text()).length === 2, 'a lone player summary');
  res = await get('/u/,,/raw');
  must(res.status === 400, 'no valid names is a 400');
  res = await get('/u/!!!/raw');
  must((await res.text()) === '<!doctype html>shell', 'a name outside the route\'s shape is the shell\'s problem, not a 400');
  res = await worker.fetch(new Request('https://rng.test/u/alice/raw', { method: 'POST' }), env);
  must(res.status === 405, 'POST is refused');
  // Every other /u path is the shell's - run_worker_first lists /u/*, so the Worker
  // sees them all and must hand them straight back.
  for (const p of ['/u', '/u/alice', '/u/alice,bob', '/u/alice/rawx', '/u/alice/raw/more']) {
    res = await get(p);
    must((await res.text()) === '<!doctype html>shell', `${p} should be the app shell`);
  }
  // Duplicates collapse and the pool caps at ten, so this is at most ten upstream walks.
  upstreamCalls = 0;
  await get('/u/' + Array.from({ length: 14 }, (_, i) => `p${i}`).concat(['alice', 'alice']).join(',') + '/raw');
  must(upstreamCalls === 10, `pool cap: ${upstreamCalls} upstream calls, expected 10`);
  console.log('ok  misses -> header / 404, bad names -> 400, POST -> 405, other /u paths -> shell, pool capped at 10');
}

console.log('\nAll raw CSV assertions passed.');
