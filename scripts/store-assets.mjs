// Assemble byte-for-byte upload copies from the curated store asset catalog.
// --check verifies sources, dimensions, transparency, hashes and all current files.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = resolve(root, "docs/store-assets");
const current = resolve(base, "current");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check")) {
  throw new Error("Usage: node scripts/store-assets.mjs [--check]");
}
const catalog = JSON.parse(await readFile(resolve(base, "catalog.json"), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function within(parent, path) {
  const result = resolve(parent, path);
  if (!result.startsWith(`${parent}/`)) throw new Error(`Path escapes asset root: ${path}`);
  return result;
}
const entries = [];
const names = new Set();
for (const asset of catalog.assets) {
  if (names.has(asset.output)) throw new Error(`Duplicate output: ${asset.output}`);
  names.add(asset.output);
  const source = within(root, asset.source);
  const output = within(current, asset.output);
  const bytes = await readFile(source);
  const entry = { ...asset, bytes: bytes.length, sha256: digest(bytes) };
  if (/\.(png|jpe?g|webp)$/i.test(asset.source)) {
    const metadata = await sharp(bytes).metadata();
    entry.dimensions = [metadata.width, metadata.height];
    entry.hasAlphaChannel = metadata.hasAlpha;
    if (asset.size && (metadata.width !== asset.size[0] || metadata.height !== asset.size[1])) {
      throw new Error(`Unexpected dimensions: ${asset.source}`);
    }
    if (asset.alpha === "transparent" && (await sharp(bytes).stats()).isOpaque) {
      throw new Error(`Expected real transparent pixels: ${asset.source}`);
    }
    if (asset.alpha === "none" && metadata.hasAlpha) {
      throw new Error(`Unexpected alpha channel: ${asset.source}`);
    }
  }
  if (check) {
    if (digest(await readFile(output)) !== entry.sha256) {
      throw new Error(`Upload copy differs from source: ${asset.output}`);
    }
  } else {
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
  }
  entries.push(entry);
}
const manifest = `${JSON.stringify({ schemaVersion: 1, selection: catalog.selection, assets: entries, missing: catalog.missing }, null, 2)}\n`;
const manifestPath = resolve(current, "manifest.json");
if (check) {
  if ((await readFile(manifestPath, "utf8")) !== manifest) {
    throw new Error("Manifest is stale. Run pnpm assets:store and review the diff.");
  }
} else {
  await mkdir(current, { recursive: true });
  await writeFile(manifestPath, manifest);
}
async function list(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await list(path)));
    else result.push(relative(current, path));
  }
  return result;
}
for (const path of await list(current)) {
  if (path !== "manifest.json" && !names.has(path)) {
    throw new Error(`Uncatalogued current file (remove or catalog it explicitly): ${path}`);
  }
}
console.log(
  `${check ? "Verified" : "Assembled"} ${entries.length} assets. ${catalog.missing.length} documented gaps; no uploads performed.`,
);
