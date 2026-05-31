import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Bridge, FlowPalette } from "../flowGeometry";
import type { Vec2 } from "../sim/types";
import { makeWaterMaterial } from "./waterShader";

// Forest biome's per-level flow renderer. Builds miter-jointed ribbon
// geometry along each river polyline and reuses the shared waterShader for
// the fluid surface so editor preview (Rivers.tsx) and gameplay share one
// look. Palette is passed in so a future biome could swap colours without
// touching the shader source.

export const ForestWaterGroup = ({
  palette,
  rivers,
  lakes,
  bridges,
}: {
  palette: FlowPalette;
  rivers: { id: string; points: Vec2[]; width: number }[];
  lakes: { id: string; x: number; y: number; rx: number; ry: number; rot: number }[];
  bridges: Bridge[];
}) => {
  const { segMat, jointMat } = useMemo(
    () => ({
      segMat: makeWaterMaterial(palette, { isJoint: false, bridges }),
      jointMat: makeWaterMaterial(palette, { isJoint: true, bridges }),
    }),
    [palette, bridges],
  );

  useEffect(
    () => () => {
      segMat.dispose();
      jointMat.dispose();
    },
    [segMat, jointMat],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    segMat.uniforms.uTime.value = t;
    jointMat.uniforms.uTime.value = t;
  });

  return (
    <group>
      {rivers.map((river) => (
        <RiverSegments key={river.id} points={river.points} width={river.width} segMat={segMat} />
      ))}
      {lakes.map((l) => (
        <mesh
          key={l.id}
          position={[l.x, 0.014, -l.y]}
          rotation={[-Math.PI / 2, 0, l.rot]}
          scale={[l.rx, l.ry, 1]}
          material={jointMat}
        >
          <circleGeometry args={[1, 28]} />
        </mesh>
      ))}
    </group>
  );
};

// Build a single continuous ribbon mesh that follows the river path with
// miter joints at every interior point. Replaces the previous segments +
// circle-joint composition, which left circular halos at every path point
// and triangular gaps on the outside of sharp bends where the circle-disc
// rim didn't reach the segment endcap corners.
const RiverSegments = ({
  points,
  width,
  segMat,
}: {
  points: Vec2[];
  width: number;
  segMat: THREE.ShaderMaterial;
}) => {
  const geometry = useMemo(() => {
    const n = points.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const halfW = width / 2;
    let cum = 0;

    for (let i = 0; i < n; i++) {
      const p = points[i];

      // Miter direction at this vertex — perpendicular to flow, scaled so the
      // resulting bank line ties smoothly into the adjacent segments.
      let nx: number;
      let ny: number;
      let scale = 1;

      if (i === 0) {
        const b = points[1];
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const l = Math.hypot(dx, dy) || 1;
        nx = -dy / l;
        ny = dx / l;
      } else if (i === n - 1) {
        const a = points[i - 1];
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        nx = -dy / l;
        ny = dx / l;
      } else {
        const a = points[i - 1];
        const b = points[i + 1];
        const d1x = p.x - a.x;
        const d1y = p.y - a.y;
        const l1 = Math.hypot(d1x, d1y) || 1;
        const p1x = -d1y / l1;
        const p1y = d1x / l1;
        const d2x = b.x - p.x;
        const d2y = b.y - p.y;
        const l2 = Math.hypot(d2x, d2y) || 1;
        const p2x = -d2y / l2;
        const p2y = d2x / l2;
        let bx = p1x + p2x;
        let by = p1y + p2y;
        const bl = Math.hypot(bx, by);
        if (bl < 1e-4) {
          // Near-180° turn — bisector degenerates; fall back to one perp.
          nx = p1x;
          ny = p1y;
        } else {
          bx /= bl;
          by /= bl;
          // Miter scale = 1 / cos(half-bend); clamped so an acute bend
          // doesn't shoot the bank vertex out into the trees.
          const cosHalf = bx * p1x + by * p1y;
          scale = Math.min(2.5, 1 / Math.max(0.2, cosHalf));
          nx = bx;
          ny = by;
        }
      }

      const ox = nx * halfW * scale;
      const oy = ny * halfW * scale;

      if (i > 0) {
        const prev = points[i - 1];
        cum += Math.hypot(p.x - prev.x, p.y - prev.y);
      }

      const v0 = positions.length / 3;
      positions.push(p.x + ox, 0.012, -(p.y + oy));
      positions.push(p.x - ox, 0.012, -(p.y - oy));
      uvs.push(cum, 0);
      uvs.push(cum, 1);

      if (i > 0) {
        // Winding chosen so the mesh's normal is +Y (camera looks straight down,
        // so the +Y face is the front and we don't get back-face-culled).
        const vp = v0 - 2;
        indices.push(vp, v0 + 1, v0);
        indices.push(vp, vp + 1, v0 + 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [points, width]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh material={segMat}>
      <primitive object={geometry} attach="geometry" />
    </mesh>
  );
};
