import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Host split: the apex domain is the marketing site (landing, press,
// privacy), the game lives on the play subdomain. The sitemap is served
// from the same dist on every host, but robots.txt points crawlers at
// the apex copy. The retired host (protocol.trebeljahr.com) 301-redirects
// to the play subdomain, so it is intentionally absent here.
const seo = {
  siteUrl: "https://mesozoicprotocol.com",
  gameUrl: "https://play.mesozoicprotocol.com",
  outputDir: path.resolve(__dirname, "../public"),
  routes: [
    { path: "/", changefreq: "monthly", priority: "1.0" },
    { path: "/press", changefreq: "monthly", priority: "0.6" },
    { path: "/privacy", changefreq: "yearly", priority: "0.3" },
  ],
  gameRoutes: [{ path: "/", changefreq: "monthly", priority: "0.9" }],
  lastmod: (process.env.SITEMAP_LASTMOD || new Date().toISOString()).slice(0, 10),
};

const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const joinUrl = (base, urlPath) => {
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = urlPath === "/" ? "/" : `/${urlPath.replace(/^\/+/, "")}`;
  return `${cleanBase}${cleanPath}`;
};

const urlEntry = (base) => (route) =>
  `  <url>
    <loc>${escapeXml(joinUrl(base, route.path))}</loc>
    <lastmod>${seo.lastmod}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...seo.routes.map(urlEntry(seo.siteUrl)), ...seo.gameRoutes.map(urlEntry(seo.gameUrl))].join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Sitemap: ${joinUrl(seo.siteUrl, "/sitemap.xml")}
`;

// Skip writing files that would only differ in `lastmod`. Treats sitemap as
// unchanged when the URL set is the same — keeps `pnpm build` from dirtying
// git with a fresh date on every local build. CI can force a refresh by
// setting SITEMAP_LASTMOD explicitly.
const writeIfChanged = async (filePath, next, { ignoreLastmod = false } = {}) => {
  let current = "";
  try {
    current = await readFile(filePath, "utf8");
  } catch {
    /* missing file → write */
  }
  if (ignoreLastmod) {
    const strip = (s) => s.replace(/<lastmod>[^<]+<\/lastmod>/g, "");
    if (strip(current) === strip(next)) return;
  } else if (current === next) {
    return;
  }
  await writeFile(filePath, next);
};

await mkdir(seo.outputDir, { recursive: true });
await Promise.all([
  writeIfChanged(path.join(seo.outputDir, "sitemap.xml"), sitemap, { ignoreLastmod: true }),
  writeIfChanged(path.join(seo.outputDir, "robots.txt"), robots),
]);
