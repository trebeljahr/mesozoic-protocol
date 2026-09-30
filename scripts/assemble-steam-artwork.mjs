// Recovered A5 layout recipe. Generates candidates, never overwrites approved masters.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
if (!arg?.startsWith("--out=") || process.argv.length !== 3 || !arg.slice(6)) {
  throw new Error("Usage: node scripts/assemble-steam-artwork.mjs --out=/path/to/new-candidates");
}
const output = resolve(arg.slice(6));
if (output === root || output.startsWith(`${root}/`)) {
  throw new Error("Write candidates outside the repository; review before promoting them.");
}
const recipe = JSON.parse(
  readFileSync(join(root, "docs/store-assets/recipes/a5-layout.json"), "utf8"),
);
const masters = join(root, recipe.masterDirectory);
const font = join(root, recipe.font);
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "steam-artwork-"));
const run = (args) => execFileSync("magick", ["-limit", "thread", "1", ...args]);
const logo = join(output, "library-logo.png");
try {
  const words = recipe.logo.words.map(([word, color]) => {
    const path = join(temp, `${word}.png`);
    run([
      "-background",
      "none",
      "-font",
      font,
      "-pointsize",
      String(recipe.logo.pointSize),
      "-fill",
      color,
      "-stroke",
      recipe.logo.outline,
      "-strokewidth",
      String(recipe.logo.strokeWidth),
      `label:${word}`,
      "-trim",
      "+repage",
      "-resize",
      `${recipe.logo.wordWidth}x`,
      path,
    ]);
    return path;
  });
  run([
    ...words,
    "-background",
    "none",
    "-gravity",
    "center",
    "-append",
    "-bordercolor",
    "none",
    "-border",
    String(recipe.logo.border),
    "-resize",
    `${recipe.logo.width}x`,
    logo,
  ]);
  for (const c of recipe.capsules) {
    const label = join(temp, `${c.name}.png`);
    run([logo, "-resize", `${c.logoWidth}x`, label]);
    run([
      join(masters, c.source),
      "-resize",
      `${c.width}x${c.height}^`,
      "-gravity",
      c.gravity,
      "-extent",
      `${c.width}x${c.height}`,
      label,
      "-gravity",
      "northwest",
      "-geometry",
      `+${c.x}+${c.y}`,
      "-composite",
      join(output, `${c.name}.png`),
    ]);
  }
  const c = recipe.smallCapsule;
  const label = join(temp, "small-title.png");
  run([logo, "-resize", `${c.logoWidth}x`, label]);
  run([
    join(masters, "landscape-master.png"),
    "-resize",
    `${c.width}x${c.height}^`,
    "-gravity",
    c.gravity,
    "-extent",
    `${c.width}x${c.height}`,
    "-fill",
    c.overlay,
    "-draw",
    `rectangle 0,0 ${c.width},${c.height}`,
    label,
    "-gravity",
    "center",
    "-composite",
    join(output, "small-capsule.png"),
  ]);
  const h = recipe.hero;
  run([
    join(masters, "hero-master.png"),
    "-resize",
    `${h.width}x${h.height}^`,
    "-gravity",
    h.gravity,
    "-extent",
    `${h.width}x${h.height}`,
    join(output, "library-hero.png"),
  ]);
  copyFileSync(join(output, "header-capsule.png"), join(output, "library-header.png"));
  console.log(`Candidate exports written to ${output}. Compare visually before promotion.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
