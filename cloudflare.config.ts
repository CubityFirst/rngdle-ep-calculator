import { bindings, defineConfig } from "cf/config";

// The Worker's only config: `cf dev`, `cf build` and `cf deploy` read this file, and the
// build step (tools/check.cjs, then tools/build-dist.cjs into dist/) lives in
// wrangler.config.ts. There is no wrangler.toml - see CONTRIBUTING.md for the Wrangler
// commands that still matter (d1 execute, secret put, tail) and how they run without it.

export default defineConfig({
	accountId: "d843ae90cab33e54f4d284bc65d2fd6a",
	worker: {
		name: "rngdle-ep-calculator",
		compatibilityDate: "2025-01-01",
		// src/worker.js answers /api/rolls and /api/other, mounts src/index.js for the
		// legacy tools and their APIs, and hands every other path to the assets.
		entrypoint: "src/worker.js",
		// The front end is static: site/ is assembled into dist/ by tools/build-dist.cjs
		// (an allowlist, so nothing else ships); the directory is set in wrangler.config.ts.
		assets: {
			// The site routes on real paths (/badges/pronic), so every unknown path has to
			// come back as the app shell for the router to read - that is what makes those
			// URLs survive a reload rather than being a client-side illusion.
			notFoundHandling: "single-page-application",
			// Requests are matched against the static files first, and a navigation to a
			// path with no file gets the app shell without the Worker running at all -
			// right for /badges/pronic, wrong for /beta/atlas, which is a page of its own.
			// These run the Worker first: the legacy tools, their engine and APIs, and the
			// old lab index. /u/* is here for /u/<names>/raw, the profile as CSV; every
			// other /u path the Worker hands straight back to the shell. /badges/raw is the
			// badge list as CSV; only that one path, so /badges/<slug> still goes straight
			// to the shell. tools/check.cjs fails if a legacy path goes missing.
			runWorkerFirst: [
				"/beta",
				"/beta/*",
				"/chains",
				"/engine.js",
				"/api",
				"/api/*",
				"/u/*",
				"/badges/raw",
				"/badges/raw/",
			],
		},
		// Custom domains (both zones are on this Cloudflare account). The deploy
		// provisions each hostname + cert, and a hostname can only belong to one Worker -
		// rngdle.tools is served from here now, not from its own repo, which is frozen.
		// The apex only; www is not routed.
		domains: [
			"rng.cubityfir.st",
			"rngdle.tools",
		],
		// Served on the custom domains only. Wrangler's deploys left both off; pinned here
		// so cf's defaults cannot turn them on.
		workersDev: false,
		previewUrls: false,
		// Off on the live Worker since it was created; pinned for the same reason.
		observability: {
			enabled: false,
		},
		env: {
			// Palette gallery for /beta/boxes (src/gallery.js). Created 2026-08-19 in WEUR.
			// The schema lives in schema.sql (all IF NOT EXISTS, so it is also the
			// migration); apply it to this database with
			//   npx wrangler d1 execute rngdle --file=schema.sql --remote
			// `cf dev` provisions its own local D1 from this binding, so local work never
			// touches the real one. Two secrets belong with it
			// (`npx wrangler secret put <NAME> --name rngdle-ep-calculator`; existing
			// secrets are kept across `cf deploy`):
			//   IP_SALT      salts the hashed submitter key - without it the hash is
			//                guessable by anyone who can enumerate IP addresses
			//   ADMIN_TOKEN  enables DELETE /api/palettes/<id>; with no token set, nothing
			//                can be hidden through the API at all
			DB: bindings.d1({
				name: "rngdle",
				id: "2ab6144c-0287-4cb0-9e6c-9e50bec4908a",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
