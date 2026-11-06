import { mkdirSync } from "node:fs";
import { defineWranglerConfig } from "wrangler/experimental-config";

// cf's Wrangler build checks that assetsDirectory exists before it runs build.command,
// and dist/ is gitignored, so on a fresh checkout (Workers Builds, a new clone) the
// check fails before tools/build-dist.cjs ever runs. Create it empty here - this file
// is evaluated first - and let the build below fill it.
mkdirSync(new URL("./dist", import.meta.url), { recursive: true });

export default defineWranglerConfig({
	build: {
		command: "node tools/check.cjs && node tools/build-dist.cjs",
	},
	assetsDirectory: "./dist",
});
