import { nanoid } from "nanoid";
import { useMemo } from "react";
import { getFlowConfig } from "../flowGeometry";
import { PATH_WIDTH } from "../level";
import { useGame } from "../store";
import { FlowWaterGroup } from "./FlowWater";

// Renders the per-biome flow geometry built by `buildFlowFeatures` —
// rivers, lakes/puddles, and bridges over path crossings. Palette comes
// from `getFlowConfig(biome).palette` so each biome (lava/forest/alien)
// styles the same shapes differently.
//
// Every biome goes through <FlowWaterGroup/>. Lava and alien used to take a
// separate path that laid rivers out as a chain of independent planes on a
// meshStandardMaterial — flat colour, visible seam at every segment join, and
// lakes as hard-edged discs. The palette is the only thing that should differ
// between biomes here.
export const FlowFeatures = () => {
  const biome = useGame((s) => s.world.biome);
  const features = useGame((s) => s.world.flowFeatures);

  const decorated = useMemo(() => {
    const config = getFlowConfig(biome);
    if (!config || !features) return null;
    return {
      palette: config.palette,
      rivers: features.rivers.map((r) => ({ ...r, id: nanoid() })),
      lakes: features.lakes.map((l) => ({ ...l, id: nanoid() })),
      bridges: features.bridges.map((b) => ({ ...b, id: nanoid() })),
    };
  }, [biome, features]);

  if (!decorated) return null;

  const { palette } = decorated;
  const bridgeWidth = PATH_WIDTH + 0.4;

  return (
    <group>
      <FlowWaterGroup
        palette={palette}
        rivers={decorated.rivers}
        lakes={decorated.lakes}
        bridges={decorated.bridges}
      />
      {decorated.bridges.map((b) =>
        b.kind === "plaza" ? (
          <group key={b.id} position={[b.pos.x, 0.06, -b.pos.y]}>
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[b.radius, b.radius, 0.18, 28]} />
              <meshStandardMaterial color={palette.bridgeDeck} roughness={1} />
            </mesh>
            <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <torusGeometry args={[b.radius - 0.05, 0.06, 8, 28]} />
              <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
            </mesh>
          </group>
        ) : (
          <group key={b.id} position={[b.pos.x, 0.06, -b.pos.y]} rotation={[0, -b.rotY, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[b.length, 0.18, bridgeWidth]} />
              <meshStandardMaterial color={palette.bridgeDeck} roughness={1} />
            </mesh>
            <mesh position={[0, 0.18, bridgeWidth / 2 - 0.06]} castShadow>
              <boxGeometry args={[b.length, 0.22, 0.12]} />
              <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
            </mesh>
            <mesh position={[0, 0.18, -(bridgeWidth / 2 - 0.06)]} castShadow>
              <boxGeometry args={[b.length, 0.22, 0.12]} />
              <meshStandardMaterial color={palette.bridgeTrim} roughness={1} />
            </mesh>
          </group>
        ),
      )}
    </group>
  );
};
