import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { audio } from "../audio/AudioManager";
import { GAMEPAD_STICK_DEADZONE, scaleGamepadAxis, useGamepadInput } from "../input/gamepad";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import { effectiveTowerCost } from "../sim/metaSkills";
import type { TowerKind } from "../sim/types";
import { TOWER_CLEAR_RADIUS, TOWER_STATS } from "../sim/world";
import { useGame } from "../store";
import { GhostTower } from "./GhostTower";

type Vec2 = { x: number; y: number };

const TOUCH_CLICK_SUPPRESS_MS = 700;
// Pixel distance past which a single-finger touch counts as a drag.
// At/below this, lift commits a placement / selects inline (snappy
// tap UX). Above this, OrbitControls already panned the camera and
// the lift parks a Confirm pill instead of placing — gives the player
// a chance to fine-tune before committing.
const TOUCH_TAP_THRESHOLD_PX = 12;
// Window after a touch interaction during which gamepad cursor/button
// input is ignored on the play canvas. Stops accidental stick deflection
// from kicking the player out of an active touch placement, and prevents
// hint flicker when a touch device also has a paired controller idling.
const GAMEPAD_TOUCH_LOCKOUT_MS = 500;
const GAMEPAD_CURSOR_SPEED = 9;
const GAMEPAD_TOWER_ORDER: TowerKind[] = ["pulse", "chain", "flame", "hive", "mortar", "cryo"];

export const Placement = () => {
  const { camera, gl } = useThree();
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [controllerHover, setControllerHover] = useState<Vec2 | null>(null);
  const [controllerActive, setControllerActive] = useState(false);
  const hoverRef = useRef<Vec2 | null>(null);
  const controllerHoverRef = useRef<Vec2 | null>(null);
  const controllerActiveRef = useRef(false);
  const raycasterRef = useRef(new THREE.Raycaster());
  const groundPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const groundPointRef = useRef(new THREE.Vector3());
  const touchPointersRef = useRef<Set<number>>(new Set());
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const multiTouchRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const lastTouchInputAtRef = useRef(0);
  const invalidPulseTimerRef = useRef<number | null>(null);
  const [invalidPulse, setInvalidPulse] = useState<{ pos: Vec2; key: number } | null>(null);
  const gold = useGame((s) => s.ui.gold);
  const status = useGame((s) => s.ui.status);
  const selectedKind = useGame((s) => s.selectedKind);
  // Subscribed so the placement plane re-renders (and re-runs the
  // towerAtPos / canPlace getState() reads below) when towers or trees
  // are added or removed. Without this, the plane only re-validated on
  // gold/status/selectedKind/hover changes, which silently went stale.
  useGame((s) => s.towerVersion);
  useGame((s) => s.treeVersion);

  const setHoverState = useCallback((pos: Vec2 | null) => {
    hoverRef.current = pos;
    setHover(pos);
  }, []);

  const setControllerHoverState = useCallback((pos: Vec2 | null) => {
    controllerHoverRef.current = pos;
    setControllerHover(pos);
  }, []);

  const setControllerActiveState = useCallback((active: boolean) => {
    controllerActiveRef.current = active;
    setControllerActive(active);
  }, []);

  // Flash a transient red ring at the rejected click position so the
  // player gets a visual "no, not there" alongside the error tone. The
  // ring auto-clears after a short window — restarting the timer if a
  // second invalid click lands while one's already showing.
  const flashInvalidMove = useCallback((pos: Vec2) => {
    if (invalidPulseTimerRef.current !== null) {
      window.clearTimeout(invalidPulseTimerRef.current);
    }
    setInvalidPulse({ pos: { x: pos.x, y: pos.y }, key: Date.now() });
    invalidPulseTimerRef.current = window.setTimeout(() => {
      setInvalidPulse(null);
      invalidPulseTimerRef.current = null;
    }, 380);
  }, []);

  useEffect(
    () => () => {
      if (invalidPulseTimerRef.current !== null) {
        window.clearTimeout(invalidPulseTimerRef.current);
      }
    },
    [],
  );

  const pointFromScreen = (clientX: number, clientY: number): Vec2 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );

    raycasterRef.current.setFromCamera(ndc, camera);
    const hit = raycasterRef.current.ray.intersectPlane(
      groundPlaneRef.current,
      groundPointRef.current,
    );
    if (!hit) return null;
    return { x: hit.x, y: -hit.z };
  };

  const eventPoint = (e: ThreeEvent<PointerEvent | MouseEvent>): Vec2 => {
    const clientX = e.nativeEvent.clientX;
    const clientY = e.nativeEvent.clientY;
    return pointFromScreen(clientX, clientY) ?? { x: e.point.x, y: -e.point.z };
  };

  const isTouchEvent = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    "pointerType" in e.nativeEvent && e.nativeEvent.pointerType === "touch";

  useEffect(() => {
    if (!selectedKind) {
      setHoverState(null);
      setControllerHoverState(null);
      setControllerActiveState(false);
      touchPointersRef.current.clear();
      touchStartRef.current = null;
      multiTouchRef.current = false;
      suppressClickUntilRef.current = 0;
    }
    // Any kind change (including switch from one tower to another)
    // invalidates a parked Confirm placement — it referred to the
    // previous kind's footprint/cost.
    useGame.setState({ pendingTouchPlacement: null });
  }, [selectedKind, setControllerActiveState, setControllerHoverState, setHoverState]);

  useGamepadInput((frame) => {
    if (!frame.gamepad) {
      return;
    }

    const state = useGame.getState();
    if (
      state.screen !== "playing" ||
      state.ui.status !== "running" ||
      state.compendiumOpen ||
      state.achievementsOpen ||
      state.creditsOpen ||
      state.difficultyPickerOpen ||
      state.levelIntroVisible ||
      state.newEnemyQueue.length > 0
    ) {
      return;
    }

    // Suppress stick/cursor input briefly after a touch so accidental
    // controller contact doesn't override an in-progress finger gesture.
    // Button presses (pause, call-wave, cycle) still go through — those
    // are deliberate and not subject to the same conflict.
    const touchLocked = Date.now() - lastTouchInputAtRef.current < GAMEPAD_TOUCH_LOCKOUT_MS;

    if (frame.buttonPressed("start")) state.togglePause();
    if (frame.buttonPressed("y")) state.callWaveEarly();

    const cycleTower = (direction: -1 | 1) => {
      const currentIndex = state.selectedKind
        ? GAMEPAD_TOWER_ORDER.indexOf(state.selectedKind)
        : -1;
      const nextIndex =
        currentIndex === -1
          ? direction > 0
            ? 0
            : GAMEPAD_TOWER_ORDER.length - 1
          : (currentIndex + direction + GAMEPAD_TOWER_ORDER.length) % GAMEPAD_TOWER_ORDER.length;
      state.setSelectedKind(GAMEPAD_TOWER_ORDER[nextIndex]);
      setControllerActiveState(true);
    };

    if (frame.buttonPressed("lb")) cycleTower(-1);
    if (frame.buttonPressed("rb")) cycleTower(1);

    if (frame.buttonPressed("b")) {
      if (
        state.selectedKind ||
        state.ui.selectedTowerId ||
        state.selectedTreeId ||
        state.selectedRockId
      ) {
        state.clearSelection();
      } else if (state.ui.status === "running" || state.ui.status === "paused") {
        state.togglePause();
      }
    }

    const dpadX = Number(frame.buttonDown("right")) - Number(frame.buttonDown("left"));
    const dpadY = Number(frame.buttonDown("down")) - Number(frame.buttonDown("up"));
    const leftX = scaleGamepadAxis(frame.axis("leftX"), GAMEPAD_STICK_DEADZONE);
    const leftY = scaleGamepadAxis(frame.axis("leftY"), GAMEPAD_STICK_DEADZONE);
    const rightX = scaleGamepadAxis(frame.axis("rightX"), GAMEPAD_STICK_DEADZONE);
    const rightY = scaleGamepadAxis(frame.axis("rightY"), GAMEPAD_STICK_DEADZONE);
    // Pick the stronger deflection per axis so a player using both
    // sticks at once doesn't lose one to the OR short-circuit. Either
    // stick can drive the cursor; whichever is pushed harder wins.
    const stickX = Math.abs(rightX) >= Math.abs(leftX) ? rightX : leftX;
    const stickY = Math.abs(rightY) >= Math.abs(leftY) ? rightY : leftY;
    const moveX = dpadX || stickX;
    const moveY = dpadY || stickY;

    if ((moveX || moveY) && !touchLocked) {
      const base = controllerHoverRef.current ?? hoverRef.current ?? { x: 0, y: 0 };
      const next = {
        x: THREE.MathUtils.clamp(
          base.x + moveX * GAMEPAD_CURSOR_SPEED * frame.delta,
          -MAP_WIDTH / 2 + 0.5,
          MAP_WIDTH / 2 - 0.5,
        ),
        y: THREE.MathUtils.clamp(
          base.y - moveY * GAMEPAD_CURSOR_SPEED * frame.delta,
          -MAP_HEIGHT / 2 + 0.5,
          MAP_HEIGHT / 2 - 0.5,
        ),
      };
      setControllerActiveState(true);
      setControllerHoverState(next);
    }

    if (frame.buttonPressed("a") && !touchLocked) {
      const pos = controllerHoverRef.current ?? hoverRef.current ?? { x: 0, y: 0 };
      if (state.towerAtPos(pos)) audio.ui("select");
      state.tryPlaceOrSelect(pos);
      setControllerActiveState(true);
      setControllerHoverState(pos);
    }
  });

  const updateDashAim = (pos: Vec2) => {
    const state = useGame.getState();
    const robot = state.world.robot;
    if (!robot.dashAim) return;
    state.setRobotDashAimDir({ x: pos.x - robot.pos.x, y: pos.y - robot.pos.y });
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (isTouchEvent(e)) {
      lastTouchInputAtRef.current = Date.now();
      // Multi-touch (pinch/zoom) belongs to camera — don't fight it
      // with placement hover updates.
      if (touchPointersRef.current.size > 1 || multiTouchRef.current) return;
      const pos = eventPoint(e);
      setControllerActiveState(false);
      setHoverState(pos);
      updateDashAim(pos);
      return;
    }
    const pos = eventPoint(e);
    setControllerActiveState(false);
    setHoverState(pos);
    updateDashAim(pos);
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (isTouchEvent(e)) {
      lastTouchInputAtRef.current = Date.now();
      touchPointersRef.current.add(e.nativeEvent.pointerId);
      if (touchPointersRef.current.size > 1) {
        multiTouchRef.current = true;
        touchStartRef.current = null;
        // Pinch started — hide the placement ghost while the camera
        // gesture is in progress.
        setHoverState(null);
        return;
      }
      // Starting a fresh single-finger interaction wipes any parked
      // Confirm pending — the user is repositioning, not confirming.
      useGame.setState({ pendingTouchPlacement: null });
      touchStartRef.current = {
        x: e.nativeEvent.clientX,
        y: e.nativeEvent.clientY,
      };
      // Show the ghost under the finger immediately so the player gets
      // visual feedback as soon as they touch the map. Subsequent
      // pointermove events keep it locked to the finger.
      const pos = eventPoint(e);
      setControllerActiveState(false);
      setHoverState(pos);
      // If a dash is armed, snap the aim arrow to the finger on touchdown so
      // the drag-to-aim gesture reads immediately, not only after a move.
      updateDashAim(pos);
      return;
    }
    onPointerMove(e);
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isTouchEvent(e)) return;
    lastTouchInputAtRef.current = Date.now();

    const wasMultiTouch = multiTouchRef.current || touchPointersRef.current.size > 1;
    // Compare lift position to touchdown position — if the finger moved
    // past the tap threshold the gesture was a pan/drag. Computed against
    // the down point (not via pointermove deltas) because R3F mesh moves
    // only fire while the pointer is over the mesh, but pan can drag the
    // finger past the HUD where mesh moves stop firing.
    const start = touchStartRef.current;
    let wasDragged = false;
    if (start) {
      const dx = e.nativeEvent.clientX - start.x;
      const dy = e.nativeEvent.clientY - start.y;
      if (dx * dx + dy * dy > TOUCH_TAP_THRESHOLD_PX * TOUCH_TAP_THRESHOLD_PX) {
        wasDragged = true;
      }
    }
    touchPointersRef.current.delete(e.nativeEvent.pointerId);
    if (touchPointersRef.current.size === 0) {
      multiTouchRef.current = false;
      touchStartRef.current = null;
    }

    // Multi-touch (pinch/two-finger gesture) never commits a placement.
    if (wasMultiTouch) {
      suppressClickUntilRef.current = Date.now() + TOUCH_CLICK_SUPPRESS_MS;
      return;
    }

    const pos = eventPoint(e);
    suppressClickUntilRef.current = Date.now() + TOUCH_CLICK_SUPPRESS_MS;

    // Dash aim armed: the whole touch was a dash-direction chooser — the
    // arrow tracked the finger via onPointerMove, so lift commits the dash
    // toward the release point. Never parks a tower-placement pill, whether
    // the finger was dragged or tapped.
    if (useGame.getState().world.robot.dashAim) {
      handleGroundTap(pos);
      return;
    }

    // Drag → park preview at lift point and arm the Confirm pill so
    // the player can fine-tune before committing. Tap → run the same
    // ground command as click (robot move/dash, then placement/select).
    if (wasDragged) {
      setHoverState(pos);
      useGame.getState().setPendingTouchPlacement(pos);
      return;
    }

    handleGroundTap(pos, {
      clearSelectionAfterPlacement: true,
      deselectRobotOnInvalidMove: true,
    });
  };

  const onPointerCancel = (e: ThreeEvent<PointerEvent>) => {
    if (!isTouchEvent(e)) return;
    lastTouchInputAtRef.current = Date.now();
    touchPointersRef.current.delete(e.nativeEvent.pointerId);
    if (touchPointersRef.current.size === 0) {
      multiTouchRef.current = false;
      touchStartRef.current = null;
    }
  };

  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    if (isTouchEvent(e)) return;
    if (!controllerActiveRef.current) setHoverState(null);
  };

  const handleGroundTap = (
    pos: Vec2,
    opts: { clearSelectionAfterPlacement?: boolean; deselectRobotOnInvalidMove?: boolean } = {},
  ) => {
    const state = useGame.getState();
    // Dash aim active (any dash robot): a ground click commits the dash
    // in the current aim direction and swallows the click so we don't
    // also re-order the robot to walk somewhere.
    if (state.world.robot.dashAim) {
      state.setRobotDashAimDir({
        x: pos.x - state.world.robot.pos.x,
        y: pos.y - state.world.robot.pos.y,
      });
      state.triggerRobotAbility(0);
      return;
    }
    // Click-after-select: while the robot is selected, a ground click is a
    // free-roam move order (the robot walks straight across terrain) —
    // UNLESS it landed on a tower or the HQ. A valid entity click runs that entity's
    // normal select action and deselects the robot, so the player can go
    // straight from commanding the robot to inspecting a tower. Dinos bubble
    // through here (their mesh handler yields while the robot is selected)
    // but aren't tower/HQ hits, so they stay move orders. Robot stays
    // selected on empty ground — click the robot again to deselect.
    if (state.world.robot.selected && state.selectedKind === null) {
      if (!state.towerAtPos(pos) && !state.hqAtPos(pos)) {
        if (!state.orderRobotMove(pos)) {
          // Tap landed well outside the playfield. On touch there's no
          // right-click/Esc to back out of robot command mode, so a tap off
          // the field means "I'm done driving the robot" — deselect it.
          // Desktop keeps the rejection cue since a stray left-click shouldn't drop it.
          if (opts.deselectRobotOnInvalidMove) {
            state.selectRobotUnit(false);
          } else {
            audio.ui("error");
            flashInvalidMove(pos);
          }
        }
        return;
      }
      // Fell on a tower/HQ — fall through to tryPlaceOrSelect, which selects
      // the entity and clears robot.selected.
    }
    if (state.towerAtPos(pos)) audio.ui("select");
    state.tryPlaceOrSelect(pos, opts);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (Date.now() < suppressClickUntilRef.current) return;
    handleGroundTap(eventPoint(e));
  };

  // Right-click = move-order for the robot, but only while the robot is
  // selected. Falls back to mouse-button detection on contextmenu because
  // R3F surfaces it as a plain MouseEvent. If a dash aim is armed,
  // right-click cancels the aim (no cooldown spent) and does NOT issue a
  // move order — symmetric with Esc.
  const onContextMenu = (e: ThreeEvent<MouseEvent>) => {
    e.nativeEvent.preventDefault();
    e.stopPropagation();
    const state = useGame.getState();
    if (state.world.robot.dashAim) {
      state.cancelRobotDashAim();
      return;
    }
    if (!state.world.robot.selected) return;
    const pos = eventPoint(e);
    if (!state.orderRobotMove(pos)) {
      audio.ui("error");
      flashInvalidMove(pos);
    }
  };

  // Suppress browser's native context menu on the canvas so right-click
  // never opens the OS menu when the player tries to issue a move-order.
  useEffect(() => {
    const el = gl.domElement;
    const onNative = (e: MouseEvent) => e.preventDefault();
    el.addEventListener("contextmenu", onNative);
    return () => el.removeEventListener("contextmenu", onNative);
  }, [gl]);

  const activeHover = controllerActive && controllerHover ? controllerHover : hover;
  const hoveredTower = activeHover !== null ? useGame.getState().towerAtPos(activeHover) : null;

  const showPlacement =
    activeHover !== null && hoveredTower === null && status === "running" && selectedKind !== null;
  const placementState = useGame.getState();
  const selectedCost =
    selectedKind === null
      ? Infinity
      : effectiveTowerCost(
          selectedKind,
          placementState.progress.metaSkills,
          placementState.world.towers.filter((t) => t.kind === selectedKind).length,
        );

  const canPlaceHere =
    showPlacement && gold >= selectedCost && placementState.canPlace(activeHover!);

  const placementColor = canPlaceHere ? "#3dff8a" : "#ff5a7a";
  const range = selectedKind ? TOWER_STATS[selectedKind].range : 0;

  const geom = useMemo(() => new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT), []);
  useEffect(() => () => geom.dispose(), [geom]);

  return (
    <group>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this is an
          r3f canvas mesh, not a DOM element — pointer events are how
          three.js exposes click/hover on 3D geometry. */}
      <mesh
        geometry={geom}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.001, 0]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerOut={onPointerOut}
        onClick={onClick}
        onContextMenu={onContextMenu}
        visible={false}
      />

      {activeHover && status === "running" && hoveredTower && (
        <group position={[hoveredTower.pos.x, 0, -hoveredTower.pos.y]}>
          <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.7, 0.9, 32]} />
            <meshBasicMaterial color="#ffd66a" transparent opacity={0.9} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[hoveredTower.range - 0.04, hoveredTower.range, 64]} />
            <meshBasicMaterial color="#ffd66a" transparent opacity={0.22} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {invalidPulse && <InvalidMovePulse key={invalidPulse.key} pos={invalidPulse.pos} />}

      {showPlacement && (
        <>
          <group position={[activeHover!.x, 0, -activeHover!.y]}>
            <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.55, TOWER_CLEAR_RADIUS, 24]} />
              <meshBasicMaterial
                color={placementColor}
                transparent
                opacity={0.9}
                depthTest={false}
                side={THREE.DoubleSide}
              />
            </mesh>
            <PlacementCrosshair color={placementColor} />
            {canPlaceHere && (
              <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[range - 0.04, range, 64]} />
                <meshBasicMaterial
                  color={placementColor}
                  transparent
                  opacity={0.25}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}
          </group>
          <Suspense fallback={null}>
            <GhostTower kind={selectedKind!} pos={activeHover!} ok={canPlaceHere} />
          </Suspense>
        </>
      )}
    </group>
  );
};

const INVALID_PULSE_DURATION = 0.38;

const InvalidMovePulse = ({ pos }: { pos: Vec2 }) => {
  const ringRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const xRef = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  useFrame((_, dt) => {
    elapsedRef.current += dt;
    const t = Math.min(1, elapsedRef.current / INVALID_PULSE_DURATION);
    const scale = 0.6 + t * 0.9;
    if (ringRef.current) ringRef.current.scale.setScalar(scale);
    if (xRef.current) xRef.current.scale.setScalar(0.9 + t * 0.2);
    const opacity = 0.95 * (1 - t);
    if (matRef.current) matRef.current.opacity = opacity;
  });
  return (
    <group position={[pos.x, 0, -pos.y]}>
      <mesh ref={ringRef} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.62, 32]} />
        <meshBasicMaterial
          ref={matRef}
          color="#ff4d6a"
          transparent
          opacity={0.95}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group ref={xRef} position={[0, 0.06, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
          <planeGeometry args={[0.75, 0.08]} />
          <meshBasicMaterial color="#ff4d6a" transparent opacity={0.95} depthTest={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, -Math.PI / 4]}>
          <planeGeometry args={[0.75, 0.08]} />
          <meshBasicMaterial color="#ff4d6a" transparent opacity={0.95} depthTest={false} />
        </mesh>
      </group>
    </group>
  );
};

const PlacementCrosshair = ({ color }: { color: string }) => (
  <>
    <mesh position={[0.48, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.36, 0.045]} />
      <meshBasicMaterial color={color} transparent opacity={0.96} depthTest={false} />
    </mesh>
    <mesh position={[-0.48, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.36, 0.045]} />
      <meshBasicMaterial color={color} transparent opacity={0.96} depthTest={false} />
    </mesh>
    <mesh position={[0, 0.05, 0.48]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.045, 0.36]} />
      <meshBasicMaterial color={color} transparent opacity={0.96} depthTest={false} />
    </mesh>
    <mesh position={[0, 0.05, -0.48]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.045, 0.36]} />
      <meshBasicMaterial color={color} transparent opacity={0.96} depthTest={false} />
    </mesh>
  </>
);
