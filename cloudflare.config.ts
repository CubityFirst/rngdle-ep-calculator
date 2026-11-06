import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "rngdle-ep-calculator",
		compatibilityDate: "2025-01-01",
		entrypoint: "src/worker.js",
		assets: {
			notFoundHandling: "single-page-application",
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
		domains: [
			"rng.cubityfir.st",
			"rngdle.tools",
		],
		// Served on the custom domains only. wrangler.toml never set these, and Wrangler's
		// deploys left both off; pinned here so cf's defaults cannot turn them on.
		workersDev: false,
		previewUrls: false,
		env: {
			DB: bindings.d1({
				name: "rngdle",
				id: "2ab6144c-0287-4cb0-9e6c-9e50bec4908a",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
