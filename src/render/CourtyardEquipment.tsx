import { useMemo } from "react";
import * as THREE from "three";
import type { Biome } from "../biomes";
import { CANISTER_PALETTE } from "./biomeColors";
import { CloningCanister } from "./CloningCanister";
import { DeadDinoInstancer } from "./DeadDinos";
import { type BaseCondition, baseAppearance, courtyardTanks } from "./modularBasePlan";

const noRaycast: THREE.Mesh["raycast"] = () => {};
// Open arc and jagged residual panes keep the breach visible from above.
function BrokenTank({ biome }: { biome: Biome }) {
  const palette = CANISTER_PALETTE[biome];
  return (
    <group>
      <mesh position={[0, 0.11, 0]} castShadow receiveShadow raycast={noRaycast}>
        <cylinderGeometry args={[0.36, 0.42, 0.22, 16]} />
        <meshStandardMaterial color="#353d42" metalness={0.55} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.75, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.3, 0.3, 1.08, 20, 1, true, 1.15, 3.9]} />
        <meshStandardMaterial
          color={palette.glass}
          transparent
          opacity={0.3}
          depthWrite={false}
          side={THREE.DoubleSide}
          roughness={0.35}
        />
      </mesh>
      <mesh position={[0, 0.245, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.28, 0.28, 0.04, 20]} />
        <meshStandardMaterial color={palette.fluid} roughness={0.2} />
      </mesh>
      <mesh position={[0.44, 0.12, 0.42]} rotation={[0.22, 0, -0.3]} castShadow raycast={noRaycast}>
        <cylinderGeometry args={[0.32, 0.32, 0.08, 16]} />
        <meshStandardMaterial color="#3a4247" metalness={0.5} roughness={0.8} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh
          key={i}
          position={[-0.33 + i * 0.14, 0.045, 0.46 + (i % 2) * 0.12]}
          rotation={[Math.PI / 2, 0, i * 1.8]}
          raycast={noRaycast}
        >
          <coneGeometry args={[0.09, 0.2, 3]} />
          <meshStandardMaterial color={palette.glass} metalness={0.25} roughness={0.3} />
        </mesh>
      ))}
      {[1.25, 2.4, 3.7, 4.8].map((angle, i) => (
        <mesh
          key={angle}
          position={[Math.sin(angle) * 0.29, 1.22 + (i % 2) * 0.08, Math.cos(angle) * 0.29]}
          raycast={noRaycast}
        >
          <coneGeometry args={[0.055, 0.3, 3]} />
          <meshStandardMaterial
            color={palette.glass}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function Spills({ biome, condition }: { biome: Biome; condition: BaseCondition }) {
  const count = condition === "breached" ? 5 : 2;
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed deterministic spill lobes
          key={i}
          position={[-0.65 + i * 0.27, 0.286 + i * 0.001, 1.95 + (i % 2) * 0.28]}
          rotation={[-Math.PI / 2, 0, i * 1.7]}
          scale={[1.3, 0.65, 1]}
          raycast={noRaycast}
        >
          <circleGeometry args={[condition === "breached" ? 0.65 : 0.22, 11]} />
          <meshStandardMaterial
            color={CANISTER_PALETTE[biome].fluid}
            roughness={0.16}
            metalness={0.2}
            transparent
            opacity={0.72}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      ))}
    </group>
  );
}

export function CourtyardEquipment({ biome, seed }: { biome: Biome; seed: number }) {
  const { layout, condition } = baseAppearance(seed);
  const corpses = useMemo(
    () => [
      {
        id: `courtyard-remains-${seed}`,
        pos: new THREE.Vector3(0.15, 0, 2.1),
        rotY: -0.6,
        scale: 0.45,
      },
    ],
    [seed],
  );
  return (
    <group>
      {courtyardTanks(layout).map((tank, i) => (
        <group key={tank.x} position={[tank.x, 0.43, tank.z]} scale={tank.scale}>
          {condition === "breached" && i === 0 ? (
            <BrokenTank biome={biome} />
          ) : (
            <CloningCanister
              worldX={0}
              worldZ={0}
              yaw={0}
              palette={CANISTER_PALETTE[biome]}
              seed={seed + i}
            />
          )}
        </group>
      ))}
      {condition !== "intact" && <Spills biome={biome} condition={condition} />}
      {condition === "breached" && (
        <group position={[0, 0.29, 0]}>
          <DeadDinoInstancer
            url={layout === "recovery" ? "/models/Parasaurolophus.glb" : "/models/Velociraptor.glb"}
            items={corpses}
            biome={biome}
            decorative
          />
        </group>
      )}
    </group>
  );
}
