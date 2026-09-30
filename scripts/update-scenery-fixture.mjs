// Run explicitly after reviewing intentional placement changes:
// node scripts/update-scenery-fixture.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

// Use the test transforms, including import.meta.env, without starting a server.
const server = await createServer({
  configFile: "vitest.config.ts",
  server: { middlewareMode: true, watch: null, hmr: false },
});
try {
  const { placementHashes } = await server.ssrLoadModule("/src/render/sceneryPlacementFixture.ts");
  const path = new URL("../src/render/sceneryPlacement.fixture.json", import.meta.url);
  const cases = JSON.parse(readFileSync(path, "utf8"));
  const updated = cases.map(({ id, seed }) => ({ id, seed, hashes: placementHashes(id, seed) }));
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`Updated ${updated.length} scenery fixture cases.`);
} finally {
  await server.close();
}
