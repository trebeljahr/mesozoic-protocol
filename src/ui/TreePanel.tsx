import { Bounds, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BIOME_LAYERS, BIOME_STYLE, BIOME_TREE_URLS } from "../biomes";
import { ExpectedCanvasTeardown } from "../render/ExpectedCanvasTeardown";
import { ROCK_REMOVE_COST, TREE_REMOVE_COST } from "../sim/world";
import { useGame } from "../store";
import { RightOverlay } from "./RightOverlay";

const StaticModel = ({ url }: { url: string }) => {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} />;
};

// Returns a stable obstacle key (translated at the call site via
// `treePanel.obstacle.<key>`) derived from the model filename.
const obstacleKey = (url: string): string => {
  const file = url.split("/").pop() ?? "";
  // Substring match (not anchored) so PineTreeSnow / BirchTreeSnow / DeadTree
  // all read as "tree", not just files that start with Tree.
  if (/tree/i.test(file)) return "tree";
  if (/^Rock/i.test(file)) return "rock";
  if (/^Bush/i.test(file)) return "bush";
  if (/^Grass/i.test(file)) return "grass";
  if (/^Mushroom/i.test(file)) return "mushroom";
  if (/^Skull/i.test(file)) return "skull";
  if (/^Crystal/i.test(file)) return "crystal";
  if (/^Plant/i.test(file)) return "plant";
  if (/^hangar_|structure_/i.test(file)) return "structure";
  return "obstacle";
};

type Selection =
  | { kind: "tree"; url: string; cost: number; clear: () => void; confirm: () => void }
  | { kind: "rock"; url: string; cost: number; clear: () => void; confirm: () => void };

export const TreePanel = () => {
  const selectedTreeId = useGame((s) => s.selectedTreeId);
  const selectedRockId = useGame((s) => s.selectedRockId);
  const trees = useGame((s) => s.world.trees);
  const rocks = useGame((s) => s.world.rocks);
  const biome = useGame((s) => s.world.biome);
  const gold = useGame((s) => s.ui.gold);
  const status = useGame((s) => s.ui.status);
  const { t } = useTranslation();

  if (status !== "running") return null;

  let selection: Selection | null = null;
  if (selectedTreeId !== null) {
    const tree = trees.find((t) => t.id === selectedTreeId);
    if (tree) {
      selection = {
        kind: "tree",
        url: BIOME_TREE_URLS[biome][tree.variant],
        cost: TREE_REMOVE_COST,
        clear: () => useGame.getState().clearSelectedTree(),
        confirm: () => useGame.getState().confirmRemoveTree(),
      };
    }
  } else if (selectedRockId !== null) {
    const rock = rocks.find((r) => r.id === selectedRockId);
    if (rock) {
      const layer = BIOME_LAYERS[biome][rock.layerIndex];
      const url = layer?.urls[rock.variant];
      if (url) {
        selection = {
          kind: "rock",
          url,
          cost: ROCK_REMOVE_COST,
          clear: () => useGame.getState().clearSelectedRock(),
          confirm: () => useGame.getState().confirmRemoveRock(),
        };
      }
    }
  }

  if (!selection) return null;

  const label = t(`treePanel.obstacle.${obstacleKey(selection.url)}`);
  const canAfford = gold >= selection.cost;
  const style = BIOME_STYLE[biome];

  return (
    <RightOverlay className="tree-panel">
      <div className="panel-header">
        <div className="panel-title">
          <div className="panel-name">{t("treePanel.title", { label })}</div>
          <div className="panel-stats">{t("treePanel.subtitle", { label })}</div>
        </div>
        <button
          type="button"
          className="btn-close"
          onClick={selection.clear}
          aria-label={t("common.close")}
        >
          ×
        </button>
      </div>

      <div
        className="w-full h-[180px] mb-3 rounded-lg overflow-hidden border border-[rgba(120,160,120,0.18)]"
        style={{ background: style.groundColor }}
      >
        <Canvas
          camera={{ position: [3.2, 1.6, 0], fov: 26 }}
          dpr={[1, 2]}
          frameloop="demand"
          gl={{ antialias: true, alpha: true }}
          onCreated={({ camera }) => camera.lookAt(0, 0.7, 0)}
        >
          <ExpectedCanvasTeardown />
          <color attach="background" args={[style.groundColor]} />
          <ambientLight intensity={0.7} color={style.hemiTop} />
          <directionalLight position={[4, 6, 3]} intensity={1.4} color="#fff4dc" />
          <hemisphereLight args={[style.hemiTop, style.hemiBottom, 0.7]} />
          {/* `key` remounts Bounds so it re-fits when a different obstacle is picked — Bounds doesn't observe child changes. */}
          <Suspense fallback={null}>
            <Bounds key={selection.url} fit clip observe margin={1.15}>
              <StaticModel url={selection.url} />
            </Bounds>
          </Suspense>
        </Canvas>
      </div>

      <div className="flex justify-between items-baseline mb-2.5 px-2.5 py-1.5 rounded-md bg-surface-inset border border-border-faint">
        <span className="text-[11px] font-bold tracking-wide text-fg-muted uppercase">
          {t("treePanel.clearCost")}
        </span>
        <span
          className={`text-lg font-bold tabular-nums ${canAfford ? "text-gold" : "text-[#ff7a8a]"}`}
        >
          {selection.cost}g
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn" disabled={!canAfford} onClick={selection.confirm}>
          {t("treePanel.clearAction", { cost: selection.cost })}
        </button>
        <button type="button" className="btn btn-secondary" onClick={selection.clear}>
          {t("common.cancel")}
          <span className="kbd-only"> (Esc)</span>
        </button>
      </div>
    </RightOverlay>
  );
};
