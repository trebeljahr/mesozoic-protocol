import type { TowerKind, TowerUpgrades } from "../sim/types";

// Visual feedback for the in-game upgrade tree. Tints tower-model
// materials so the player can read a tower's investment from across the
// board: each path picks 1–2 material "roles" and drifts their colour
// per tier. Stays inside the existing brand palette (no neons), and the
// drift respects tower type (fire stays warm, electric stays cool).
//
// Two material flavours in the GLBs:
// - Atlas materials (pulse/chain/mortar): single PaletteMaterial001
//   shared by every mesh of the model and driven by a baked texture.
//   We can only multiply that texture sample, so atlas tints darken or
//   shift hue across the whole silhouette.
// - Untextured baseColorFactor materials (cryo/flame/hive): each
//   logical part (Red, Black, Yellow, Blue, Gray, …) has its own
//   material. We replace baseColor outright per part.

export type TintEntry = {
  // Matches Mesh.material.name. Substring is enough (GLB material names
  // are unique within a tower model).
  match: string;
  // sRGB tuple in 0..1.
  rgb: [number, number, number];
  // multiply=true: tint multiplies the existing material colour/texture
  //   (atlas materials — pulse/chain/mortar).
  // multiply=false: tint replaces baseColor outright (cryo/flame/hive).
  multiply: boolean;
  // Optional additive emissive (sRGB 0..1). `multiply`/`rgb` can only
  // darken or hue-shift a texel — they can never lift a near-black region
  // toward a brighter colour. Emissive adds on top of the lit albedo, so
  // it's the only lever that can shift a black base toward a visible hue.
  emissive?: [number, number, number];
};

const tier = (upgrades: TowerUpgrades) => ({
  a: Math.min(3, Math.max(0, upgrades.a | 0)),
  b: Math.min(3, Math.max(0, upgrades.b | 0)),
});

// Atlas helper: combine an A-path hue tint with a B-path luminance
// multiplier so both purchases compound on the single shared material.
const atlas = (
  hue: [number, number, number],
  lum: number,
  matchName: string,
  emissive?: [number, number, number],
): TintEntry[] => [
  {
    match: matchName,
    rgb: [hue[0] * lum, hue[1] * lum, hue[2] * lum],
    multiply: true,
    ...(emissive ? { emissive } : {}),
  },
];

export function computeTowerTints(kind: TowerKind, upgrades: TowerUpgrades): TintEntry[] {
  const { a, b } = tier(upgrades);

  switch (kind) {
    case "pulse": {
      // Damage path (A) drives the body colour from the stock orange toward
      // a solid palette blue; fire-rate path (B) darkens the barrel from
      // grey to near-black. Both bake into the single shared
      // PaletteMaterial001.
      //
      // The baked atlas is orange (205,97,0) for the body and greys for the
      // barrels. Orange has a zero blue channel, so a multiply tint can only
      // ever mud it toward brown — it can never reach blue (this is why the
      // old cool tints read "muted"). The blue therefore has to come from an
      // additive emissive, exactly like the chain tower lifts its near-black
      // base toward steel blue. The multiply still pulls the orange's R/G
      // down per tier so the emissive blue isn't fighting a warm albedo, and
      // it tints the grey parts cool. Blue ratio sits near the palette's
      // azure accent (#5ad6ff) — B pinned, G mid, R low — for a vivid,
      // legibly-blue read rather than cyan.
      const colorHue: [number, number, number] = [
        [1.0, 1.0, 1.0],
        [0.72, 0.8, 1.0],
        [0.44, 0.6, 1.0],
        [0.18, 0.4, 1.0],
      ][a] as [number, number, number];
      const blueGlow: [number, number, number] = [
        [0, 0, 0],
        [0.05, 0.11, 0.3],
        [0.1, 0.22, 0.6],
        [0.14, 0.34, 0.95],
      ][a] as [number, number, number];
      // Fire-rate darkening: 1.0 keeps the stock grey barrel, ramping toward
      // black. A single material means one emissive for the whole
      // silhouette, so max damage turns the entire tower (barrels included)
      // solid blue; this factor attenuates BOTH the albedo and that blue
      // glow so heavy fire-rate investment drives the barrel to black
      // instead of leaving it lit blue.
      const barrelDark = [1.0, 0.72, 0.46, 0.26][b];
      return atlas(colorHue, barrelDark, "PaletteMaterial001", [
        blueGlow[0] * barrelDark,
        blueGlow[1] * barrelDark,
        blueGlow[2] * barrelDark,
      ]);
    }

    case "chain": {
      // Path A (Arc Reach) recolours the orb in TowerVfx (arcs hold a
      // fixed tint). Path B (Voltage) tints the body — electric stays cool and
      // drifts toward a deep royal blue with each tier so the tower
      // reads as "more charged". Blue stays pinned while red drops hard
      // and green is held LOW so the hue lands on a strong, dark royal
      // blue (#4169E1, R≈0.29·B, G≈0.47·B) rather than the brighter,
      // greener steel blue it used to read as.
      const voltageHue: [number, number, number] = [
        [1.0, 1.0, 1.0],
        [0.72, 0.78, 1.0],
        [0.5, 0.6, 1.0],
        [0.32, 0.46, 1.0],
      ][b] as [number, number, number];
      const voltageLum = [1.0, 0.95, 0.86, 0.78][b];
      // The Lighting Turret is a single atlas mesh and its base texels are
      // near-black (22,19,16) — multiplying the voltage hue onto black
      // stays black, so the multiply alone never lifts the base. Add a
      // royal-blue emissive that ramps with Voltage so the dark base
      // actually shifts toward #4169E1 as the tower upgrades. The ramp
      // holds the royal-blue ratio (R≈0.29·B, G≈0.46·B) at every tier so
      // the lifted hue stays a dark royal blue, not a bright steel blue.
      const voltageGlow: [number, number, number] = [
        [0, 0, 0],
        [0.03, 0.05, 0.11],
        [0.055, 0.09, 0.19],
        [0.08, 0.13, 0.28],
      ][b] as [number, number, number];
      return atlas(voltageHue, voltageLum, "PaletteMaterial001", voltageGlow);
    }

    case "mortar": {
      // Payload (A) drifts warmer/amber (more explosive), Breach (B)
      // darkens for a heavier-shell read.
      const payloadHue: [number, number, number] = [
        [1.0, 1.0, 1.0],
        [1.0, 0.88, 0.74],
        [1.0, 0.74, 0.55],
        [1.0, 0.62, 0.42],
      ][a] as [number, number, number];
      const breachLum = [1.0, 0.85, 0.72, 0.6][b];
      return atlas(payloadHue, breachLum, "PaletteMaterial001");
    }

    case "cryo": {
      // Subzero (A) deepens the blue core + drops the rings toward
      // cooler gold. Resonator (B) drifts the yellow rings/base toward
      // icy pale-cyan (resonating ice).
      const blueCore: [number, number, number] = [
        [0.006, 0.007, 0.037],
        [0.02, 0.08, 0.22],
        [0.04, 0.16, 0.36],
        [0.07, 0.28, 0.54],
      ][a] as [number, number, number];
      const yellowRing: [number, number, number] = (() => {
        // Resonator dominates the ring colour, Subzero only nudges it.
        if (b === 0 && a === 0) return [0.267, 0.216, 0.003];
        if (b >= 1) {
          return [
            [0.267, 0.216, 0.003],
            [0.34, 0.32, 0.18],
            [0.36, 0.46, 0.4],
            [0.34, 0.58, 0.62],
          ][b] as [number, number, number];
        }
        // Pure Subzero ramp on rings: darken slightly, hold colour.
        return [
          [0.267, 0.216, 0.003],
          [0.22, 0.18, 0.003],
          [0.18, 0.15, 0.003],
          [0.14, 0.12, 0.003],
        ][a] as [number, number, number];
      })();
      const yellowBase: [number, number, number] =
        b >= 1
          ? ([
              [0.173, 0.127, 0.002],
              [0.22, 0.2, 0.1],
              [0.22, 0.28, 0.24],
              [0.2, 0.34, 0.38],
            ][b] as [number, number, number])
          : ([0.173, 0.127, 0.002] as [number, number, number]);
      return [
        { match: "BlueMiddleEMPTurret", rgb: blueCore, multiply: false },
        { match: "YellowRing1EMPTurret", rgb: yellowRing, multiply: false },
        { match: "YellowRing3EMPTurret", rgb: yellowRing, multiply: false },
        { match: "YellowBaseEMPTurret", rgb: yellowBase, multiply: false },
      ];
    }

    case "flame": {
      // Combustion (A) lifts the red panel toward orange at tier 0 and
      // deepens back to the stock red at tier 3 — so a freshly placed
      // pyre looks brighter/orange-ish and reads "more red" as you
      // invest. Nozzle (B) lightens the gray middle, then darkens it
      // back as you upgrade.
      const red: [number, number, number] = [
        [0.65, 0.26, 0.07],
        [0.58, 0.16, 0.04],
        [0.52, 0.08, 0.02],
        [0.479, 0.019, 0.004],
      ][a] as [number, number, number];
      const gray: [number, number, number] = [
        [0.18, 0.18, 0.18],
        [0.12, 0.12, 0.12],
        [0.075, 0.075, 0.075],
        [0.044, 0.044, 0.044],
      ][b] as [number, number, number];
      return [
        { match: "RedBaseFlamethrowerTurret", rgb: red, multiply: false },
        { match: "GrayMiddleFlamethrowerTurret", rgb: gray, multiply: false },
      ];
    }

    case "hive": {
      // Drone Bay (A) saturates the orange storage block (more drones,
      // hotter bay). Service Link (B) drifts the yellow base toward a
      // brighter "energised" amber.
      const orange: [number, number, number] = [
        [0.55, 0.22, 0.04],
        [0.617, 0.171, 0],
        [0.74, 0.16, 0],
        [0.85, 0.14, 0],
      ][a] as [number, number, number];
      const yellowBase: [number, number, number] = [
        [0.617, 0.279, 0.0015],
        [0.7, 0.4, 0.06],
        [0.8, 0.55, 0.12],
        [0.9, 0.7, 0.22],
      ][b] as [number, number, number];
      return [
        { match: "OrangeStorageHiveTurret", rgb: orange, multiply: false },
        { match: "YellowBaseHiveTurret", rgb: yellowBase, multiply: false },
      ];
    }
  }
}

// Per-instance chain orb colour drift along Path A (Arc Reach) — the orb
// deepens from pale cool blue toward a saturated cool steel blue. Blue
// stays pinned at 1.0 (additive glow), red drops hardest and green
// settles mid so the hue tracks steel blue (#4682B4) as it darkens. The
// crossed arcs no longer drift; they hold a fixed tint in TowerVfx.tsx.
export function chainOrbBase(tierA: number): [number, number, number] {
  const t = Math.min(3, Math.max(0, tierA | 0));
  return [
    [0.62, 0.86, 1.0],
    [0.46, 0.74, 1.0],
    [0.34, 0.62, 1.0],
    [0.26, 0.52, 1.0],
  ][t] as [number, number, number];
}

// Helper for the renderer: returns a stable cache key for a tier pair
// so we can skip re-applying tints when nothing changed.
export const tierKey = (u: TowerUpgrades): number => (u.a & 0xf) | ((u.b & 0xf) << 4);
