import { execFileSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createLogger, defineConfig, loadEnv, type PluginOption } from "vite";

const DEV_PORT = 3286;
const HATCHKIT_VITE_PLUGIN = "@hatchkit/dev-plugin-vite";
const SOURCEMAP_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const PHYSICS_CHUNK_PACKAGES = [
  "/node_modules/@dimforge/",
  "/node_modules/@react-three/rapier/",
  "/node_modules/three-bvh-csg/",
  "/node_modules/three-mesh-bvh/",
];
const THREE_CHUNK_PACKAGES = [
  "/node_modules/@react-three/",
  "/node_modules/@react-spring/three/",
  "/node_modules/@monogrid/gainmap-js/",
  "/node_modules/camera-controls/",
  "/node_modules/detect-gpu/",
  "/node_modules/glsl-noise/",
  "/node_modules/maath/",
  "/node_modules/meshline/",
  "/node_modules/n8ao/",
  "/node_modules/postprocessing/",
  "/node_modules/stats-gl/",
  "/node_modules/three/",
  "/node_modules/three-stdlib/",
  "/node_modules/troika-three-text/",
  "/node_modules/troika-three-utils/",
];
const UI_HEAVY_CHUNK_PACKAGES = [
  "/node_modules/react/",
  "/node_modules/react-dom/",
  "/node_modules/react-reconciler/",
  "/node_modules/scheduler/",
  "/node_modules/use-sync-external-store/",
  "/node_modules/zustand/",
];

// drei hardcodes Google's Draco CDN as `useGLTF`'s default decoder path.
// src/dracoSetup.ts overrides it at runtime, but the literal still ends up
// minified into the `three` chunk — a dead string that is also a live
// regression risk: anything that manages to call `useGLTF` before that
// override evaluates would silently fetch the decoder from gstatic, breaking
// every model load offline and contradicting the stores' "no network
// activity" declaration. Rewriting the default to the vendored path at build
// time removes the fallback entirely, so `grep -r gstatic dist/` stays empty
// and there is nothing left to regress to.
const DREI_DRACO_CDN_DEFAULT = /https:\/\/www\.gstatic\.com\/draco\/versioned\/decoders\/[\d.]+\//g;
const DREI_GLTF_MODULE = "@react-three/drei/core/Gltf";
const LOCAL_DRACO_PATH = "/draco/"; // keep in sync with src/dracoSetup.ts

const localDracoDefault = (): PluginOption => ({
  name: "local-draco-default",
  apply: "build",
  transform(code: string, id: string) {
    if (!id.replaceAll("\\", "/").includes(DREI_GLTF_MODULE)) return null;
    if (!DREI_DRACO_CDN_DEFAULT.test(code)) {
      // A drei upgrade moved or renamed the default. Fail the build rather
      // than quietly shipping whatever the new default is.
      throw new Error(
        `[local-draco-default] Expected a Draco CDN default in ${DREI_GLTF_MODULE}, found none. ` +
          `Re-check drei's useGLTF decoder path handling and update this plugin.`,
      );
    }
    DREI_DRACO_CDN_DEFAULT.lastIndex = 0;
    return { code: code.replace(DREI_DRACO_CDN_DEFAULT, LOCAL_DRACO_PATH), map: null };
  },
});

type HatchkitViteModule = {
  localDev?: (options: { slug: string }) => PluginOption;
};

type BuildSourcemap = boolean | "hidden" | "inline";

const getBuildSourcemap = (value?: string): BuildSourcemap => {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "hidden" || normalized === "inline") {
    return normalized;
  }

  return SOURCEMAP_TRUE_VALUES.has(normalized ?? "");
};

const matchesAnyPackage = (id: string, packages: string[]) =>
  packages.some((packagePath) => id.includes(packagePath));

const manualChunks = (id: string): string | undefined => {
  const normalizedId = id.replaceAll("\\", "/");

  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  if (matchesAnyPackage(normalizedId, PHYSICS_CHUNK_PACKAGES)) {
    return "physics";
  }

  if (matchesAnyPackage(normalizedId, THREE_CHUNK_PACKAGES)) {
    return "three";
  }

  if (matchesAnyPackage(normalizedId, UI_HEAVY_CHUNK_PACKAGES)) {
    return "ui-heavy";
  }

  // The Tauri IPC bindings are behind a dynamic import in src/updater.ts and
  // are only reachable inside the desktop shell. Falling through to `vendor`
  // would pull them into the eagerly-loaded bundle every web visitor
  // downloads, for code that can never run there.
  if (normalizedId.includes("/node_modules/@tauri-apps/")) {
    return "tauri";
  }

  return "vendor";
};

const loadHatchkitLocalDev = async (): Promise<PluginOption[]> => {
  try {
    const { localDev } = (await import(HATCHKIT_VITE_PLUGIN)) as HatchkitViteModule;
    return typeof localDev === "function" ? [localDev({ slug: "mesozoic-protocol" })] : [];
  } catch (error) {
    console.warn(
      `Skipping Hatchkit local-dev Vite plugin: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
};

// Probe (never mutate) the tailnet for a raw-TCP `tailscale serve` bridge
// on the dev port. The bridge itself is host-level state set up once with
// `tailscale serve --bg --tcp=<port> tcp://127.0.0.1:<port>` — it survives
// reboots and is shared like the host-wide :443 Caddy bridge, so the config
// only reads it. Returns the node's MagicDNS name + whether the port is
// currently served. Silent null when Tailscale is absent/offline.
const probeTailnetServe = (port: number): { dnsName: string; served: boolean } | null => {
  try {
    const status = JSON.parse(
      execFileSync("tailscale", ["status", "--json"], { timeout: 4000, encoding: "utf8" }),
    ) as { Self?: { DNSName?: string } };
    const dnsName = status.Self?.DNSName?.replace(/\.$/, "");
    if (!dnsName) return null;

    const serveStatus = execFileSync("tailscale", ["serve", "status"], {
      timeout: 4000,
      encoding: "utf8",
    });
    const served = new RegExp(`tcp://\\S*:${port}(?!\\d)`).test(serveStatus);
    return { dnsName, served };
  } catch {
    return null;
  }
};

// Append a `Tailnet:` line to Vite's dev banner pointing at the raw-port
// MagicDNS URL (e.g. http://laptop.tailnet.ts.net:3286/). The TCP bridge
// is tailnet-only — LAN (192.168.x) never reaches it — and the IP-literal
// form bypasses the Vite host check; the MagicDNS name needs `.ts.net` in
// `server.allowedHosts` (set below). If the bridge isn't up, print the
// one-time enable command instead of a dead URL.
const tailnetPortBanner = (port: number): PluginOption => ({
  name: "tailnet-port-banner",
  apply: "serve",
  configureServer(server) {
    const probe = probeTailnetServe(port);
    if (!probe) return;

    const { logger } = server.config;
    const original = server.printUrls.bind(server);
    server.printUrls = () => {
      original();
      const label = "\x1b[1mTailnet\x1b[0m";
      if (probe.served) {
        logger.info(
          `  \x1b[32m➜\x1b[0m  ${label}:  \x1b[36mhttp://${probe.dnsName}:${port}/\x1b[0m`,
        );
      } else {
        logger.info(
          `  \x1b[33m➜\x1b[0m  ${label}:  not exposed. Run once: ` +
            `\x1b[2mtailscale serve --bg --tcp=${port} tcp://127.0.0.1:${port}\x1b[0m`,
        );
      }
    };
  },
});

export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, ".", "");
  const plausibleDomain = env.VITE_PLAUSIBLE_DOMAIN ?? "play.mesozoicprotocol.com";
  // Hosts where the loader attaches. Only the play subdomain runs the
  // game, so it is the sole analytics host; events report under the
  // canonical data-domain above. Keep in sync with src/analytics.ts.
  const plausibleHosts = (env.VITE_PLAUSIBLE_HOSTS ?? "play.mesozoicprotocol.com").split(",");
  const plausibleScriptUrl =
    env.VITE_PLAUSIBLE_SCRIPT_URL ??
    "https://plausible.trebeljahr.com/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js";
  // Host-gated: the marker injects a loader, but it only appends the
  // Plausible script when the current hostname is allow-listed.
  // The inline shim queues track() calls fired before the deferred
  // script attaches, so callers don't need to wait for load.
  // Build SHA injected into index.html as a `<meta>` tag so prod
  // can be curl-verified (`curl … | grep build-sha`). Fed by the
  // deploy workflow via `--build-arg VITE_BUILD_SHA=$GITHUB_SHA`,
  // surfaced to Vite through the matching `ENV VITE_BUILD_SHA` in
  // the Dockerfile. Falls back to "dev" for local builds.
  const buildSha = env.VITE_BUILD_SHA ?? "dev";
  const buildSourcemap = getBuildSourcemap(env.BUILD_SOURCEMAP ?? env.VITE_BUILD_SOURCEMAP);
  const buildShaTag = `<meta name="build-sha" content="${buildSha}" />`;
  const plausibleTag = plausibleDomain
    ? `<script>
      (function () {
        var hosts = ${JSON.stringify(plausibleHosts)};
        if (hosts.indexOf(location.hostname) === -1) return;
        window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)};
        var script=document.createElement("script");
        script.defer=true;
        script.dataset.domain=${JSON.stringify(plausibleDomain)};
        script.src=${JSON.stringify(plausibleScriptUrl)};
        document.head.appendChild(script);
      })();
    </script>`
    : "";
  const localDevEnabled = command === "serve" && env.HATCHKIT_LOCAL_DEV !== "0";
  const hatchkitPlugins = localDevEnabled ? await loadHatchkitLocalDev() : [];

  // Quiet logger for dev: silence routine HMR chatter (hmr update,
  // hmr invalidate, page reload) so the terminal stays clean. Warnings
  // and errors still print — those go through warn/error, not info.
  const quietLogger = createLogger();
  const baseInfo = quietLogger.info.bind(quietLogger);
  const HMR_NOISE = /\b(hmr update|hmr invalidate|page reload)\b/;
  quietLogger.info = (msg, opts) => {
    if (typeof msg === "string") {
      if (HMR_NOISE.test(msg)) return;
    }
    baseInfo(msg, opts);
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
      localDracoDefault(),
      {
        name: "plausible-html",
        transformIndexHtml(html: string) {
          return html
            .replace("<!--BUILD-SHA-->", buildShaTag)
            .replace("<!--PLAUSIBLE-->", plausibleTag);
        },
      },
      // Tailscale-served dev URL via host-wide Caddy + tailscale serve
      // TCP=443. Writes ~/.config/dev/projects/mesozoic-protocol.caddy
      // on dev startup, replaces Vite's Local/Network banner with
      // Local/Tailscale. Set `HATCHKIT_LOCAL_DEV=0` in env to disable.
      // Host plumbing is the host's `hatchkit dev-setup init` job.
      ...hatchkitPlugins,
      // Raw-port tailnet banner: prints the `tailscale serve --tcp=<port>`
      // MagicDNS URL after Vite's own banner. Placed after the hatchkit
      // plugin so its printUrls wrapper runs outermost (calls hatchkit's
      // first, then appends the Tailnet line).
      ...(localDevEnabled ? [tailnetPortBanner(DEV_PORT)] : []),
    ] as PluginOption[],
    clearScreen: false,
    customLogger: command === "serve" ? quietLogger : undefined,
    server: {
      port: DEV_PORT,
      strictPort: true,
      watch: {
        // Other Claude Code worktrees live under `.claude/worktrees/*`
        // and trigger spurious `page reload` + `changed tsconfig`
        // full-reloads in this main dev server whenever any agent
        // edits its own copy. Ignore everything under there.
        ignored: ["**/.claude/worktrees/**"],
      },
      // IPv4 loopback only — no LAN / Tailscale-IP broadcast during dev.
      // Remote access is tailnet-only and rides on `tailscale serve`, which
      // proxies into this loopback bind without ever touching the LAN iface:
      //   - HTTPS  via the host-wide Caddy bridge (serve :443).
      //   - raw port via `tailscale serve --tcp=<DEV_PORT>` — the URL the
      //     tailnet-port-banner plugin prints on startup.
      // Must be the literal "127.0.0.1", NOT `false`/`localhost`: on macOS
      // `localhost` resolves to ::1, so Vite would bind IPv6 loopback only
      // and Caddy's IPv4 `reverse_proxy 127.0.0.1` could not reach it.
      host: "127.0.0.1",
      // Vite 5+ rejects requests whose Host header doesn't match
      // localhost. The Caddy reverse_proxy forwards the original Host
      // (`mesozoic-protocol.local.trebeljahr.com`), so without this entry
      // the Tailscale HTTPS URL 403s on every asset (incl. /models/*.glb),
      // crashing the r3f scene with "Cannot read properties of undefined
      // (reading 'max')" out of useGLTF -> meshSource.
      //
      // Two remote surfaces, both tailnet-only, both proxying to this
      // loopback bind — so both Host values must be whitelisted:
      //   - `.local.trebeljahr.com` — host-wide Caddy HTTPS (serve :443).
      //   - `.ts.net`               — raw-port `tailscale serve --tcp=<port>`,
      //     which forwards the MagicDNS Host (e.g. laptop.<tailnet>.ts.net)
      //     unchanged. Without this the raw-port URL 403s the host check.
      // (The IP-literal form of the raw-port URL bypasses the check, so it
      // works regardless.) Production builds never read this field.
      allowedHosts: [".local.trebeljahr.com", ".ts.net"],
    },
    build: {
      target: "es2022",
      sourcemap: buildSourcemap,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
  };
});
