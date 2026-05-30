import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { audio } from "../audio/AudioManager";
import { isDebug } from "../debug";
import { EditLevelButton } from "../editor/EditLevelButton";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { type LevelConfig, levelHasMode } from "../levels";
import {
  getModeStars,
  getStars,
  hasUnlockedChallengeModes,
  isLevelUnlocked,
  isModeUnlocked,
  LEVEL_MODE_LABEL,
  type LevelMode,
  type Stars,
} from "../progress";
import { useGame } from "../store";
import { IconBreach, IconLock, IconLockdown, IconStar, IconUnlock } from "../ui/MenuIcons";

type Props = { level: LevelConfig };

const STAR_SHAPE = (() => {
  const shape = new THREE.Shape();
  const outer = 0.46;
  const inner = 0.2;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
})();

const STAR_GEOM = new THREE.ShapeGeometry(STAR_SHAPE);
const STAR_SLOTS = ["slot-left", "slot-center", "slot-right"] as const;

// World-map challenge-mode badge styling. Icon carries the mode's visual
// identity (no letter — the letters overlapped the level-number plaque
// and were illegible against the terrain). Three render states
// (locked / unlocked / cleared) are chosen at the call site.
const MODE_BADGE: Record<
  "heroic" | "iron",
  { Icon: typeof IconBreach; text: string; border: string; bg: string }
> = {
  heroic: {
    Icon: IconBreach,
    text: "text-orange",
    border: "border-orange",
    bg: "bg-[rgba(60,30,5,0.92)]",
  },
  iron: {
    Icon: IconLockdown,
    text: "text-red",
    border: "border-red",
    bg: "bg-[rgba(50,10,18,0.92)]",
  },
};

export const LevelNode = ({ level }: Props) => {
  const groupRef = useRef<THREE.Group>(null);
  const progress = useGame((s) => s.progress);
  const hoveredLevelId = useGame((s) => s.hoveredLevelId);
  const startLevel = useGame((s) => s.startLevel);
  const openModePicker = useGame((s) => s.openModePicker);
  const setHoveredLevel = useGame((s) => s.setHoveredLevel);
  const editorActive = useWorldMapEditor((s) => s.active);
  const [pointerHovered, setPointerHovered] = useState(false);

  const unlocked = isLevelUnlocked(level.id, progress);
  const stars = getStars(progress, level.id);
  const completed = stars > 0;
  const unplayed = unlocked && !completed;
  const hovered = pointerHovered || hoveredLevelId === level.id;

  // Mode picker opens only when at least one challenge mode is both
  // authored on this level AND unlocked for the player. Early-game
  // levels without heroic/iron content go straight into normal so the
  // player isn't prompted with a one-option modal.
  const modePickerAvailable =
    unlocked &&
    (["heroic", "iron"] as LevelMode[]).some(
      (m) => levelHasMode(level, m) && isModeUnlocked(progress, level.id, m),
    );
  const modeStars = getModeStars(progress, level.id);

  // Challenge-mode badges surface per-level state (locked / unlocked /
  // cleared) at a glance. Hidden until the player first unlocks challenge
  // modes anywhere, so the early-game map stays clean; then every unlocked
  // level that authors a mode advertises whether it's still locked behind
  // a 3-star Standard run, open to attempt, or already beaten.
  const challengeBadges =
    unlocked && hasUnlockedChallengeModes(progress)
      ? (["heroic", "iron"] as const)
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
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const hoverBoost = hovered ? (unlocked ? 1.18 : 1.08) : 1.0;
    if (unplayed) {
      const t = state.clock.elapsedTime;
      const pulse = 1 + Math.sin(t * 3.2) * 0.08;
      g.scale.setScalar(pulse * hoverBoost);
    } else {
      g.scale.setScalar(hoverBoost);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!unlocked) return;
    audio.ensureResumed();
    audio.play("level-select", "ui", 0.7, 80);
    if (modePickerAvailable) openModePicker(level.id);
    else startLevel(level.id);
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

  // Stars sit high above the dome; the number / lock label sits just
  // south of the ground ring (radius 1.5) so it reads as a plaque
  // directly under the icon at our tilted ortho angle. Positive z =
  // "south" on screen.
  const starY = 3.15;
  const labelZ = 1.85;

  const x = level.nodePos.x;
  const z = -level.nodePos.y;

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
        <div className={`map-label ${unlocked ? "" : "locked"}`}>
          {unlocked ? level.id : "\u{1F512}"}
        </div>
      </Html>

      {completed && (
        <group position={[0, starY, 0]}>
          {STAR_SLOTS.map((slot, i) => {
            const filled = i < stars;
            const offset = (i - 1) * 1.1;
            return (
              <mesh
                key={slot}
                geometry={STAR_GEOM}
                position={[offset, 0, 0]}
                rotation={[-Math.PI / 2.4, 0, 0]}
              >
                <meshStandardMaterial
                  color={filled ? "#ffd66a" : "#2a3240"}
                  emissive={filled ? "#a66a14" : "#000000"}
                  emissiveIntensity={filled ? 1.2 : 0}
                  side={THREE.DoubleSide}
                />
              </mesh>
            );
          })}
        </group>
      )}

      {!editorActive && challengeBadges.length > 0 && (
        <Html
          center
          position={[0, 0.05, labelZ + 1.5]}
          zIndexRange={[0, 10]}
          wrapperClass="map-badges-wrap"
        >
          <div className="flex gap-1 select-none">
            {challengeBadges.map(({ mode, cleared, open }) => {
              const b = MODE_BADGE[mode];
              const state = cleared ? "cleared" : open ? "unlocked" : "locked";
              const cls = cleared
                ? `${b.border} ${b.text} ${b.bg}`
                : open
                  ? `${b.border} ${b.text} bg-[rgba(10,16,24,0.92)]`
                  : "border-border-faint text-fg-dim bg-[rgba(10,16,24,0.92)] opacity-70";
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!unlocked) return;
                    audio.ensureResumed();
                    audio.play("level-select", "ui", 0.7, 80);
                    openModePicker(level.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`relative flex items-center justify-center w-7 h-7 rounded border ${cls} transition-all hover:brightness-125 cursor-pointer`}
                  title={`${LEVEL_MODE_LABEL[mode]} — ${state}`}
                  aria-label={`${LEVEL_MODE_LABEL[mode]} — ${state}`}
                >
                  <b.Icon size={16} />
                  {cleared && (
                    <span
                      className={`absolute -top-1 -right-1 text-[9px] font-bold ${b.text} bg-[rgba(10,16,24,0.95)] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none`}
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Html>
      )}

      {isDebug && !editorActive && <DebugLevelControl levelId={level.id} levelName={level.name} />}
      {import.meta.env.DEV && unlocked && !editorActive && <EditLevelButton levelId={level.id} />}
    </group>
  );
};

const DebugLevelControl = ({ levelId, levelName }: { levelId: number; levelName: string }) => {
  const progress = useGame((s) => s.progress);
  const debugSetLevelStars = useGame((s) => s.debugSetLevelStars);
  const debugUnlockThroughLevel = useGame((s) => s.debugUnlockThroughLevel);
  const debugLockFromLevel = useGame((s) => s.debugLockFromLevel);
  const unlocked = isLevelUnlocked(levelId, progress);
  const stars = getStars(progress, levelId);
  const unlockLabel = unlocked
    ? levelId === 1
      ? "Clear all stars and reset the tech tree"
      : `Lock ${levelName} and later, clear earned stars, reset the tech tree`
    : `Unlock through ${levelName} with 3 stars`;
  const starValues = [1, 2, 3] as const satisfies readonly Stars[];

  return (
    <Html
      center
      position={[0, 4.05, -0.1]}
      zIndexRange={[9, 9]}
      wrapperClass="debug-level-control-wrap"
    >
      <div
        className={`debug-level-control ${unlocked ? "is-complete" : "is-locked"}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <fieldset className="debug-level-stars" aria-label={`${levelName} stars`}>
          {starValues.map((value) => (
            <button
              key={value}
              type="button"
              className={`debug-level-star-button ${value <= stars ? "is-filled" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                debugSetLevelStars(levelId, value);
              }}
              title={`Set ${levelName} to ${value} star${value === 1 ? "" : "s"}`}
              aria-label={`Set ${levelName} to ${value} star${value === 1 ? "" : "s"}`}
              aria-pressed={stars === value}
            >
              <IconStar size={10} className="debug-level-star-icon" />
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          className="debug-level-unlock"
          onClick={(e) => {
            e.stopPropagation();
            if (unlocked) debugLockFromLevel(levelId);
            else debugUnlockThroughLevel(levelId);
          }}
          title={unlockLabel}
          aria-label={unlockLabel}
          aria-pressed={unlocked}
        >
          {unlocked ? <IconUnlock size={12} /> : <IconLock size={12} />}
        </button>
      </div>
    </Html>
  );
};
