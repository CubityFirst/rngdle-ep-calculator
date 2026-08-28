# Runs the Worker's fetch handler under plain node:http (serve.mjs) instead of the
# Cloudflare Workers runtime. This is a convenience path for people who don't want
# wrangler/a Cloudflare account - see README "Run it locally" for the tradeoffs.
#
# Not used by `npm run deploy`: that still goes through `wrangler deploy` directly.
#
# The D1-backed palette gallery (/api/palettes, src/gallery.js) isn't available here -
# serve.mjs passes an empty env, so those routes report themselves "not configured"
# rather than serving real data. Everything else (the calculator, /badges, /grid,
# /chains, /beta tools) is unaffected.
FROM node:26-alpine

WORKDIR /app

# Only devDependencies (wrangler) exist in package.json; --omit=dev keeps the image
# free of it since serve.mjs never invokes wrangler.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

CMD ["npm", "run", "serve"]
