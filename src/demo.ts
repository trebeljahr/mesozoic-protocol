import type { RobotVariant } from "./sim/types";

// Compile-time DEMO build target. Single source of truth for the flag and
// every constant the demo slice needs.
//
// This mirrors src/debug.ts's `isDebug`: the flag resolves to a build-time
// constant, so Rollup/esbuild dead-code-eliminate every `IS_DEMO` branch out
// of the default build. `import.meta.env.VITE_DEMO` is injected by
// vite.config.ts (define) from the VITE_DEMO env var and typed in
// src/vite-env.d.ts — it is the string "1" for a demo build and undefined
// otherwise, so this collapses to a literal `true`/`false` at build time.
//
// IMPORTANT: the default free build at play.mesozoicprotocol.com is the FULL
// campaign — free, forever, ad-free (no paywalling; see the marketing plan +
// public/about.html). VITE_DEMO must NEVER be set for that build. This target
// exists only for web portals (CrazyGames) and Steam Next Fest: a
// try-before-you-buy slice that plays the five forest outposts and then
// points at the Steam wishlist.
export const IS_DEMO: boolean = import.meta.env.VITE_DEMO === "1";

// Highest campaign level playable in the demo. Level 6 opens the snow biome
// (see src/biomes.ts band comments); the demo stops at the five forest
// outposts (L1–L5).
export const DEMO_MAX_LEVEL = 5;

// The pilot the demo dangles as locked full-game content. Leela's unlock cost
// is 250 bolts (ROBOT_SPECS in src/sim/robotVariants.ts), so her teaser card
// appears the moment the player has banked enough to have bought her in the
// full build — the hook that drives the wishlist.
export const DEMO_TEASER_ROBOT: RobotVariant = "leela";

// Bolt balance that reveals the teaser pilot. Kept in sync with Leela's
// unlockBolts on purpose: "you could have unlocked her — get the full game."
export const DEMO_TEASER_ROBOT_BOLTS = 250;

// Wishlist destination for the demo CTAs. Placeholder until the Steam App ID
// is assigned.
// TODO(steam): swap in the real store page URL once the app exists.
export const STEAM_STORE_URL = "https://store.steampowered.com/app/0000000/Mesozoic_Protocol/";

// A campaign level is out of the demo's reach once it climbs past the forest
// outposts. Returns false in the full build (IS_DEMO folds to false), so
// isLevelUnlocked keeps its original behavior there.
export const isLevelBeyondDemo = (levelId: number): boolean => IS_DEMO && levelId > DEMO_MAX_LEVEL;
