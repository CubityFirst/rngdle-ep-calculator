// Stable local dev server for the Worker - wraps the same fetch handler in node:http.
// Unlike `wrangler dev`, this has no interactive hotkey loop, so it survives as a
// detached background process. Binds to 127.0.0.1 (localhost only).
//
//   node serve.mjs            # http://127.0.0.1:8787
//   PORT=3000 node serve.mjs
//
// For deploying to Cloudflare, use `npx wrangler deploy` (the worker code is identical).

import http from 'node:http';
import worker from './src/index.js';

const port = Number(process.env.PORT) || 8787;

http.createServer(async (req, res) => {
  const url = `http://${req.headers.host || '127.0.0.1'}${req.url}`;
  try {
    const response = await worker.fetch(new Request(url, { method: req.method }));
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
