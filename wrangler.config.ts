import { mkdirSync } from "node:fs";
import { defineWranglerConfig } from "wrangler/experimental-config";

// cf's Wrangler build checks that assetsDirectory exists before it runs build.command,
// and dist/ is gitignored, so on a fresh checkout (Workers Builds, a new clone) the
// check fails before tools/build-dist.cjs ever runs. Create it empty here - this file
// is evaluated first - and let the build below fill it.
mkdirSync(new URL("./dist", import.meta.url), { recursive: true });

export default defineWranglerConfig({
	// Runs before every `cf dev` / `cf build` / `cf deploy`. check.cjs is here rather than
	// only in a test script so the guard travels with the deploy: it fails the build if the
	// EP index has gone stale against the vendored engine, or if the legacy tools'
	// catalogue drifts. build-dist.cjs then assembles site/ into dist/.
	build: {
		command: "node tools/check.cjs && node tools/build-dist.cjs",
	},
	assetsDirectory: "./dist",
});
