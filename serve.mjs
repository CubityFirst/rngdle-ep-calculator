// Stable local dev server for the Worker - wraps the same fetch handler in node:http.
// Unlike `wrangler dev`, this has no interactive hotkey loop, so it survives as a
// detached background process. Binds to 127.0.0.1 (localhost only) by default.
//
//   node serve.mjs            # http://127.0.0.1:8787
//   PORT=3000 node serve.mjs
//   HOST=0.0.0.0 node serve.mjs   # e.g. from inside a container - see Dockerfile
//
// Bindings: this passes an empty env, so there is no D1 here and the palette gallery
// (/api/palettes, src/gallery.js) answers 503 "not configured" - every other route is
// storage-free and behaves exactly as it does in production. To work on the gallery,
// run `npx wrangler dev` instead, which provisions a real local D1 from the binding
// in wrangler.toml; see the notes there for seeding it with schema.sql.
//
// For deploying to Cloudflare, use `npx wrangler deploy` (the worker code is identical).

import http from 'node:http';
import worker from './src/index.js';

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '127.0.0.1';

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
    const response = await worker.fetch(request, {});
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.statusCode = 500;
    res.end(`Internal error: ${e.message}`);
  }
}).listen(port, host, () => {
  console.log(`RNGdle EP calculator running on http://${host}:${port}`);
});

function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}
