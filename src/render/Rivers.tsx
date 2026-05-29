import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { computeBridges, type FlowPalette } from "../flowGeometry";
import { PATH_WIDTH } from "../level";
import type { River, RiverMaterial, Vec2 } from "../sim/types";

// Universal renderer for hand-painted rivers. Reads from a `rivers` prop
// (caller-supplied) so both the per-level scene (world.rivers from useGame)
// and the world map (editor store in dev, localStorage snapshot in prod)
// can use the same component. Each river becomes a flat water ribbon
// extruded along a Catmull-Rom curve through its control points.
//
// Not dev-gated — rivers are part of the world data and ship in production
// once authored. The editor that *creates* them is dev-only (src/editor),
// but the visuals belong to the universal scene.

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
    // U runs across the ribbon (0 left → 1 right), V along its length.
    const uBase = i * 4;
    uvs[uBase + 0] = 0;
    uvs[uBase + 1] = t;
    uvs[uBase + 2] = 1;
    uvs[uBase + 3] = t;
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
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  return geom;
};

// Per-river mesh — owns its geometry + material so disposal is clean when
// the river changes. Keyed on river.id by the parent so React unmounts on
// delete.
const RiverMesh = ({ river }: { river: River }) => {
  const geom = useMemo(() => buildRiverGeometry(river), [river]);
  useEffect(() => () => geom?.dispose(), [geom]);
  // Geometry can fail when a fresh river has <2 unique points (renderer
  // bails before adding the placeholder offset). Render nothing until the
  // store catches up.
  if (!geom) return null;
  return (
    <mesh geometry={geom} renderOrder={1} receiveShadow={false} castShadow={false}>
      <meshStandardMaterial
        color={river.color ?? MATERIALS[river.material ?? "water"].fluidColor}
        emissive={MATERIALS[river.material ?? "water"].fluidEmissive}
        emissiveIntensity={MATERIALS[river.material ?? "water"].fluidEmissiveIntensity}
        roughness={0.3}
        metalness={0.05}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
};

// Prod-safe — rivers are world data, not editor surface. The renderer ships
// in both per-level and world-map scenes. Tree-shaking is driven by whether
// the component is referenced at all; when rivers === [] the subtree is a
// single guard return, so the render cost is negligible at boot.
export const Rivers = ({ rivers, paths = [] }: { rivers: River[]; paths?: Vec2[][] }) => {
  if (rivers.length === 0) return null;
  const bridges = paths.length > 0 ? computeBridges(paths, rivers) : [];
  const bridgeWidth = PATH_WIDTH + 0.4;
  return (
    <group>
      {rivers.map((r) => (
        <RiverMesh key={r.id} river={r} />
      ))}
      {bridges.map((b, i) =>
        b.kind === "plaza" ? (
          <group
            // biome-ignore lint/suspicious/noArrayIndexKey: computed bridge list has no stable id
            key={`bridge:${i}`}
            position={[b.pos.x, 0.08, -b.pos.y]}
          >
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[b.radius, b.radius, 0.18, 28]} />
              <meshStandardMaterial color={MATERIALS.water.bridgeDeck} roughness={1} />
            </mesh>
            <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <torusGeometry args={[b.radius - 0.05, 0.06, 8, 28]} />
              <meshStandardMaterial color={MATERIALS.water.bridgeTrim} roughness={1} />
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
              <meshStandardMaterial color={MATERIALS.water.bridgeDeck} roughness={1} />
            </mesh>
            <mesh position={[0, 0.18, bridgeWidth / 2 - 0.06]} castShadow>
              <boxGeometry args={[b.length, 0.22, 0.12]} />
              <meshStandardMaterial color={MATERIALS.water.bridgeTrim} roughness={1} />
            </mesh>
            <mesh position={[0, 0.18, -(bridgeWidth / 2 - 0.06)]} castShadow>
              <boxGeometry args={[b.length, 0.22, 0.12]} />
              <meshStandardMaterial color={MATERIALS.water.bridgeTrim} roughness={1} />
            </mesh>
          </group>
        ),
      )}
    </group>
  );
};
