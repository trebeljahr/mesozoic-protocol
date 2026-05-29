import type { TowerKind, TowerUpgrades } from "../sim/types";

// Visual feedback for the in-game upgrade tree. Each path picks 1–2
// material "roles" and drifts their colour per tier so the player can
// read a tower's investment from across the board. Stays inside the
// existing brand palette and respects tower type (fire stays
// warm, electric stays cool).
//
// Two GLB flavours, each with its own tint variant:
//
// - "material": cryo/flame/hive. Each logical part (Red, Black, Yellow,
//   Blue, Gray, …) has its own MeshStandardMaterial. We replace
//   baseColor outright per part.
//
// - "atlas": pulse/chain/mortar. The model is a single mesh with a
//   single PaletteMaterial001 that samples a tiny 32×4 PaletteBaseColor
//   texture; each "part" of the silhouette UVs into a different 4-pixel
//   swatch. We clone that texture per tower instance and repaint
//   specific swatches per upgrade tier — which gives the same per-part
//   independence as cryo/flame even though there's only one material.

export type MaterialTint = {
  kind: "material";
  match: string;
  rgb: [number, number, number];
  multiply: boolean;
};

export type AtlasSwatch = {
  // Left edge x of the 4-pixel-wide swatch column in the PaletteBaseColor
  // atlas (atlas is 32×4, swatches sit at x=0,4,8,…).
  x: number;
  // sRGB tuple in 0..1 — written straight into the cloned atlas, so this
  // is the colour the player actually sees on that part of the model.
  rgb: [number, number, number];
};

export type AtlasTint = {
  kind: "atlas";
  match: string;
  swatches: AtlasSwatch[];
};

export type TintEntry = MaterialTint | AtlasTint;

const tier = (upgrades: TowerUpgrades) => ({
  a: Math.min(3, Math.max(0, upgrades.a | 0)),
  b: Math.min(3, Math.max(0, upgrades.b | 0)),
});

export function computeTowerTints(kind: TowerKind, upgrades: TowerUpgrades): TintEntry[] {
  const { a, b } = tier(upgrades);

  switch (kind) {
    case "pulse": {
      // Gatling Gun atlas — 5 swatches, all rows identical:
      //   x=0  #CD6100 main body (orange)
      //   x=4  #737373 mid-gray accent
      //   x=8  #484848 dark-gray accent
      //   x=12 #DC7700 secondary body (lighter orange)
      //   x=16 #3B3B3B darkest gray (barrel core)
      //
      // Path A (Damage) drifts the orange body swatches toward a steel
      // royal-blue: more damage reads as a heavier, "armoured" body.
      // Path B (Fire Rate) darkens the gray swatches toward near-black,
      // so heavy fire-rate investment reads as a charred, well-used
      // barrel — independent from the body colour.
      const bodyOrange: [number, number, number] = [
        [0.804, 0.38, 0.0],
        [0.55, 0.34, 0.18],
        [0.3, 0.3, 0.46],
        [0.15, 0.31, 0.62],
      ][a] as [number, number, number];
      const bodyAccent: [number, number, number] = [
        [0.863, 0.467, 0.0],
        [0.6, 0.43, 0.28],
        [0.34, 0.4, 0.6],
        [0.2, 0.4, 0.78],
      ][a] as [number, number, number];
      const grayMid: [number, number, number] = [
        [0.451, 0.451, 0.451],
        [0.32, 0.32, 0.32],
        [0.2, 0.2, 0.2],
        [0.09, 0.09, 0.09],
      ][b] as [number, number, number];
      const grayDark: [number, number, number] = [
        [0.282, 0.282, 0.282],
        [0.2, 0.2, 0.2],
        [0.12, 0.12, 0.12],
        [0.055, 0.055, 0.055],
      ][b] as [number, number, number];
      const graySoot: [number, number, number] = [
        [0.231, 0.231, 0.231],
        [0.16, 0.16, 0.16],
        [0.09, 0.09, 0.09],
        [0.035, 0.035, 0.035],
      ][b] as [number, number, number];
      return [
        {
          kind: "atlas",
          match: "PaletteMaterial001",
          swatches: [
            { x: 0, rgb: bodyOrange },
            { x: 4, rgb: grayMid },
            { x: 8, rgb: grayDark },
            { x: 12, rgb: bodyAccent },
            { x: 16, rgb: graySoot },
          ],
        },
      ];
    }

    case "chain": {
      // Lighting Turret atlas — 6 swatches:
      //   x=0  #313131 mid gray
      //   x=4  #161310 near-black base
      //   x=8  #38332F warm dark gray
      //   x=12 #7C12DC purple accent (coils / lights)
      //   x=16 #33085F dark purple base of coil
      //   x=20 #232B39 dark navy shroud
      //
      // Path A (Arc Reach) handles the orb in TowerVfx; here we use it
      // to subtly lift the navy shroud so a high-reach chain reads as
      // "alert / scanning". Path B (Voltage) is the dominant signal:
      // drifts the purple coils toward a saturated royal blue and
      // deepens the base.
      const coilPurple: [number, number, number] = [
        [0.486, 0.071, 0.863],
        [0.4, 0.2, 0.9],
        [0.28, 0.35, 0.95],
        [0.18, 0.45, 1.0],
      ][b] as [number, number, number];
      const coilPurpleDark: [number, number, number] = [
        [0.2, 0.031, 0.373],
        [0.15, 0.1, 0.45],
        [0.1, 0.18, 0.55],
        [0.06, 0.25, 0.66],
      ][b] as [number, number, number];
      const navyShroud: [number, number, number] = [
        [0.137, 0.169, 0.224],
        [0.16, 0.22, 0.32],
        [0.18, 0.28, 0.42],
        [0.2, 0.36, 0.55],
      ][a] as [number, number, number];
      const grayMid: [number, number, number] = [
        [0.192, 0.192, 0.192],
        [0.18, 0.2, 0.24],
        [0.16, 0.22, 0.3],
        [0.14, 0.24, 0.36],
      ][b] as [number, number, number];
      const baseBlack: [number, number, number] = [
        [0.086, 0.075, 0.063],
        [0.07, 0.08, 0.1],
        [0.06, 0.09, 0.13],
        [0.05, 0.1, 0.16],
      ][b] as [number, number, number];
      const warmDark: [number, number, number] = [
        [0.22, 0.2, 0.184],
        [0.2, 0.21, 0.22],
        [0.18, 0.22, 0.26],
        [0.16, 0.24, 0.32],
      ][b] as [number, number, number];
      return [
        {
          kind: "atlas",
          match: "PaletteMaterial001",
          swatches: [
            { x: 0, rgb: grayMid },
            { x: 4, rgb: baseBlack },
            { x: 8, rgb: warmDark },
            { x: 12, rgb: coilPurple },
            { x: 16, rgb: coilPurpleDark },
            { x: 20, rgb: navyShroud },
          ],
        },
      ];
    }

    case "mortar": {
      // Missile Turret atlas — 8 swatches:
      //   x=0  #363636 hull gray
      //   x=4  #583D00 dark warm brown (shell shadow)
      //   x=8  #694900 mid warm brown (shell body)
      //   x=12 #AF7A00 gold/amber (warhead casing)
      //   x=16 #323232 mid hull gray
      //   x=20 #FB2E0F vivid red-orange (warhead tip)
      //   x=24 #404040 lighter hull gray
      //   x=28 #010101 near-black (vent / barrel mouth)
      //
      // Path A (Payload) drives the warm/red swatches toward a deeper,
      // saturated red — more payload reads as more explosive. Path B
      // (Breach) darkens the hull greys/black toward charred near-black,
      // independent of payload — mirrors the flamethrower's gray→black
      // nozzle ramp.
      const brownShadow: [number, number, number] = [
        [0.345, 0.239, 0.0],
        [0.45, 0.18, 0.04],
        [0.55, 0.12, 0.04],
        [0.62, 0.08, 0.03],
      ][a] as [number, number, number];
      const brownBody: [number, number, number] = [
        [0.412, 0.286, 0.0],
        [0.55, 0.22, 0.05],
        [0.66, 0.14, 0.04],
        [0.74, 0.09, 0.03],
      ][a] as [number, number, number];
      const warheadCasing: [number, number, number] = [
        [0.686, 0.478, 0.0],
        [0.82, 0.36, 0.08],
        [0.92, 0.24, 0.06],
        [0.98, 0.18, 0.05],
      ][a] as [number, number, number];
      const warheadTip: [number, number, number] = [
        [0.984, 0.18, 0.059],
        [0.99, 0.14, 0.04],
        [1.0, 0.1, 0.03],
        [1.0, 0.06, 0.02],
      ][a] as [number, number, number];
      const hullGray: [number, number, number] = [
        [0.212, 0.212, 0.212],
        [0.16, 0.16, 0.16],
        [0.1, 0.1, 0.1],
        [0.045, 0.045, 0.045],
      ][b] as [number, number, number];
      const hullGray2: [number, number, number] = [
        [0.196, 0.196, 0.196],
        [0.15, 0.15, 0.15],
        [0.09, 0.09, 0.09],
        [0.042, 0.042, 0.042],
      ][b] as [number, number, number];
      const hullGray3: [number, number, number] = [
        [0.251, 0.251, 0.251],
        [0.19, 0.19, 0.19],
        [0.12, 0.12, 0.12],
        [0.052, 0.052, 0.052],
      ][b] as [number, number, number];
      const ventBlack: [number, number, number] = [
        [0.004, 0.004, 0.004],
        [0.004, 0.004, 0.004],
        [0.002, 0.002, 0.002],
        [0.0, 0.0, 0.0],
      ][b] as [number, number, number];
      return [
        {
          kind: "atlas",
          match: "PaletteMaterial001",
          swatches: [
            { x: 0, rgb: hullGray },
            { x: 4, rgb: brownShadow },
            { x: 8, rgb: brownBody },
            { x: 12, rgb: warheadCasing },
            { x: 16, rgb: hullGray2 },
            { x: 20, rgb: warheadTip },
            { x: 24, rgb: hullGray3 },
            { x: 28, rgb: ventBlack },
          ],
        },
      ];
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
        if (b === 0 && a === 0) return [0.267, 0.216, 0.003];
        if (b >= 1) {
          return [
            [0.267, 0.216, 0.003],
            [0.34, 0.32, 0.18],
            [0.36, 0.46, 0.4],
            [0.34, 0.58, 0.62],
          ][b] as [number, number, number];
        }
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
        { kind: "material", match: "BlueMiddleEMPTurret", rgb: blueCore, multiply: false },
        { kind: "material", match: "YellowRing1EMPTurret", rgb: yellowRing, multiply: false },
        { kind: "material", match: "YellowRing3EMPTurret", rgb: yellowRing, multiply: false },
        { kind: "material", match: "YellowBaseEMPTurret", rgb: yellowBase, multiply: false },
      ];
    }

    case "flame": {
      // Combustion (A) lifts the red panel toward orange at tier 0 and
      // deepens back to the stock red at tier 3. Nozzle (B) lightens
      // the gray middle then darkens it back as you upgrade.
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
        { kind: "material", match: "RedBaseFlamethrowerTurret", rgb: red, multiply: false },
        { kind: "material", match: "GrayMiddleFlamethrowerTurret", rgb: gray, multiply: false },
      ];
    }

    case "hive": {
      // Drone Bay (A) saturates the orange storage block. Service Link
      // (B) drifts the yellow base toward a brighter "energised" amber.
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
        { kind: "material", match: "OrangeStorageHiveTurret", rgb: orange, multiply: false },
        { kind: "material", match: "YellowBaseHiveTurret", rgb: yellowBase, multiply: false },
      ];
    }
  }
}

// Per-instance chain orb colour drift along Path A (Arc Reach).
export function chainOrbBase(tierA: number): [number, number, number] {
  const t = Math.min(3, Math.max(0, tierA | 0));
  return [
    [0.62, 0.86, 1.0],
    [0.46, 0.74, 1.0],
    [0.34, 0.62, 1.0],
    [0.26, 0.52, 1.0],
  ][t] as [number, number, number];
}

// Stable cache key for a tier pair so we can skip re-applying tints
// when nothing changed.
export const tierKey = (u: TowerUpgrades): number => (u.a & 0xf) | ((u.b & 0xf) << 4);
