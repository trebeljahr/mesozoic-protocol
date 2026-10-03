import { useGame } from "../store";

/** World-space cue; never consumes a pointer hit intended for the real field. */
export const TutorialMarker = () => {
  const marker = useGame((s) => s.tutorial?.marker);
  if (!marker) return null;
  return (
    <group position={[marker.x, 0.15, -marker.y]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.8, 1.04, 48]} />
        <meshBasicMaterial
          color="#ffc66b"
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[1.18, 1.22, 48]} />
        <meshBasicMaterial
          color="#ffc66b"
          transparent
          opacity={0.55}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
