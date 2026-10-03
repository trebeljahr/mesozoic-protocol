import { Html } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import { canUseBattlefield } from "../sim/playControl";
import { useGame } from "../store";
import { useBattleView } from "../ui/battleView";
import { useIncomingWave } from "../ui/useIncomingWave";

export function IncomingLaneMarkers() {
  const { t } = useTranslation();
  const preview = useIncomingWave();
  const paths = useGame((s) => s.world.paths);
  const usable = useGame(canUseBattlefield);
  const open = useBattleView((s) => s.previewOpen);
  const selected = useBattleView((s) => s.previewLane);
  if (!open || !usable || !preview) return null;
  return (
    <group>
      {preview.lanes
        .filter((lane) => selected === null || lane.index === selected)
        .map((lane) => {
          const entry = paths[lane.index]?.[0];
          if (!entry) return null;
          return (
            <group key={lane.index} position={[entry.x, 0.15, -entry.y]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.05, 1.35, 32]} />
                <meshBasicMaterial color="#ffd66a" transparent opacity={0.8} depthWrite={false} />
              </mesh>
              <Html
                center
                position={[0, 1.2, 0]}
                zIndexRange={[1, 5]}
                style={{ pointerEvents: "none" }}
              >
                <span className="wave-entry-label">
                  {t("wavePreview.marker", { lane: lane.index + 1, count: lane.count })}
                </span>
              </Html>
            </group>
          );
        })}
    </group>
  );
}
