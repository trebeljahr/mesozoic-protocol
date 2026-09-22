// Privacy-friendly Plausible wrapper.
//
// The Plausible script is injected by the `<!--PLAUSIBLE-->` transform
// in vite.config.ts, but only attaches on an allow-listed production
// host. track() mirrors that host check so local previews and native
// shells stay silent.
//
// The play subdomain is the only host that runs the game, so it is the
// only host that emits events; they report under the single canonical
// data-domain (VITE_PLAUSIBLE_DOMAIN).

type PlausibleProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    plausible?: (event: string, opts?: { props?: PlausibleProps }) => void;
  }
}

const allowedHosts = (import.meta.env.VITE_PLAUSIBLE_HOSTS ?? "play.mesozoicprotocol.com").split(
  ",",
);

export const track = (event: string, props?: PlausibleProps): void => {
  if (typeof window === "undefined") return;
  if (!allowedHosts.includes(window.location.hostname)) return;
  window.plausible?.(event, props ? { props } : undefined);
};
