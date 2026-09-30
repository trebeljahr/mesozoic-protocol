import { useMemo } from "react";
import { useGame } from "../store";
import { ContainmentCompound } from "./ContainmentCompound";
import { hasMarshContainment } from "./containmentLayout";
import { OutpostClusters } from "./OutpostClusters";
import { OUTPOST_BY_ID, type PlacedOutpost } from "./outpostKit";

// Renders the level's authored modular colonies (sim-owned, in world.outposts):
// hero colonies in the outer scenery band plus any interior blocker colony.
export const WorldOutposts = () => {
  const campaign = useGame((s) => !s.world.overrideActive);
  const biome = useGame((s) => s.world.biome);
  const showcase = useGame((s) => hasMarshContainment(s.world));
  const paths = useGame((s) => s.world.paths);
  const outposts = useGame((s) => s.world.outposts);
  const clusters = useMemo<PlacedOutpost[]>(
    () =>
      outposts
        .filter(() => !campaign)
        .map((o) => {
          const template = OUTPOST_BY_ID[o.templateId];
          if (!template) return null;
          return { template, pos: o.pos, yaw: o.yaw, scale: o.scale };
        })
        .filter((c): c is PlacedOutpost => c !== null),
    [outposts, campaign],
  );
  return (
    <>
      <OutpostClusters clusters={clusters} />
      {campaign && (
        <ContainmentCompound outposts={outposts} paths={paths} biome={biome} perimeter={showcase} />
      )}
    </>
  );
};
