import { defineConfig } from "@trigger.dev/sdk";

// Custom Playwright extension that bypasses the broken dry-run grep approach.
// The official @trigger.dev/build playwright extension greps for
// "browser: chromium-headless-shell" in playwright's --dry-run output, but
// this string does not appear in playwright 1.47.x dry-run output on Linux.
// Instead, we run `npx playwright install --with-deps chromium` directly,
// which works because Docker RUN commands execute as root.
const playwrightChromiumDirect = {
  name: "PlaywrightChromiumDirect",
  externalsForTarget(target: string) {
    if (target === "dev") return [];
    return ["playwright"];
  },
  onBuildComplete(context: any, manifest: any) {
    if (context.target === "dev") return;

    const playwrightExternal = manifest.externals?.find(
      (e: any) => e.name === "playwright" || e.name === "@playwright/test"
    );
    const version: string = playwrightExternal?.version ?? "1.47.0";

    context.addLayer({
      id: "playwright-chromium-direct",
      image: {
        instructions: [
          `RUN apt-get update && apt-get install -y --no-install-recommends npm && apt-get clean && rm -rf /var/lib/apt/lists/*`,
          `RUN PLAYWRIGHT_BROWSERS_PATH=/ms-playwright npx playwright@${version} install --with-deps chromium`,
        ],
      },
      deploy: {
        env: {
          PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
          PLAYWRIGHT_SKIP_BROWSER_VALIDATION: "1",
        },
        override: true,
      },
      dependencies: {
        playwright: version,
      },
    });
  },
};

export default defineConfig({
  project: "proj_lklwvtuximzshfgzecbu",
  runtime: "node",
  logLevel: "log",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    extensions: [playwrightChromiumDirect],
  },
});
