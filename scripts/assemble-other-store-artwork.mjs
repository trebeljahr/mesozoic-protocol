// Adapt the approved scene/logo layers to other store layouts, serially.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 8 });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
if (process.argv.length !== 3 || !arg?.startsWith("--out=") || !arg.slice(6)) {
  throw new Error(
    "Usage: node scripts/assemble-other-store-artwork.mjs --out=/path/to/new-candidates",
  );
}
const output = resolve(arg.slice(6));
if (output === root || output.startsWith(`${root}/`)) {
  throw new Error("Write candidates outside the repository; review before promoting them.");
}
const recipePath = "docs/store-assets/recipes/other-stores-layout.json";
const recipe = JSON.parse(await readFile(resolve(root, recipePath), "utf8"));
const masters = resolve(root, recipe.masterDirectory);
const logoPath = resolve(masters, recipe.logo);
const hashes = {};
async function source(path) {
  const bytes = await readFile(path);
  hashes[path.slice(root.length + 1)] = createHash("sha256").update(bytes).digest("hex");
  return bytes;
}
const logo = await source(logoPath);
const previews = [];
for (const item of recipe.exports) {
  const sourcePath =
    item.source === "icon" ? resolve(root, recipe.icon) : resolve(masters, item.source);
  const [width, height] = item.size;
  let pipeline = sharp(await source(sourcePath)).resize(width, height, {
    fit: "cover",
    position: item.position ?? "centre",
  });
  if (item.alpha !== "transparent")
    pipeline = pipeline.flatten({ background: item.background ?? "#101f20" });
  if (item.logo) {
    const label = await sharp(logo).resize({ width: item.logo.width }).toBuffer();
    pipeline = pipeline.composite([{ input: label, left: item.logo.left, top: item.logo.top }]);
  }
  if (item.alpha !== "transparent") pipeline = pipeline.removeAlpha();
  const path = resolve(output, item.output);
  if (!path.startsWith(`${output}/`)) throw new Error("Output escapes destination");
  await mkdir(dirname(path), { recursive: true });
  if (path.endsWith(".jpg")) await pipeline.jpeg({ quality: 95 }).toFile(path);
  else await pipeline.png().toFile(path);
  const metadata = await sharp(path).metadata();
  if (metadata.width !== width || metadata.height !== height)
    throw new Error(`Wrong size: ${item.output}`);
  const preview = await sharp(path)
    .resize(360, 300, { fit: "contain", background: "#101820" })
    .png()
    .toBuffer();
  previews.push(preview);
}
const tiles = previews.map((input, i) => ({
  input,
  left: (i % 3) * 380 + 10,
  top: Math.floor(i / 3) * 320 + 10,
}));
await sharp({ create: { width: 1140, height: 960, channels: 3, background: "#101820" } })
  .composite(tiles)
  .jpeg({ quality: 90 })
  .toFile(resolve(output, "review-sheet.jpg"));
await writeFile(
  resolve(output, "provenance.json"),
  `${JSON.stringify(
    {
      recipe: recipePath,
      recipeSha256: createHash("sha256")
        .update(await readFile(resolve(root, recipePath)))
        .digest("hex"),
      tool: "sharp",
      versions: sharp.versions,
      sourceSha256: hashes,
      status: "local adaptations; not uploaded; Microsoft product-slot verification pending",
      previewOrder: recipe.exports.map((item) => item.output),
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${recipe.exports.length} candidates and review sheet to ${output}`);
