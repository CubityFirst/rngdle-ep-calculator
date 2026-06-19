// Stable local dev server for the Worker - wraps the same fetch handler in node:http.
// Unlike `wrangler dev`, this has no interactive hotkey loop, so it survives as a
// detached background process. Binds to 127.0.0.1 (localhost only).
//
//   node serve.mjs            # http://127.0.0.1:8787
//   PORT=3000 node serve.mjs
//
// For deploying to Cloudflare, use `npx wrangler deploy` (the worker code is identical).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import worker from './src/index.js';

const port = Number(process.env.PORT) || 8787;

// Local stand-in for the Cloudflare `ASSETS` binding: serve src/ByBadge/<file>.png
// off disk so /img works under `node serve.mjs` exactly as it does on Workers.
const ASSETS = {
  fetch: async (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
      return new Response('bad request', { status: 400 });
    }
    try {
      const buf = await readFile(new URL('./src/ByBadge/' + name, import.meta.url));
      return new Response(buf, { headers: { 'content-type': 'image/png' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  },
};

http.createServer(async (req, res) => {
  const url = `http://${req.headers.host || '127.0.0.1'}${req.url}`;
  try {
    const response = await worker.fetch(new Request(url, { method: req.method }), { ASSETS });
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.statusCode = 500;
    res.end(`Internal error: ${e.message}`);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`RNGdle EP calculator running on http://127.0.0.1:${port}`);
});
