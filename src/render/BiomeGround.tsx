import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BIOME_STYLE, type Biome, biomeForPos } from "../biomes";
import { LEVELS } from "../levels";

// Soft falloff width in world units — how quickly one level node's biome
// bleeds into neighbors. Larger = more blended; smaller = sharper biome patches.
const FALLOFF = 9;

// Half-width of the edge fade — points within this distance of the plane
// boundary smoothly blend toward the fallback sky color so the rectangular
// plane edge never reads as a hard seam at any zoom.
const EDGE_FADE = 24;

// Y-axis biome bands (sim coords), upper boundaries — must mirror
// `biomeForPos` in ../biomes. Used for the IDW fallback so the ground
// far from every level node still reads as the local biome instead of
// blowing out to bright sky.
const BAND_BOUNDARIES: { upper: number; biome: Biome }[] = [
  { upper: -9, biome: "forest" },
  { upper: -2, biome: "snow" },
  { upper: 5, biome: "desert" },
  { upper: 12, biome: "wasteland" },
  { upper: 19, biome: "lava" },
  { upper: Number.POSITIVE_INFINITY, biome: "alien" },
];

// Smoothing zone (sim units) on either side of each band boundary so the
// fallback color blends between adjacent biomes instead of stepping —
// otherwise the discrete biomeForPos thresholds show as horizontal stripes
// in the empty (no-level) corners of the map.
const BAND_BLEND = 6;

// Constant baseline weight added to the IDW totals so even a vertex with
// effectively-zero level contributions still blends smoothly toward the
// band fallback. Without it the IDW result snaps from "single-level color"
// to "band color" right at the w=0.001 cutoff, which reads as a sharp
// step at the edge of the level cluster.
const BASE_FALLBACK_WEIGHT = 0.18;

// Tiny per-vertex dither magnitude in linear color space. Breaks up the
// otherwise-coherent banding the eye picks up between neighbouring biome
// bands (especially around the bright snow strip) where 8-bit display
// quantization makes a smooth gradient read as discrete steps.
const COLOR_DITHER = 0.012;

// Deterministic hash → [0, 1). Used to seed the per-vertex dither so it
// stays stable across reloads and doesn't shimmer on re-render.
const hash01 = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// The world map is WORLD_W x WORLD_H centred at (0,0) in xy sim coords.
// Render plane lies on the xz plane (y-up), so sim.y maps to world -z.
// Default segments bumped from 160 → 280 so each band-blend zone covers
// several vertices instead of ~1 — the eye reads the underlying mesh
// triangulation as visible banding when there's only one sample per
// transition zone.
export const BiomeGround = ({
  width,
  height,
  segments = 280,
}: {
  width: number;
  height: number;
  segments?: number;
}) => {
  const geometry = useMemo(() => {
    const segX = segments;
    const segY = Math.max(16, Math.round(segments * (height / width)));
    const geom = new THREE.PlaneGeometry(width, height, segX, segY);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const acc = new THREE.Color();

    const nodes = LEVELS.map((l) => ({
      x: l.nodePos.x,
      y: l.nodePos.y,
      color: new THREE.Color(BIOME_STYLE[biomeForPos(l.nodePos)].groundColor),
    }));

    const halfW = width / 2;
    const halfH = height / 2;
    // Edge-fade target — matches the WorldMap BG so the rectangular plane
    // boundary can't read as a seam. Was the bright sky tint #b8d0e4, but
    // that bloomed when the corner of the plane was near the canvas edge.
    const sky = new THREE.Color(0.227, 0.282, 0.345); // #3a4858 — matches WorldMap BG

    // Pre-resolve each band's ground color once — referenced inside the
    // hot per-vertex loop below.
    const bandColors = BAND_BOUNDARIES.map(
      (b) => new THREE.Color(BIOME_STYLE[b.biome].groundColor),
    );
    const fallback = new THREE.Color();
    const fallbackNext = new THREE.Color();

    // Smoothstep blend of adjacent band colors as a function of sim Y, so
    // the empty corners of the map read as a continuous biome gradient.
    const computeSmoothBand = (sy: number, out: THREE.Color) => {
      let bandIdx = BAND_BOUNDARIES.length - 1;
      for (let b = 0; b < BAND_BOUNDARIES.length; b++) {
        if (sy <= BAND_BOUNDARIES[b].upper) {
          bandIdx = b;
          break;
        }
      }
      const upper = BAND_BOUNDARIES[bandIdx].upper;
      const lower = bandIdx > 0 ? BAND_BOUNDARIES[bandIdx - 1].upper : Number.NEGATIVE_INFINITY;
      const distToUpper = upper - sy;
      const distToLower = sy - lower;
      if (
        distToUpper < BAND_BLEND &&
        bandIdx + 1 < BAND_BOUNDARIES.length &&
        Number.isFinite(upper)
      ) {
        const tn = 0.5 + (sy - upper) / (2 * BAND_BLEND);
        const k = tn * tn * (3 - 2 * tn);
        fallbackNext.copy(bandColors[bandIdx + 1]);
        out.copy(bandColors[bandIdx]).lerp(fallbackNext, k);
      } else if (distToLower < BAND_BLEND && bandIdx > 0 && Number.isFinite(lower)) {
        const tn = 0.5 + (sy - lower) / (2 * BAND_BLEND);
        const k = tn * tn * (3 - 2 * tn);
        fallbackNext.copy(bandColors[bandIdx]);
        out.copy(bandColors[bandIdx - 1]).lerp(fallbackNext, k);
      } else {
        out.copy(bandColors[bandIdx]);
      }
    };

    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      // sim-space y is -z in world
      const sy = -wz;

      // Smooth biome-band fallback for this Y, used as a constant baseline
      // contribution to the IDW. Eliminates the hard discontinuity at the
      // edge of every level node's gaussian (where the previous code
      // snapped from "single-level IDW result" to "band fallback").
      computeSmoothBand(sy, fallback);

      let totalW = BASE_FALLBACK_WEIGHT;
      acc.setRGB(
        fallback.r * BASE_FALLBACK_WEIGHT,
        fallback.g * BASE_FALLBACK_WEIGHT,
        fallback.b * BASE_FALLBACK_WEIGHT,
      );
      for (const n of nodes) {
        const dx = wx - n.x;
        const dy = sy - n.y;
        const d2 = dx * dx + dy * dy;
        // gaussian-ish falloff; exp(-d2 / (2*FALLOFF^2))
        const w = Math.exp(-d2 / (2 * FALLOFF * FALLOFF));
        if (w < 0.0005) continue;
        acc.r += n.color.r * w;
        acc.g += n.color.g * w;
        acc.b += n.color.b * w;
        totalW += w;
      }
      acc.r /= totalW;
      acc.g /= totalW;
      acc.b /= totalW;

      // Edge-fade: within EDGE_FADE of the plane boundary, crossfade to
      // the BG-matched dark tone so the rectangular plane edge can never
      // read as a hard seam if it ever creeps into view.
      const edgeDistX = halfW - Math.abs(wx);
      const edgeDistZ = halfH - Math.abs(wz);
      const edgeDist = Math.min(edgeDistX, edgeDistZ);
      if (edgeDist < EDGE_FADE) {
        // Smoothstep 0..1 across the fade band.
        const t = Math.max(0, edgeDist / EDGE_FADE);
        const k = t * t * (3 - 2 * t);
        acc.r = acc.r * k + sky.r * (1 - k);
        acc.g = acc.g * k + sky.g * (1 - k);
        acc.b = acc.b * k + sky.b * (1 - k);
      }

      // Per-vertex dither — three independent ±COLOR_DITHER offsets keyed
      // off vertex position. Breaks the banding the eye picks up where
      // adjacent triangles fall on the same gradient ramp.
      const d1 = (hash01(wx * 1.7, wz * 2.3) - 0.5) * COLOR_DITHER;
      const d2 = (hash01(wx * 3.1 + 5, wz * 1.3 + 7) - 0.5) * COLOR_DITHER;
      const d3 = (hash01(wx * 2.5 + 11, wz * 3.7 + 13) - 0.5) * COLOR_DITHER;
      colors[i * 3] = Math.max(0, acc.r + d1);
      colors[i * 3 + 1] = Math.max(0, acc.g + d2);
      colors[i * 3 + 2] = Math.max(0, acc.b + d3);
    }

    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geom;
  }, [width, height, segments]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  );
};
