import { nanoid } from "nanoid";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BIOME_STYLE } from "../biomes";
import { PATH_WIDTH } from "../level";
import type { Vec2 } from "../sim/types";
import { useGame } from "../store";

export const PathLine = () => {
  const paths = useGame((s) => s.world.paths);
  const biome = useGame((s) => s.world.biome);
  const pathDebug = useGame((s) => s.pathDebug);
  const terrainPath = useGame((s) => s.world.levelId === 4 && !s.world.overrideActive);
  const style = BIOME_STYLE[biome];
  const pathsWithIds = useMemo(
    () =>
      paths.map((path) => ({
        id: nanoid(),
        path,
        renderPath: path,
      })),
    [paths],
  );

  // Outline color: the path color darkened so the rim reads as a sunken
  // border without clashing with the biome palette.
  const outlineColor = useMemo(() => {
    const c = new THREE.Color(style.pathColor);
    c.multiplyScalar(0.55);
    return `#${c.getHexString()}`;
  }, [style.pathColor]);

  // Two-pass render so overlapping paths merge cleanly:
  //   1. Outlines first (wider ribbon, dark color, lower Y).
  //   2. Inner fills after (PATH_WIDTH ribbon, path color, higher Y).
  // Any inner fill covers any outline it crosses, so only the union's
  // outer perimeter ends up showing the rim. Both layers share their Y
  // across all paths, so same-color z-fighting is invisible.
  return (
    <group>
      <group>
        {!terrainPath &&
          pathsWithIds.map(({ id, renderPath }) => (
            <PathOutline key={`out-${id}`} path={renderPath} color={outlineColor} />
          ))}
      </group>
      <group>
        {pathsWithIds.map(({ id, path, renderPath }) => (
          <PathInner
            key={`in-${id}`}
            path={renderPath}
            ringPos={path[0]}
            terrainPath={terrainPath}
            pathColor={style.pathColor}
            startColor={style.startRing}
          />
        ))}
      </group>
      {pathDebug &&
        pathsWithIds.map(({ id, path }, idx) => (
          <PathDebugOverlay key={`dbg-${id}`} path={path} pathIndex={idx} />
        ))}
    </group>
  );
};

// Debug overlay — renders the raw waypoint polyline + numbered waypoint
// markers + a centerline through the smoothed render so the source-of-
// truth shape (used by enemy traversal) is visible alongside the visual
// path. Only mounts when `pathDebug` is on; gated by isDebug at the
// store level so production builds dead-code the toggle.
const PathDebugOverlay = ({ path, pathIndex }: { path: Vec2[]; pathIndex: number }) => {
  const segments = useMemo(() => {
    const out: { id: string; pos: [number, number, number]; rotY: number; length: number }[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const midX = (a.x + b.x) / 2;
      const midZ = -(a.y + b.y) / 2;
      const rotY = Math.atan2(-(b.y - a.y), b.x - a.x);
      out.push({ id: nanoid(), pos: [midX, 0.18, midZ], rotY, length });
    }
    return out;
  }, [path]);

  // Distinct color per pathIndex so multi-path levels are easy to read.
  const debugColor = pathIndex % 2 === 0 ? "#ff3aff" : "#3affff";

  return (
    <group>
      {segments.map((s) => (
        <mesh key={s.id} position={s.pos} rotation={[-Math.PI / 2, 0, -s.rotY]}>
          <planeGeometry args={[s.length, 0.08]} />
          <meshBasicMaterial color={debugColor} transparent opacity={0.9} />
        </mesh>
      ))}
      {path.map((p) => (
        <group
          key={`wp-${pathIndex}-${p.x.toFixed(3)}-${p.y.toFixed(3)}`}
          position={[p.x, 0.2, -p.y]}
        >
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.15, 0.3, 16]} />
            <meshBasicMaterial
              color={debugColor}
              transparent
              opacity={0.95}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.1, 12]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// Build a ribbon (triangle strip) mesh that runs along the path centerline
// with constant perpendicular width. Corners use a bisector miter so the
// edges meet cleanly without overlapping decals or visible seams. `path`
// is the same smoothed polyline the sim walks (smoothPath in sim/path.ts
// runs once at createWorld), so anything within ±width/2 of the centerline
// is guaranteed to render inside the visible ribbon.
const buildRibbonGeometry = (path: Vec2[], width: number, y: number): THREE.BufferGeometry => {
  const n = path.length;
  const half = width / 2;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];
  // Cap the miter offset so an acute angle doesn't shoot a spike outward.
  // The smoothed polyline keeps inter-segment angles small, so this only
  // ever bites at the original waypoints near tight turns.
  const MAX_MITER_RATIO = 2.4;

  // Cumulative arc length normalises U across segments — kept on the
  // geometry so a future material can sample a texture along the ribbon
  // without re-walking the path.
  let cumLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    segLens.push(Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y));
  }
  const total = segLens.reduce((a, b) => a + b, 1e-6);

  const Y = y;

  for (let i = 0; i < n; i++) {
    const p = path[i];

    // Outgoing segment normal (perpendicular, left-of-direction).
    let n1x = 0;
    let n1y = 0;
    if (i < n - 1) {
      const dx = path[i + 1].x - path[i].x;
      const dy = path[i + 1].y - path[i].y;
      const l = Math.hypot(dx, dy) || 1;
      n1x = -dy / l;
      n1y = dx / l;
    }
    // Incoming segment normal.
    let n0x = 0;
    let n0y = 0;
    if (i > 0) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      const l = Math.hypot(dx, dy) || 1;
      n0x = -dy / l;
      n0y = dx / l;
    }

    let nx: number;
    let ny: number;
    let scale = 1;
    if (i === 0) {
      nx = n1x;
      ny = n1y;
    } else if (i === n - 1) {
      nx = n0x;
      ny = n0y;
    } else {
      // Average normals → bisector. cos(theta/2) = dot(bisector, n0).
      let bx = n0x + n1x;
      let by = n0y + n1y;
      const bl = Math.hypot(bx, by);
      if (bl < 1e-4) {
        // Near 180° turn-around — fall back to incoming normal.
        nx = n0x;
        ny = n0y;
      } else {
        bx /= bl;
        by /= bl;
        const cosHalf = Math.max(0.001, bx * n0x + by * n0y);
        scale = Math.min(MAX_MITER_RATIO, 1 / cosHalf);
        nx = bx;
        ny = by;
      }
    }

    const offX = nx * half * scale;
    const offY = ny * half * scale;

    // Left vertex (positive normal), right vertex (negative normal).
    // Convert sim Y → render Z with the standard `-y` mapping used
    // everywhere else in the renderer.
    const li = i * 6;
    positions[li + 0] = p.x + offX;
    positions[li + 1] = Y;
    positions[li + 2] = -(p.y + offY);
    positions[li + 3] = p.x - offX;
    positions[li + 4] = Y;
    positions[li + 5] = -(p.y - offY);

    // U runs along the path (cumulative length / total); V is 0 on the
    // left edge, 1 on the right.
    const u = cumLen / total;
    uvs[i * 4 + 0] = u;
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = u;
    uvs[i * 4 + 3] = 1;
    if (i < n - 1) cumLen += segLens[i];
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    // CCW when viewed from +Y (above) so the front face points up.
    indices.push(a, b, c, b, d, c);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
};

// Y planes: outline sits just below the inner fill so the depth test
// reliably hides any outline crossed by another path's fill. Both planes
// are shared across all paths — same color overlaps never z-fight visibly.
const PATH_Y_OUTLINE = 0.019;
const PATH_Y_INNER = 0.021;

// Outline ring beyond the walking ribbon. Tuned to read at the gameplay
// camera angle without making the path look like a bordered tile.
const PATH_OUTLINE_THICKNESS = 0.22;

const PathOutline = ({ path, color }: { path: Vec2[]; color: string }) => {
  const geometry = useMemo(
    () => buildRibbonGeometry(path, PATH_WIDTH + 2 * PATH_OUTLINE_THICKNESS, PATH_Y_OUTLINE),
    [path],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (path.length < 2) return null;
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
};

const PathInner = ({
  path,
  ringPos,
  pathColor,
  startColor,
  terrainPath,
}: {
  path: Vec2[];
  ringPos: Vec2;
  pathColor: string;
  startColor: string;
  terrainPath: boolean;
}) => {
  const geometry = useMemo(() => buildRibbonGeometry(path, PATH_WIDTH, PATH_Y_INNER), [path]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (path.length < 2) return null;
  return (
    <group>
      {!terrainPath && (
        <mesh geometry={geometry} receiveShadow>
          <meshStandardMaterial color={pathColor} roughness={1} />
        </mesh>
      )}
      <mesh position={[ringPos.x, 0.04, -ringPos.y]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 1.0, 24]} />
        <meshBasicMaterial color={startColor} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};
