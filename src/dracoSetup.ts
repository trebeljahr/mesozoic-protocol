import { useGLTF } from "@react-three/drei";

// Single source of truth for where the Draco decoder lives.
//
// Almost every GLB under public/models is Draco-compressed, so without a
// reachable decoder the game renders nothing. Both drei's `useGLTF` (default
// `https://www.gstatic.com/draco/versioned/decoders/1.5.5/`) and a hand-rolled
// `DRACOLoader` in src/ui/bakedIcon.ts used to fetch it from Google's CDN,
// which made the 3D scene silently dependent on an internet connection —
// broken offline on the Capacitor shells, contradicting the "no network
// activity" store privacy declarations, and leaking the player's IP to a
// third party on every launch. The decoder is vendored at public/draco
// instead; see public/draco/README.md for provenance.
//
// Served from the app origin, so this works identically on the web build, the
// Tauri desktop shell (asset protocol) and the iOS/Android WebViews.
export const DRACO_DECODER_PATH = "/draco/";

// Global, not per-call. drei keeps `decoderPath` in a module-level variable
// that every `useGLTF` / `useGLTF.preload` call reads when it builds the
// loader, so setting it once here covers all ~90 call sites and — more
// importantly — a future call site cannot regress to the CDN default by
// forgetting to pass a path.
//
// This runs at module-evaluation time and the module is imported first by
// src/App.tsx, ahead of every render module. ES modules evaluate depth-first
// in import order, so this assignment provably lands before the top-level
// `useGLTF.preload(...)` calls in src/render/*. (It cannot live in
// src/main.tsx: that file dynamically imports App only after the native save
// mirror is restored, precisely so the huge `three` chunk stays off the boot
// path — a static import here would drag it back on.) src/ui/bakedIcon.ts
// imports this module too, so the offscreen icon baker is covered even if it
// somehow wins the race to load first.
useGLTF.setDecoderPath(DRACO_DECODER_PATH);
