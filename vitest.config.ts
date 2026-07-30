import { defineConfig } from "vitest/config";

// Standalone from vite.config.ts on purpose. The app config carries the
// react + tailwind plugins, a Tailscale probe that shells out on startup,
// and index.html transforms — none of which the test run needs, and the
// probe would add ~seconds of `execFileSync` per run. There are no path
// aliases in vite.config.ts, so nothing has to be mirrored here.
//
// Environment is `node`: the suite covers the pure simulation, level
// tables, and save/progress logic only. Anything that needs a DOM or a
// GPU (three.js render layer, React components) is deliberately out of
// scope — `src/progress.ts` reaches for `window.localStorage` behind a
// guard, so its tests stub a minimal Storage instead of pulling jsdom in.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The sim modules are synchronous and allocation-light; a hung test
    // means a real infinite loop (path advance, wave generation), so fail
    // fast instead of waiting the default 5s.
    testTimeout: 5000,
  },
});
