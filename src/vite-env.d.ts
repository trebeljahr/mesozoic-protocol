/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLAUSIBLE_DOMAIN?: string;
  readonly VITE_PLAUSIBLE_HOSTS?: string;
  readonly VITE_PLAUSIBLE_SCRIPT_URL?: string;
  // "1" in the demo build target (VITE_DEMO=1), undefined otherwise. Read via
  // src/demo.ts's IS_DEMO; wired through vite.config.ts's define. See src/demo.ts.
  readonly VITE_DEMO?: string;
  readonly VITE_STEAM_STORE_READY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
