import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { audio } from "../audio/AudioManager";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { type LevelConfig, levelHasMode } from "../levels";
import {
  getModeStars,
  getStars,
  hasUnlockedChallengeModes,
  isLevelUnlocked,
  isModeUnlocked,
  LEVEL_MODE_LABEL,
} from "../progress";
import { useGame } from "../store";
import { IconBreach, IconLockdown } from "../ui/MenuIcons";
import { StarDisplay } from "../ui/StarDisplay";
import { useReducedMotion } from "../ui/useReducedMotion";
import { mapLevelPosition } from "./worldMapLayout";

type Props = { level: LevelConfig };

// World-map challenge-mode badge styling. Icon carries the mode's visual
// identity (no letter — the letters overlapped the level-number plaque
// and were illegible against the terrain). Three render states
// (locked / unlocked / cleared) are chosen at the call site.
const MODE_BADGE: Record<"breach" | "containment", { Icon: typeof IconBreach; text: string }> = {
  breach: {
    Icon: IconBreach,
    text: "text-orange",
  },
  containment: {
    Icon: IconLockdown,
    text: "text-red",
  },
};

export const LevelNode = ({ level }: Props) => {
  const reducedMotion = useReducedMotion();
  const groupRef = useRef<THREE.Group>(null);
  const progress = useGame((s) => s.progress);
  const hoveredLevelId = useGame((s) => s.hoveredLevelId);
  const activateOutpost = useGame((s) => s.activateOutpost);
  const setHoveredLevel = useGame((s) => s.setHoveredLevel);
  const editorActive = useWorldMapEditor((s) => s.active);
  const [pointerHovered, setPointerHovered] = useState(false);

  const unlocked = isLevelUnlocked(level.id, progress);
  const stars = getStars(progress, level.id);
  const completed = stars > 0;
  const unplayed = unlocked && !completed;
  const hovered = pointerHovered || hoveredLevelId === level.id;

  const modeStars = getModeStars(progress, level.id);

  // Challenge-mode badges surface per-level state (locked / unlocked /
  // cleared) at a glance. Hidden until the player first unlocks challenge
  // modes anywhere, so the early-game map stays clean; then every unlocked
  // level that authors a mode advertises whether it's still locked behind
  // a 3-star Standard run, open to attempt, or already beaten.
  const challengeBadges =
    unlocked && hasUnlockedChallengeModes(progress)
      ? (["breach", "containment"] as const)
          .filter((m) => levelHasMode(level, m))
          .map((m) => ({
            mode: m,
            cleared: modeStars[m] > 0,
            open: isModeUnlocked(progress, level.id, m),
          }))
      : [];

  const { baseColor, emissive, emissiveIntensity } = useMemo(() => {
    if (!unlocked) return { baseColor: "#3a4452", emissive: "#000000", emissiveIntensity: 0 };
    if (completed) return { baseColor: "#ffd66a", emissive: "#5a4018", emissiveIntensity: 0.6 };
    return { baseColor: "#3dd1ff", emissive: "#1a6a88", emissiveIntensity: 0.8 };
  }, [unlocked, completed]);

  // Hover bumps the dome. Locked levels still get a smaller bump so the
  // user gets feedback that the cursor is on the node (cursor also flips
  // to not-allowed). Unplayed levels still pulse underneath the bump.
  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const hoverBoost = hovered ? (unlocked ? 1.18 : 1.08) : 1.0;
    if (reducedMotion) {
      g.scale.setScalar(hoverBoost);
    } else if (unplayed) {
      const t = state.clock.elapsedTime;
      const pulse = 1 + Math.sin(t * 3.2) * 0.08;
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, pulse * hoverBoost, 12, delta));
    } else {
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, hoverBoost, 12, delta));
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!unlocked) return;
    audio.ensureResumed();
    audio.play("level-select", "ui", 0.7, 80);
    activateOutpost(level.id);
  };

  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setPointerHovered(true);
    setHoveredLevel(level.id);
    document.body.style.cursor = unlocked ? "pointer" : "not-allowed";
  };

  const handleOut = () => {
    setPointerHovered(false);
    if (useGame.getState().hoveredLevelId === level.id) setHoveredLevel(null);
    document.body.style.cursor = "default";
  };

  const labelZ = 2.1;

  const x = mapLevelPosition(level.id).x;
  const z = -mapLevelPosition(level.id).y;

  return (
    <group position={[x, 0, z]}>
      {/* Invisible hit cylinder. Stable size so the dome's hover-bump
          and unplayed pulse don't yank the hover boundary out from
          under the cursor. Radius matches the outer hover ring (1.95)
          so the entire visible button area registers as the same
          target. Skipped while the world-map editor is active so prop
          placement clicks pass through to the editor's ground plane. */}
      {!editorActive && (
        <mesh
          position={[0, 0.75, 0]}
          onPointerDown={handleClick}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        >
          <cylinderGeometry args={[1.95, 1.95, 1.6, 16]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      <group ref={groupRef}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.9, 1.1, 0.6, 24]} />
          <meshStandardMaterial
            color={baseColor}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity + (hovered && unlocked ? 0.5 : 0)}
            roughness={0.45}
            metalness={0.25}
          />
        </mesh>
        <mesh position={[0, 0.85, 0]} castShadow>
          <sphereGeometry args={[0.5, 20, 20]} />
          <meshStandardMaterial
            color={baseColor}
            emissive={emissive}
            emissiveIntensity={(emissiveIntensity + (hovered && unlocked ? 0.5 : 0)) * 1.2}
            roughness={0.4}
            metalness={0.3}
          />
        </mesh>
      </group>

      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.25, 1.5, 32]} />
        <meshBasicMaterial
          color={unlocked ? (completed ? "#ffd66a" : "#3dd1ff") : "#2a3240"}
          transparent
          opacity={hovered ? (unlocked ? 0.98 : 0.7) : unlocked ? 0.6 : 0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {hovered && (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.55, 1.95, 48]} />
          <meshBasicMaterial
            color={unlocked ? (completed ? "#ffeaa0" : "#9aebff") : "#9aa6b6"}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      <Html center position={[0, 0.05, labelZ]} zIndexRange={[0, 10]} wrapperClass="map-label-wrap">
        <button
          type="button"
          className={`map-label ${unlocked ? "" : "locked"}`}
          disabled={!unlocked || editorActive}
          aria-label={`${level.id}. ${level.name}, ${stars} stars`}
          title={level.name}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            audio.ensureResumed();
            audio.play("level-select", "ui", 0.7, 80);
            activateOutpost(level.id);
          }}
          onFocus={() => setHoveredLevel(level.id)}
          onBlur={() => setHoveredLevel(null)}
        >
          <span className="map-label-main">
            <span className="map-label-number">{level.id}</span>
            {completed && <StarDisplay count={stars} size={10} />}
          </span>
          {!editorActive && challengeBadges.length > 0 && (
            <span className="map-label-modes">
              {challengeBadges.map(({ mode, cleared, open }) => {
                const badge = MODE_BADGE[mode];
                return (
                  <span
                    key={mode}
                    className={cleared || open ? badge.text : "text-fg-dim"}
                    title={`${LEVEL_MODE_LABEL[mode]} — ${cleared ? "cleared" : open ? "unlocked" : "locked"}`}
                  >
                    <badge.Icon size={11} />
                    {cleared && <span aria-hidden>✓</span>}
                  </span>
                );
              })}
            </span>
          )}
        </button>
      </Html>
    </group>
  );
};
