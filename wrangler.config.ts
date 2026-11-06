import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	build: {
		command: "node tools/check.cjs && node tools/build-dist.cjs",
	},
	assetsDirectory: "./dist",
});
