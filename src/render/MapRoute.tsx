import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { LEVELS } from "../levels";
import { isLevelUnlocked } from "../progress";
import { useGame } from "../store";

export const MapRoute = () => {
  const progress = useGame((s) => s.progress);

  type Seg = { id: number; outline: THREE.Vector3[]; fill: THREE.Vector3[] };
  const { reachedSegments, lockedSegments } = useMemo(() => {
    const reached: Seg[] = [];
    const locked: Seg[] = [];

    for (let i = 0; i < LEVELS.length - 1; i++) {
      const a = LEVELS[i];
      const b = LEVELS[i + 1];
      const bothUnlocked = isLevelUnlocked(a.id, progress) && isLevelUnlocked(b.id, progress);
      const yOutline = 0.02;
      const yFill = 0.025;
      const from = new THREE.Vector3(a.nodePos.x, 0, -a.nodePos.y);
      const to = new THREE.Vector3(b.nodePos.x, 0, -b.nodePos.y);
      const delta = to.clone().sub(from);
      const bend = new THREE.Vector3(-delta.z, 0, delta.x)
        .normalize()
        .multiplyScalar(Math.min(1.1, delta.length() * 0.1) * (i % 2 ? 1 : -1));
      const curve = new THREE.QuadraticBezierCurve3(
        from,
        from.clone().lerp(to, 0.5).add(bend),
        to,
      ).getPoints(24);
      const outline = curve.map((p) => new THREE.Vector3(p.x, yOutline, p.z));
      const fill = curve.map((p) => new THREE.Vector3(p.x, yFill, p.z));
      if (bothUnlocked) {
        reached.push({ id: a.id, outline, fill });
      } else {
        locked.push({ id: a.id, outline, fill });
      }
    }

    return { reachedSegments: reached, lockedSegments: locked };
  }, [progress]);

  return (
    <group>
      {reachedSegments.map((seg) => (
        <group key={seg.id}>
          <Line
            points={seg.outline}
            color="#302b24"
            lineWidth={5}
            transparent
            opacity={0.7}
            depthWrite={false}
          />
          <Line
            points={seg.fill}
            color="#ffd66a"
            lineWidth={2.5}
            transparent
            opacity={0.9}
            depthWrite={false}
          />
        </group>
      ))}
      {lockedSegments.map((seg) => (
        <group key={seg.id}>
          <Line
            points={seg.outline}
            color="#302b24"
            lineWidth={4}
            transparent
            opacity={0.6}
            depthWrite={false}
          />
          <Line
            points={seg.fill}
            color="#c3b69d"
            lineWidth={1.5}
            dashed
            dashSize={0.3}
            gapSize={0.22}
            transparent
            opacity={0.65}
            depthWrite={false}
          />
        </group>
      ))}
    </group>
  );
};
