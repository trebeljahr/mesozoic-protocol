import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { type Bridge, computeBridges, type FlowPalette } from "../flowGeometry";
import { PATH_WIDTH } from "../level";
import type { AuthoredLake, River, RiverMaterial, Vec2 } from "../sim/types";
import { makeWaterMaterial } from "./waterShader";

// Universal renderer for hand-painted rivers. Reads from a `rivers` prop
// (caller-supplied) so both the per-level scene (world.rivers from useGame)
// and the world map (editor store in dev, localStorage snapshot in prod)
// can use the same component. Each river becomes a flat water ribbon
// extruded along a Catmull-Rom curve through its control points.
//
// Material is the shared shader from waterShader.ts — same fresnel + ripple
// + foam + bridge-wake treatment used by FlowWater for per-level biome
// rivers — palette-themed per RiverMaterial (water/lava/toxic). The editor
// preview now matches the gameplay look instead of falling back to a flat
// meshStandardMaterial.

// Lifted slightly above the ground plane so the ribbon doesn't z-fight with
// the biome ground / placement plane. Matches the placement plane offset.
const Y_OFFSET = 0.04;

// Cross-section sample density per spline segment. Catmull-Rom needs more
// samples than control points for the curve to read smooth; 16 sub-samples
// per segment is plenty for the gentle paths an editor will draw.
const SAMPLES_PER_SEGMENT = 16;
const MIN_SAMPLES = 32;

const MATERIALS: Record<RiverMaterial, FlowPalette> = {
  water: {
    fluidColor: "#3a82c6",
    fluidEmissive: "#1a4870",
    fluidEmissiveIntensity: 0.18,
    bridgeDeck: "#5a3c20",
    bridgeTrim: "#3a2614",
  },
  lava: {
    fluidColor: "#ff6a1c",
    fluidEmissive: "#ff5010",
    fluidEmissiveIntensity: 1.6,
    bridgeDeck: "#2e1a10",
    bridgeTrim: "#7a3a1e",
  },
  toxic: {
    fluidColor: "#3ad6b0",
    fluidEmissive: "#5affc8",
    fluidEmissiveIntensity: 0.55,
    bridgeDeck: "#1f1230",
    bridgeTrim: "#4a2a70",
  },
};

// Build the ribbon geometry for a single river. Returns a BufferGeometry
// laid out as a triangle strip along the spline: two vertices per sample
// (left and right of the centerline at ±width/2). Caller disposes when
// inputs change. Returns null if the river has fewer than two points.
//
// UV convention matches the shared water shader: V = cross-ribbon (0 on the
// left bank, 1 on the right); the shader keys depth/foam on abs(V - 0.5), so
// a swapped convention pushes foam down the centerline. The shader takes its
// downstream direction from the `aFlow` attribute (world-space curve tangent)
// rather than from U, so ripple scale is identical here and in FlowWater's
// ribbon builder even though the two disagree on what U measures.
const buildRiverGeometry = (river: River): THREE.BufferGeometry | null => {
  const pts = river.points;
  if (pts.length < 2) return null;

  // Sim coords are (x, y) on a top-down plane; three.js render uses x and
  // -z (camera looks down -y). Lift to Y_OFFSET so the ribbon hovers above
  // ground but stays below scene props.
  const curvePts = pts.map((p) => new THREE.Vector3(p.x, Y_OFFSET, -p.y));
  const curve = new THREE.CatmullRomCurve3(curvePts, false, "catmullrom", 0.5);

  const segmentCount = Math.max(1, pts.length - 1);
  const sampleCount = Math.max(MIN_SAMPLES, segmentCount * SAMPLES_PER_SEGMENT);
  // getSpacedPoints returns sampleCount + 1 points evenly spaced by arc length.
  const samples = curve.getSpacedPoints(sampleCount);

  const half = Math.max(0.05, river.width * 0.5);
  const positions = new Float32Array((sampleCount + 1) * 2 * 3);
  const uvs = new Float32Array((sampleCount + 1) * 2 * 2);
  const flows = new Float32Array((sampleCount + 1) * 2 * 2);

  const up = new THREE.Vector3(0, 1, 0);
  // Tangent reused across samples to avoid allocations in the hot loop.
  const tangent = new THREE.Vector3();
  const perp = new THREE.Vector3();
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    curve.getTangentAt(t, tangent).normalize();
    // Perpendicular on the ground plane: cross(tangent, up) is horizontal
    // and orthogonal to the curve direction. Normalize for unit half-width.
    perp.copy(tangent).cross(up).normalize();
    const c = samples[i];
    const lx = c.x + perp.x * half;
    const lz = c.z + perp.z * half;
    const rx = c.x - perp.x * half;
    const rz = c.z - perp.z * half;
    const base = i * 6;
    positions[base + 0] = lx;
    positions[base + 1] = Y_OFFSET;
    positions[base + 2] = lz;
    positions[base + 3] = rx;
    positions[base + 4] = Y_OFFSET;
    positions[base + 5] = rz;
    // U = along-length flow coord, V = cross-ribbon (0 left → 1 right).
    const uBase = i * 4;
    uvs[uBase + 0] = t;
    uvs[uBase + 1] = 0;
    uvs[uBase + 2] = t;
    uvs[uBase + 3] = 1;
    // Downstream direction on the ground plane, shared by both bank vertices.
    flows[uBase + 0] = tangent.x;
    flows[uBase + 1] = tangent.z;
    flows[uBase + 2] = tangent.x;
    flows[uBase + 3] = tangent.z;
  }

  // Two triangles per segment between samples i and i+1.
  const indices = new Uint32Array(sampleCount * 6);
  for (let i = 0; i < sampleCount; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    const o = i * 6;
    indices[o + 0] = a;
    indices[o + 1] = c;
    indices[o + 2] = b;
    indices[o + 3] = b;
    indices[o + 4] = c;
    indices[o + 5] = d;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setAttribute("aFlow", new THREE.BufferAttribute(flows, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  return geom;
};

// Per-river mesh — owns its geometry so disposal is clean when the river
// changes. Shares the parent-owned shader material so all rivers of the
// same material run one uniform set (bridge wake list, time tick).
const RiverMesh = ({ river, material }: { river: River; material: THREE.ShaderMaterial }) => {
  const geom = useMemo(() => buildRiverGeometry(river), [river]);
  useEffect(() => () => geom?.dispose(), [geom]);
  // Geometry can fail when a fresh river has <2 unique points (renderer
  // bails before adding the placeholder offset). Render nothing until the
  // store catches up.
  if (!geom) return null;
  return (
    <mesh
      geometry={geom}
      material={material}
      renderOrder={1}
      receiveShadow={false}
      castShadow={false}
    />
  );
};

// One animated shader material per RiverMaterial actually in use. useFrame
// ticks uTime on every cached material so the water surface drifts at
// gameplay frame-rate.
const useRiverMaterials = (
  rivers: River[],
  lakes: AuthoredLake[],
  bridges: Bridge[],
): {
  ribbon: Map<RiverMaterial, THREE.ShaderMaterial>;
  pool: Map<RiverMaterial, THREE.ShaderMaterial>;
} => {
  // Only build materials for the river materials actually present in the
  // scene. Editor sessions often only use water; building lava+toxic up
  // front would waste a shader compile each. Ribbons and pools need separate
  // materials because the shader keys its flow direction and foam band off
  // uIsJoint — a lake has no downstream, so it ripples radially instead.
  const ribbonKinds = useMemo(() => {
    const set = new Set<RiverMaterial>();
    for (const r of rivers) set.add(r.material ?? "water");
    return Array.from(set);
  }, [rivers]);
  const poolKinds = useMemo(() => {
    const set = new Set<RiverMaterial>();
    for (const l of lakes) set.add(l.material ?? "water");
    return Array.from(set);
  }, [lakes]);

  const mats = useMemo(() => {
    const ribbon = new Map<RiverMaterial, THREE.ShaderMaterial>();
    for (const k of ribbonKinds) {
      ribbon.set(k, makeWaterMaterial(MATERIALS[k], { isJoint: false, bridges }));
    }
    const pool = new Map<RiverMaterial, THREE.ShaderMaterial>();
    for (const k of poolKinds) {
      pool.set(k, makeWaterMaterial(MATERIALS[k], { isJoint: true, bridges }));
    }
    return { ribbon, pool };
  }, [ribbonKinds, poolKinds, bridges]);

  useEffect(
    () => () => {
      mats.ribbon.forEach((mat) => {
        mat.dispose();
      });
      mats.pool.forEach((mat) => {
        mat.dispose();
      });
    },
    [mats],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    mats.ribbon.forEach((mat) => {
      mat.uniforms.uTime.value = t;
    });
    mats.pool.forEach((mat) => {
      mat.uniforms.uTime.value = t;
    });
  });

  return mats;
};

// Authored lake — a rotated ellipse disc under the shared water shader's
// "joint" variant (radial ripple + rim foam, no downstream flow). Lifted a
// hair below the river ribbons so a river feeding a lake draws on top of the
// pool rather than z-fighting with it.
const LAKE_Y_OFFSET = Y_OFFSET - 0.005;

const LakeMesh = ({ lake, material }: { lake: AuthoredLake; material: THREE.ShaderMaterial }) => (
  <mesh
    position={[lake.pos.x, LAKE_Y_OFFSET, -lake.pos.y]}
    rotation={[-Math.PI / 2, 0, lake.rot]}
    scale={[lake.rx, lake.ry, 1]}
    material={material}
    renderOrder={0}
  >
    <circleGeometry args={[1, 40]} />
  </mesh>
);

// Prod-safe — rivers are world data, not editor surface. The renderer ships
// in both per-level and world-map scenes. Tree-shaking is driven by whether
// the component is referenced at all; when rivers === [] the subtree is a
// single guard return, so the render cost is negligible at boot.
//
// Bridge rendering moved to <AutoBridges/> which reads world.autoBridges,
// a list resolved by the editor's bridgeResolver on every commit. The
// per-render computeBridges call is kept here as a *fallback* for legacy
// blobs that pre-date the persistence migration: when the caller has
// rivers and paths but no resolved autoBridges yet, we emit one batch of
// bridges so the level still reads as bridged until the next editor
// commit writes the persisted version.
export const Rivers = ({
  rivers,
  lakes = [],
  paths = [],
  autoBridges = [],
}: {
  rivers: River[];
  // Authored lakes render alongside the ribbons — same palette, same shader,
  // one closed pool per entry. Optional so callers that predate the lake
  // tool keep compiling.
  lakes?: AuthoredLake[];
  paths?: Vec2[][];
  autoBridges?: { length: number };
}) => {
  const showFallback = autoBridges.length === 0 && paths.length > 0;
  const fallbackBridges = useMemo(
    () => (showFallback ? computeBridges(paths, rivers) : []),
    [showFallback, paths, rivers],
  );
  const bridges = fallbackBridges;
  const materials = useRiverMaterials(rivers, lakes, bridges);
  if (rivers.length === 0 && lakes.length === 0) return null;
  const bridgeWidth = PATH_WIDTH + 0.4;
  // Index every river by id so the fallback bridge palette can pick the
  // matching deck colour instead of hard-coding the water palette. Two
  // rivers can feed the same crossing — the first match wins (deterministic
  // per render since rivers are iterated in array order).
  const paletteForBridge = (b: { pos: { x: number; y: number } }): FlowPalette => {
    // Use the first river whose polyline passes near the bridge centre.
    // Same per-segment scan as isOnRiver but cheaper for the small bridge
    // list — typical maps have 0–4 bridges. Falls back to water.
    for (const r of rivers) {
      const half = r.width / 2 + 0.5;
      const r2 = half * half;
      const pts = r.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i].x;
        const ay = pts[i].y;
        const bx = pts[i + 1].x;
        const by = pts[i + 1].y;
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((b.pos.x - ax) * dx + (b.pos.y - ay) * dy) / lenSq));
        const px = ax + dx * t - b.pos.x;
        const py = ay + dy * t - b.pos.y;
        if (px * px + py * py < r2) return MATERIALS[r.material ?? "water"];
      }
    }
    return MATERIALS.water;
  };
  return (
    <group>
      {lakes.map((l) => {
        const mat = materials.pool.get(l.material ?? "water");
        if (!mat) return null;
        return <LakeMesh key={l.id} lake={l} material={mat} />;
      })}
      {rivers.map((r) => {
        const mat = materials.ribbon.get(r.material ?? "water");
        if (!mat) return null;
        return <RiverMesh key={r.id} river={r} material={mat} />;
      })}
      {fallbackBridges.map((b, i) => {
        const palette = paletteForBridge(b);
        return b.kind === "plaza" ? (
          <group
            // biome-ignore lint/suspicious/noArrayIndexKey: computed bridge list has no stable id
            key={`bridge:${i}`}
            position={[b.pos.x, 0.08, -b.pos.y]}
          >
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[b.radius, b.radius, 0.18, 28]} />
              <meshStandardMaterial color={palette.bridgeDeck} roughness={1} />
            </mesh>
            <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <torusGeometry args={[b.radius - 0.05, 0.06, 8, 28]} />
              <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
            </mesh>
          </group>
        ) : (
          <group
            // biome-ignore lint/suspicious/noArrayIndexKey: computed bridge list has no stable id
            key={`bridge:${i}`}
            position={[b.pos.x, 0.08, -b.pos.y]}
            rotation={[0, -b.rotY, 0]}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[b.length, 0.18, bridgeWidth]} />
              <meshStandardMaterial color={palette.bridgeDeck} roughness={1} />
            </mesh>
            <mesh position={[0, 0.18, bridgeWidth / 2 - 0.06]} castShadow>
              <boxGeometry args={[b.length, 0.22, 0.12]} />
              <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
            </mesh>
            <mesh position={[0, 0.18, -(bridgeWidth / 2 - 0.06)]} castShadow>
              <boxGeometry args={[b.length, 0.22, 0.12]} />
              <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};
