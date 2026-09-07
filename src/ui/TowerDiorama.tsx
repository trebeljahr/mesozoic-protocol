import { useGLTF } from "@react-three/drei";
import { TOWER_FINISH } from "../render/towerTints";
import type { TowerKind } from "../sim/types";
import { Diorama, StaticModel } from "./Diorama";

// Mirrors ModelTowerMesh's per-tower scaling in Scene.tsx so the
// compendium diorama reads at the same proportions players see on the
// map. Mortar gets a 90° yaw because Missile Turret's barrel is authored
// pointing along +X — the game world rotates it to face combat, the
// diorama just rotates it once at load so the silhouette feels right.
const TOWER_DIORAMA: Record<TowerKind, { url: string; targetSize: number; rotY: number }> = {
  pulse: { url: "/models/tower_pulse.glb", targetSize: 1.6, rotY: 0 },
  chain: { url: "/models/turrets/Lighting Turret.glb", targetSize: 1.8, rotY: 0 },
  mortar: { url: "/models/turrets/Missile Turret.glb", targetSize: 1.8, rotY: Math.PI / 2 },
  cryo: { url: "/models/turrets/Emp Turret.glb", targetSize: 1.55, rotY: 0 },
  flame: { url: "/models/turrets/Flamethrower Turret.glb", targetSize: 1.7, rotY: 0 },
  hive: { url: "/models/turrets/Hive Turret.glb", targetSize: 1.8, rotY: 0 },
};

useGLTF.preload("/models/tower_pulse.glb");
useGLTF.preload("/models/turrets/Lighting Turret.glb");
useGLTF.preload("/models/turrets/Missile Turret.glb");
useGLTF.preload("/models/turrets/Emp Turret.glb");
useGLTF.preload("/models/turrets/Flamethrower Turret.glb");
useGLTF.preload("/models/turrets/Hive Turret.glb");

export const TowerDiorama = ({ kind, size = 360 }: { kind: TowerKind; size?: number }) => {
  const cfg = TOWER_DIORAMA[kind];
  const span = cfg.targetSize + 0.4;
  return (
    <Diorama span={span} size={size}>
      <StaticModel
        url={cfg.url}
        targetSize={cfg.targetSize}
        rotY={cfg.rotY}
        finish={TOWER_FINISH[kind]}
      />
    </Diorama>
  );
};
