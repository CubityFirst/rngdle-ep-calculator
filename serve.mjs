// Stable local dev server - wraps src/worker.js in node:http, with a stand-in for
// the static-asset binding that serves site/ straight from disk (no dist/ build):
// a file when there is one, the app shell for anything else, the way Workers Static
// Assets does with not_found_handling = "single-page-application". Unlike
// `wrangler dev`, this has no interactive hotkey loop, so it survives as a detached
// background process. Binds to 127.0.0.1 (localhost only).
//
//   node serve.mjs            # http://127.0.0.1:8787
//   PORT=3000 node serve.mjs
//
// Bindings: this passes no D1, so the palette gallery (/api/palettes, src/gallery.js)
// answers 503 "not configured" - every other route is storage-free and behaves exactly
// as it does in production. To work on the gallery, run `npx wrangler dev` instead,
// which provisions a real local D1 from the binding in wrangler.toml.
//
// For deploying to Cloudflare, use `npm run deploy` (the worker code is identical).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import worker from './src/worker.js';

const port = Number(process.env.PORT) || 8787;
const SITE = new URL('./site/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.gz': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

// The asset binding: a file from site/ if the path names one, else the shell.
const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
    if (rel.includes('..')) return new Response('Not found', { status: 404 });
    let file = join(SITE, rel);
    try {
      if (!rel || (await stat(file)).isDirectory()) file = join(SITE, 'index.html');
    } catch { file = join(SITE, 'index.html'); }
    const body = await readFile(file);
    return new Response(body, { headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream' } });
  },
};

http.createServer(async (req, res) => {
  const url = `http://${req.headers.host || '127.0.0.1'}${req.url}`;
  try {
    // Methods with a body have to be read off the socket first. Only POST
    // /api/palettes needs it, but forwarding headers and body for everything is
    // what keeps this a faithful stand-in for the real runtime.
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const body = hasBody ? Buffer.concat(await collect(req)) : undefined;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: body && body.length ? body : undefined,
    });
    const response = await worker.fetch(request, { ASSETS });
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.statusCode = 500;
    res.end(`Internal error: ${e.message}`);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`RNGdle sandbox running on http://127.0.0.1:${port}`);
});

function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}
