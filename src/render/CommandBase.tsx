import { useMemo } from "react";
import type { Vec2 } from "../sim/types";

// One legible command building behind the existing functional defence turret.
// Local +Z faces the route. Footprint remains within the existing HQ reservation.
const Block = ({
  p,
  size,
  color = "#737b77",
  metal = 0.15,
}: {
  p: [number, number, number];
  size: [number, number, number];
  color?: string;
  metal?: number;
}) => (
  <mesh position={p} castShadow receiveShadow raycast={() => {}}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={0.76} metalness={metal} />
  </mesh>
);

export const CommandBase = ({ paths }: { paths: Vec2[][] }) => {
  const poses = useMemo(
    () =>
      paths
        .filter((p) => p.length > 1)
        .map((path) => {
          const end = path[path.length - 1],
            prev = path[path.length - 2];
          return { end, yaw: Math.atan2(prev.x - end.x, -(prev.y - end.y)) };
        }),
    [paths],
  );
  return (
    <group>
      {poses.map(({ end, yaw }) => (
        <group key={`${end.x}:${end.y}`} position={[end.x, 0, -end.y]} rotation={[0, yaw, 0]}>
          <Block p={[0, 0.1, -0.4]} size={[5.8, 0.2, 4.6]} color="#515a57" />
          <Block p={[0, 0.24, -1.35]} size={[4.9, 0.28, 2.55]} color="#999d91" />
          <Block p={[0, 1.1, -1.45]} size={[4.55, 1.6, 2.1]} color="#8c9185" />
          <Block p={[0, 1.96, -1.45]} size={[4.85, 0.19, 2.4]} color="#444f4c" />
          {/* Recessed entrance and a continuous shaded observation band. */}
          <Block p={[0, 0.88, -0.375]} size={[0.85, 1.25, 0.06]} color="#263b3a" />
          <Block p={[0, 1.62, -0.15]} size={[1.35, 0.12, 0.65]} color="#454f4a" />
          {[-1.5, 1.5].map((x) => (
            <group key={x}>
              <Block p={[x, 1.37, -0.38]} size={[1.25, 0.43, 0.07]} color="#233e40" metal={0.45} />
              <Block p={[x, 1.64, -0.28]} size={[1.48, 0.1, 0.3]} color="#56615c" />
              <Block p={[x, 0.58, -0.37]} size={[1.24, 0.06, 0.06]} color="#b08c51" />
            </group>
          ))}
          {[-2.14, -0.57, 0.57, 2.14].map((x) => (
            <Block key={x} p={[x, 1.13, -0.3]} size={[0.13, 1.53, 0.25]} color="#b3b2a0" />
          ))}
          {/* Roof service equipment, parapet and a modest communications mast. */}
          <Block p={[0, 2.1, -2.52]} size={[4.8, 0.25, 0.13]} color="#80897f" />
          {[-2.35, 2.35].map((x) => (
            <Block key={x} p={[x, 2.1, -1.45]} size={[0.13, 0.25, 2.2]} color="#80897f" />
          ))}
          <Block p={[-1.25, 2.24, -1.5]} size={[1.3, 0.35, 1.1]} color="#63706b" />
          {[-1.65, -1.45, -1.25, -1.05, -0.85].map((x) => (
            <Block key={x} p={[x, 2.425, -1.5]} size={[0.055, 0.02, 0.85]} color="#263a37" />
          ))}
          <Block p={[0.8, 2.12, -1.5]} size={[1.6, 0.1, 1.45]} color="#233d4d" metal={0.5} />
          {[0.2, 0.6, 1, 1.4].map((x) => (
            <Block key={x} p={[x, 2.18, -1.5]} size={[0.025, 0.015, 1.4]} color="#798b8c" />
          ))}
          <mesh position={[1.85, 2.75, -2.15]} castShadow raycast={() => {}}>
            <cylinderGeometry args={[0.035, 0.065, 1.5, 12]} />
            <meshStandardMaterial color="#b5b7ac" roughness={0.5} metalness={0.6} />
          </mesh>
          <Block p={[1.85, 3.35, -2.15]} size={[0.7, 0.045, 0.045]} color="#afb8af" />
          {/* The turret retains the clear apron in front of the doorway. */}
          {[-2.5, 2.5].map((x) => (
            <group key={x}>
              <Block p={[x, 0.45, 1.35]} size={[0.28, 0.8, 0.28]} color="#465653" />
              <Block p={[x, 0.86, 1.35]} size={[0.32, 0.08, 0.32]} color="#add1c5" />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
};
