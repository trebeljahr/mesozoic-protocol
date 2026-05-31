import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BIOME_LAYERS, type Biome } from "../biomes";
import { useEditor } from "../editor/editorStore";
import type { Rock } from "../sim/types";
import { meshXZRadii, ROCK_REMOVE_COST } from "../sim/world";
import { useGame } from "../store";
import { collectMeshSource } from "./meshSource";

const rockUrl = (biome: Biome, rock: Rock): string | undefined =>
  BIOME_LAYERS[biome][rock.layerIndex]?.urls[rock.variant];

const rockEffectiveRadius = (biome: Biome, rock: Rock): number => {
  const url = rockUrl(biome, rock);
  const base = url ? (meshXZRadii.get(url) ?? 0.7) : 0.7;
  return base * rock.scale;
};

// Pointer events go to the hit discs, not the model silhouette.
const neverRaycast: THREE.Mesh["raycast"] = () => {};

const RockGroup = ({
  url,
  rocks,
  normalizeTo,
}: {
  url: string;
  rocks: Rock[];
  normalizeTo?: number;
}) => {
  const { scene } = useGLTF(url);
  const source = useMemo(() => collectMeshSource(scene), [scene]);
  // When the layer opts into size normalization, divide the target world size
  // by the measured maxDim so every variant renders at ~normalizeTo before the
  // per-instance scale band. The same factor scales the published radius so
  // hit discs + canPlaceAt blocking stay matched to the rendered silhouette.
  const baseScale = source && normalizeTo ? normalizeTo / source.maxDim : 1;
  // Floor a measured zero (degenerate geometry) so hit discs and placement
  // blocking get a usable radius instead of a point.
  const xzRadius = (source ? source.xzRadius || 0.7 : 0.7) * baseScale;
  useEffect(() => {
    if (source) meshXZRadii.set(url, xzRadius);
  }, [source, url, xzRadius]);

  const partRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  useEffect(() => {
    if (!source) return;
    const dummy = new THREE.Object3D();
    for (const im of partRefs.current) {
      if (!im) continue;
      for (let i = 0; i < rocks.length; i++) {
        const r = rocks[i];
        const s = baseScale * r.scale;
        dummy.position.set(r.pos.x, -source.minY * s, -r.pos.y);
        dummy.rotation.set(0, r.rot, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.count = rocks.length;
      im.instanceMatrix.needsUpdate = true;
    }
  }, [rocks, source, baseScale]);

  if (!source || rocks.length === 0) return null;

  return (
    <group>
      {source.parts.map((part, pi) => (
        <instancedMesh
          // biome-ignore lint/suspicious/noArrayIndexKey: parts array is stable per scene
          key={pi}
          ref={(el: THREE.InstancedMesh | null) => {
            partRefs.current[pi] = el;
          }}
          args={[part.geom, part.material, rocks.length]}
          castShadow
          receiveShadow
          raycast={neverRaycast}
          // Positions are baked into per-instance matrices, so the default
          // origin-centered bounding sphere fails the frustum test once the
          // player zooms in and pans away from origin — culling the whole
          // batch and making every rock vanish. Disable per-batch culling.
          frustumCulled={false}
        />
      ))}
    </group>
  );
};

export const Rocks = () => {
  const biome = useGame((s) => s.world.biome);
  const rocks = useGame((s) => s.world.rocks);
  const status = useGame((s) => s.ui.status);
  const gold = useGame((s) => s.ui.gold);
  const selectedRockId = useGame((s) => s.selectedRockId);
  const selectedTreeId = useGame((s) => s.selectedTreeId);
  const selectedKind = useGame((s) => s.selectedKind);
  const selectedTowerId = useGame((s) => s.world.selectedTowerId);
  const selectedBase = useGame((s) => s.world.selectedBase);
  const robotSelected = useGame((s) => s.world.robot.selected);
  const inspectedEnemyId = useGame((s) => s.inspectedEnemy.id);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  useEffect(() => {
    if (hoveredId !== null && !rocks.some((r) => r.id === hoveredId)) setHoveredId(null);
  }, [rocks, hoveredId]);

  useEffect(() => {
    if (hoveredId === null) return;
    const externalSelectionActive =
      selectedKind !== null ||
      selectedTowerId !== null ||
      selectedTreeId !== null ||
      selectedBase ||
      robotSelected ||
      inspectedEnemyId !== null ||
      (selectedRockId !== null && selectedRockId !== hoveredId);
    if (externalSelectionActive) setHoveredId(null);
  }, [
    hoveredId,
    inspectedEnemyId,
    selectedBase,
    selectedKind,
    selectedRockId,
    selectedTowerId,
    selectedTreeId,
    robotSelected,
  ]);

  const running = status === "running";
  const hovered = hoveredId !== null ? (rocks.find((r) => r.id === hoveredId) ?? null) : null;
  const selected =
    selectedRockId !== null ? (rocks.find((r) => r.id === selectedRockId) ?? null) : null;
  const canAfford = gold >= ROCK_REMOVE_COST;

  useEffect(() => {
    if (hovered && running) {
      const prev = document.body.style.cursor;
      document.body.style.cursor = "pointer";
      return () => {
        document.body.style.cursor = prev;
      };
    }
  }, [hovered, running]);

  const buckets = useMemo(() => {
    const layers = BIOME_LAYERS[biome];
    const out = new Map<string, Rock[]>();
    for (const r of rocks) {
      const spec = layers[r.layerIndex];
      if (!spec) continue;
      const url = spec.urls[r.variant];
      if (!url) continue;
      const list = out.get(url) ?? [];
      list.push(r);
      out.set(url, list);
    }
    return Array.from(out.entries());
  }, [biome, rocks]);

  return (
    <group>
      {buckets.map(([url, group]) => (
        <RockGroup
          key={url}
          url={url}
          rocks={group}
          normalizeTo={BIOME_LAYERS[biome][group[0].layerIndex]?.normalizeTo}
        />
      ))}

      <RockHitTargets
        rocks={rocks}
        biome={biome}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
      />

      {running && hovered && hovered.id !== selectedRockId && (
        <RockRing
          pos={hovered.pos}
          radius={rockEffectiveRadius(biome, hovered)}
          color={canAfford ? "#ff8a5a" : "#6a6a6a"}
          thickness={0.22}
          y={0.02}
          opacity={0.9}
        />
      )}
      {running && selected && (
        <RockRing
          pos={selected.pos}
          radius={rockEffectiveRadius(biome, selected) + 0.08}
          color="#ffd66a"
          thickness={0.28}
          y={0.03}
          opacity={0.95}
        />
      )}
    </group>
  );
};

type Vec2 = { x: number; y: number };

// depthTest:false so the ring stays visible even when the rock body
// occludes the ground disc from above.
const RockRing = ({
  pos,
  radius,
  thickness,
  color,
  y,
  opacity,
}: {
  pos: Vec2;
  radius: number;
  thickness: number;
  color: string;
  y: number;
  opacity: number;
}) => (
  <group position={[pos.x, y, -pos.y]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
      <ringGeometry args={[radius - thickness, radius, 40]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  </group>
);

const RockHitTargets = ({
  rocks,
  biome,
  hoveredId,
  setHoveredId,
}: {
  rocks: Rock[];
  biome: Biome;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}) => {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const geom = useMemo(() => new THREE.CircleGeometry(1, 24), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  useEffect(
    () => () => {
      geom.dispose();
      material.dispose();
    },
    [geom, material],
  );

  useEffect(() => {
    const im = ref.current;
    if (!im) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i];
      dummy.position.set(r.pos.x, 0.015, -r.pos.y);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(rockEffectiveRadius(biome, r));
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.count = rocks.length;
    im.instanceMatrix.needsUpdate = true;
  }, [rocks, biome]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null) return;
    const rock = rocks[e.instanceId];
    if (!rock) return;
    e.stopPropagation();
    if (useEditor.getState().active) return;
    useGame.getState().selectRock(rock.id);
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null) return;
    const rock = rocks[e.instanceId];
    if (!rock) return;
    // Consume so the tree hit-disc (same y-level) doesn't also fire
    // its onPointerMove and double-highlight at the overlap. R3F
    // dispatches closest-first, so the front rock wins.
    e.stopPropagation();
    if (hoveredId !== rock.id) setHoveredId(rock.id);
  };

  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (hoveredId !== null && rocks.some((r) => r.id === hoveredId)) setHoveredId(null);
  };

  if (rocks.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[geom, material, rocks.length]}
      onClick={onClick}
      onPointerMove={onMove}
      onPointerOut={onOut}
    />
  );
};
