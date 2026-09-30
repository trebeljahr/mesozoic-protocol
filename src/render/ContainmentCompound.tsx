import { useMemo } from "react";
import * as THREE from "three";
import type { Outpost, Vec2 } from "../sim/types";
import { CANISTER_PALETTE } from "./biomeColors";
import { CloningCanister } from "./CloningCanister";
import {
  type ContainmentWall,
  hasMarshPerimeter,
  MARSH_WALLS,
  wallClearsRoutes,
} from "./containmentLayout";
import { OutpostClusters } from "./OutpostClusters";
import { type PlacedOutpost, SPACEKIT_MODEL_DIR } from "./outpostKit";

const noRaycast: THREE.Mesh["raycast"] = () => {};
const CONCRETE = "#807c68";
const EDGE = "#ad9b77";
const STEEL = "#283e3e";
const RUST = "#896047";

type BoxProps = { at: [number, number, number]; size: [number, number, number]; color?: string };
const Block = ({ at, size, color = CONCRETE }: BoxProps) => (
  <mesh position={at} castShadow receiveShadow raycast={noRaycast}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={0.91} />
  </mesh>
);

// A jagged end is part of the wall silhouette, rather than a decal or a
// closed gate. Its entire thickness lies inside the authored wall extent.
const ConcreteFacet = ({
  width,
  height,
  alternate,
}: {
  width: number;
  height: number;
  alternate: boolean;
}) => {
  const positions = useMemo(
    () =>
      new Float32Array(
        alternate
          ? [0.15, 0.95, 0.47, width - 0.2, height * 0.44, 0.47, width - 0.2, height - 0.15, 0.47]
          : [0.15, 0.95, 0.47, width - 0.2, height - 0.15, 0.47, 0.15, height - 0.15, 0.47],
      ),
    [width, height, alternate],
  );
  return (
    <mesh raycast={noRaycast}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} count={3} itemSize={3} />
        <bufferAttribute
          attach="attributes-normal"
          array={new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])}
          count={3}
          itemSize={3}
        />
      </bufferGeometry>
      <meshStandardMaterial
        color={alternate ? "#89836c" : "#747869"}
        roughness={1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

const BrokenPanel = ({
  length,
  height,
  flip,
}: {
  length: number;
  height: number;
  flip: boolean;
}) => {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(length, 0);
    s.lineTo(length, height);
    s.lineTo(0.3, height);
    s.lineTo(0.65, height * 0.78);
    s.lineTo(0.2, height * 0.58);
    s.lineTo(0.9, height * 0.39);
    s.lineTo(0.35, height * 0.17);
    s.closePath();
    return s;
  }, [length, height]);
  return (
    <group position={[flip ? length : 0, 0, 0]} scale={[flip ? -1 : 1, 1, 1]}>
      <mesh position={[0, 0, -0.46]} castShadow receiveShadow raycast={noRaycast}>
        <extrudeGeometry args={[shape, { depth: 0.92, bevelEnabled: false }]} />
        <meshStandardMaterial
          color={CONCRETE}
          roughness={0.96}
          flatShading
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

export const ContainmentWallRun = ({ wall }: { wall: ContainmentWall }) => {
  const length = Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y);
  const panels = Math.ceil(length / 3.4);
  const width = length / panels;
  return (
    <group
      position={[wall.from.x, 0, -wall.from.y]}
      rotation={[0, Math.atan2(wall.to.y - wall.from.y, wall.to.x - wall.from.x), 0]}
    >
      {Array.from({ length: panels }, (_, i) => {
        const broken = (i === 0 && wall.brokenStart) || (i === panels - 1 && wall.brokenEnd);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed ordered panels within one authored wall
          <group key={`${wall.id}-${i}`} position={[i * width, 0, 0]}>
            {broken ? (
              <BrokenPanel length={width} height={wall.height} flip={i !== 0} />
            ) : (
              <>
                <Block at={[width / 2, wall.height / 2, 0]} size={[width, wall.height, 0.92]} />
                <Block
                  at={[width / 2, wall.height + 0.03, 0]}
                  size={[width, 0.14, 1.08]}
                  color={EDGE}
                />
                <Block at={[width / 2, 0.45, 0]} size={[width, 0.9, 1.12]} color={STEEL} />
                <ConcreteFacet width={width} height={wall.height} alternate={i % 2 === 0} />
                <Block
                  at={[width / 2, wall.height * 0.58, 0.467]}
                  size={[width - 0.32, 0.045, 0.02]}
                  color={STEEL}
                />
              </>
            )}
            {!(i === panels - 1 && wall.brokenEnd) && (
              <>
                <Block
                  at={[width, wall.height * 0.5, 0]}
                  size={[0.38, wall.height + 0.32, 1.3]}
                  color={STEEL}
                />
                <Block at={[width, wall.height + 0.2, 0]} size={[0.44, 0.12, 1.32]} color={EDGE} />
              </>
            )}
          </group>
        );
      })}
    </group>
  );
};

// This replaces the former solar pod inside its EXISTING reserved circle.
// Low open work deck, two connected tanks and a service cabinet: no new
// closed room or fake barrier across the pilot's traversable ground.
export const ResearchDeck = ({ outpost }: { outpost: Outpost }) => {
  const scale = Math.min(1, outpost.radius / 4.12);
  const service: PlacedOutpost[] = useMemo(
    () => [
      {
        pos: { x: 0, y: 0 },
        yaw: 0,
        scale: 1,
        template: {
          id: "containment-service",
          footprint: 3.5,
          parts: [
            { model: "containers-a", dx: 1.55, dz: 0.65, scale: 0.8 },
            { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: 2.05, dz: -1.45, scale: 0.55 },
            { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: 1.3, dz: -1.55, scale: 0.38 },
          ],
        },
      },
    ],
    [],
  );
  return (
    <group position={[outpost.pos.x, 0, -outpost.pos.y]} scale={scale}>
      <Block at={[0, 0.07, 0]} size={[5.8, 0.14, 4.8]} color={STEEL} />
      <Block at={[0, 0.17, 0]} size={[5.5, 0.12, 4.5]} color={CONCRETE} />
      <Block at={[0, 0.25, 2.05]} size={[3.6, 0.14, 0.55]} color={EDGE} />
      <Block at={[-0.4, 0.42, -1.75]} size={[4.2, 0.36, 0.38]} color={RUST} />
      <Block at={[1.7, 0.78, -1.35]} size={[1.35, 1.1, 1.3]} color={STEEL} />
      <Block at={[1.7, 1.38, -1.35]} size={[1.52, 0.12, 1.48]} color={EDGE} />
      <group position={[-1.65, 0.23, -0.1]} scale={1.7}>
        <CloningCanister
          worldX={0}
          worldZ={0}
          yaw={0}
          palette={CANISTER_PALETTE.forest}
          seed={41}
        />
      </group>
      <group position={[0, 0.23, -0.6]} scale={1.5}>
        <CloningCanister
          worldX={0}
          worldZ={0}
          yaw={0.4}
          palette={CANISTER_PALETTE.forest}
          seed={47}
        />
      </group>
      <group position={[0, 0.23, 0]}>
        <OutpostClusters clusters={service} />
      </group>
    </group>
  );
};

// The same restrained service architecture fits the two existing outer
// colony reservations. Roofs sit outside the pilot rectangle; doors face the
// compound, with tanks and crates grouped on an attached apron.
const ServiceAnnex = ({ outpost }: { outpost: Outpost }) => {
  const west = outpost.pos.x < 0;
  return (
    <group position={[outpost.pos.x, 0, -outpost.pos.y]} rotation={[0, west ? Math.PI / 2 : 0, 0]}>
      <Block at={[0, 0.1, 0]} size={[6.8, 0.2, 5.2]} color={STEEL} />
      <Block at={[-0.4, 1.25, -0.8]} size={[5.7, 2.3, 3.1]} />
      <Block at={[-0.4, 2.46, -0.8]} size={[6, 0.16, 3.4]} color={EDGE} />
      <Block at={[-0.4, 2.56, -0.8]} size={[5.6, 0.08, 3.0]} color={STEEL} />
      <Block at={[-1.8, 2.9, -0.8]} size={[1.7, 0.65, 1.5]} color={RUST} />
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} at={[-2.32 + i * 0.34, 3.24, -0.8]} size={[0.14, 0.08, 1.2]} color={STEEL} />
      ))}
      <Block at={[-1.35, 1.08, 0.77]} size={[1.5, 1.85, 0.09]} color={STEEL} />
      <Block at={[-1.35, 2.06, 1.05]} size={[1.9, 0.15, 0.8]} color={RUST} />
      <Block at={[0.65, 1.55, 0.78]} size={[1.6, 0.4, 0.1]} color={STEEL} />
      <Block at={[0.65, 1.55, 0.85]} size={[1.32, 0.12, 0.035]} color="#a2c9c3" />
      <group position={[2.55, 0.22, 1.2]} scale={1.55}>
        <CloningCanister
          worldX={0}
          worldZ={0}
          yaw={0}
          palette={CANISTER_PALETTE.forest}
          seed={outpost.id + 80}
        />
      </group>
      <Block at={[-2, 0.38, 1.9]} size={[1.7, 0.55, 0.9]} color={RUST} />
    </group>
  );
};

// Rubble and angular shrubs are grouped against the damaged wall ends,
// wholly outside traversable ground and clear of the entry lane.
const BreachDebris = () => (
  <>
    {[
      [-22.3, -4.6, 1.0, 0.35],
      [-23.5, -4.2, 0.7, -0.6],
      [-22.1, -11.5, 0.95, 0.7],
      [-23.4, -12.1, 1.2, -0.3],
      [-21.7, 12.6, 0.9, 0.4],
      [-22.9, 13.1, 1.3, -0.2],
    ].map(([x, y, scale, yaw]) => (
      <group key={`${x}:${y}`} position={[x, 0, -y]} rotation={[0, yaw, 0]}>
        <mesh
          position={[0, scale * 0.42, 0]}
          scale={[scale, scale * 0.7, scale * 0.8]}
          castShadow
          receiveShadow
          raycast={noRaycast}
        >
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={CONCRETE} roughness={1} flatShading />
        </mesh>
        <mesh
          position={[-scale * 0.7, 0.35, -0.5]}
          rotation={[0.1, 0.2, 0.4]}
          castShadow
          receiveShadow
          raycast={noRaycast}
        >
          <boxGeometry args={[scale * 0.9, 0.4, 0.7]} />
          <meshStandardMaterial color={EDGE} roughness={1} />
        </mesh>
        {[-0.4, 0, 0.4].map((tilt) => (
          <mesh
            key={tilt}
            position={[0.2 + tilt, 0.48, 0.8]}
            rotation={[tilt, tilt, tilt]}
            raycast={noRaycast}
          >
            <coneGeometry args={[0.24, 1.15, 3]} />
            <meshStandardMaterial color="#475846" roughness={1} flatShading />
          </mesh>
        ))}
      </group>
    ))}
  </>
);

export const ContainmentCompound = ({
  outposts,
  paths,
}: {
  outposts: Outpost[];
  paths: Vec2[][];
}) => {
  const walls = useMemo(
    () =>
      hasMarshPerimeter(outposts) ? MARSH_WALLS.filter((w) => wallClearsRoutes(w, paths)) : [],
    [outposts, paths],
  );
  return (
    <group>
      {walls.map((wall) => (
        <ContainmentWallRun key={wall.id} wall={wall} />
      ))}
      {walls.length > 0 && <BreachDebris />}
      {outposts
        .filter((o) => !o.interior && o.pos.x < 0)
        .map((o) => (
          <ServiceAnnex key={o.id} outpost={o} />
        ))}
      {outposts
        .filter((o) => o.interior)
        .map((o) => (
          <ResearchDeck key={o.id} outpost={o} />
        ))}
    </group>
  );
};
