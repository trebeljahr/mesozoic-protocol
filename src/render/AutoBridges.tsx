import type { FlowPalette } from "../flowGeometry";
import { PATH_WIDTH } from "../level";
import type { AutoBridge, RiverMaterial } from "../sim/types";
import { useGame } from "../store";

// Editor-managed bridges over hand-painted river × path crossings. Reads
// world.autoBridges (resolved by src/editor/bridgeResolver.ts on every
// editor commit and persisted in the level-edit blob) and re-renders on
// ui.treeVersion bumps. The geometry mirrors the box-deck + box-trim
// primitives Rivers.tsx used inline, but the palette is keyed off
// `b.material` so a lava river gets a sooty deck, a toxic river gets a
// violet one, and water keeps the warm-wood look.
//
// Not dev-gated — auto-bridges are world data, not editor-only state.

const MATERIALS: Record<RiverMaterial, FlowPalette> = {
  water: {
    fluidColor: "#3a82c6",
    fluidEmissive: "#1a4870",
    fluidEmissiveIntensity: 0.18,
    bridgeDeck: "#5a3c20",
    bridgeTrim: "#3a2614",
  },
  lava: {
    fluidColor: "#ff6a1c",
    fluidEmissive: "#ff5010",
    fluidEmissiveIntensity: 1.6,
    bridgeDeck: "#2e1a10",
    bridgeTrim: "#7a3a1e",
  },
  toxic: {
    fluidColor: "#3ad6b0",
    fluidEmissive: "#5affc8",
    fluidEmissiveIntensity: 0.55,
    bridgeDeck: "#1f1230",
    bridgeTrim: "#4a2a70",
  },
};

const BridgeMesh = ({ bridge }: { bridge: AutoBridge }) => {
  const palette = MATERIALS[bridge.material];
  const bridgeWidth = PATH_WIDTH + 0.4;
  if (bridge.kind === "plaza") {
    return (
      <group position={[bridge.pos.x, 0.08, -bridge.pos.y]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[bridge.radius, bridge.radius, 0.18, 28]} />
          <meshStandardMaterial color={palette.bridgeDeck} roughness={1} />
        </mesh>
        <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <torusGeometry args={[bridge.radius - 0.05, 0.06, 8, 28]} />
          <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[bridge.pos.x, 0.08, -bridge.pos.y]} rotation={[0, -bridge.rotY, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[bridge.length, 0.18, bridgeWidth]} />
        <meshStandardMaterial color={palette.bridgeDeck} roughness={1} />
      </mesh>
      <mesh position={[0, 0.18, bridgeWidth / 2 - 0.06]} castShadow>
        <boxGeometry args={[bridge.length, 0.22, 0.12]} />
        <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
      </mesh>
      <mesh position={[0, 0.18, -(bridgeWidth / 2 - 0.06)]} castShadow>
        <boxGeometry args={[bridge.length, 0.22, 0.12]} />
        <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
      </mesh>
    </group>
  );
};

export const AutoBridges = () => {
  // Subscribe to the static-geometry invalidation key so editor commits
  // (bumpGeometry → ui.treeVersion) re-render this layer alongside Rivers
  // and EditorProps.
  const version = useGame((s) => s.ui.treeVersion);
  void version;
  const bridges = useGame.getState().world.autoBridges;
  if (bridges.length === 0) return null;
  return (
    <group>
      {bridges.map((b) => (
        <BridgeMesh key={b.id} bridge={b} />
      ))}
    </group>
  );
};
