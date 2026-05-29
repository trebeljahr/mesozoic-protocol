import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";

const MAX_PROJECTILES = 512;

export const ProjectileMesh = () => {
  const directRef = useRef<THREE.InstancedMesh>(null);
  const splashRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const { world } = useGame.getState();
    const direct = directRef.current;
    const splash = splashRef.current;
    if (!direct || !splash) return;

    let d = 0;
    let s = 0;
    for (const p of world.projectiles) {
      if (p.kind === "splash") {
        if (s < MAX_PROJECTILES) {
          const arcH = 0.3 + Math.sin((p.pos.x + p.pos.y) * 0.1) * 0.2;
          dummy.position.set(p.pos.x, 0.6 + arcH, -p.pos.y);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          splash.setMatrixAt(s++, dummy.matrix);
        }
      } else {
        // Pulse Rifle bolts are rendered by PulseTracerFx as a cyan ribbon;
        // skip them here so we don't draw a yellow sphere on top.
        if (p.ownerTowerId !== null) {
          const owner = world.towerById.get(p.ownerTowerId);
          if (owner && owner.kind === "pulse") continue;
        }
        if (d < MAX_PROJECTILES) {
          dummy.position.set(p.pos.x, 0.8, -p.pos.y);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          direct.setMatrixAt(d++, dummy.matrix);
        }
      }
    }
    direct.count = d;
    splash.count = s;
    direct.instanceMatrix.needsUpdate = true;
    splash.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={directRef} args={[undefined, undefined, MAX_PROJECTILES]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshStandardMaterial color="#d8bf5d" roughness={0.48} metalness={0.08} />
      </instancedMesh>
      <instancedMesh ref={splashRef} args={[undefined, undefined, MAX_PROJECTILES]}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshStandardMaterial color="#c36f38" roughness={0.55} metalness={0.12} />
      </instancedMesh>
    </group>
  );
};
