import { useMemo } from "react";
import { useGame } from "../store";
import { ContainmentCompound } from "./ContainmentCompound";
import { hasMarshContainment } from "./containmentLayout";
import { OutpostClusters } from "./OutpostClusters";
import { OUTPOST_BY_ID, type PlacedOutpost } from "./outpostKit";

// Renders the level's authored modular colonies (sim-owned, in world.outposts):
// hero colonies in the outer scenery band plus any interior blocker colony.
export const WorldOutposts = () => {
  const showcase = useGame((s) => hasMarshContainment(s.world));
  const paths = useGame((s) => s.world.paths);
  const outposts = useGame((s) => s.world.outposts);
  const clusters = useMemo<PlacedOutpost[]>(
    () =>
      outposts
        .filter(() => !showcase)
        .map((o) => {
          const template = OUTPOST_BY_ID[o.templateId];
          if (!template) return null;
          return { template, pos: o.pos, yaw: o.yaw, scale: o.scale };
        })
        .filter((c): c is PlacedOutpost => c !== null),
    [outposts, showcase],
  );
  return (
    <>
      <OutpostClusters clusters={clusters} />
      {showcase && <ContainmentCompound outposts={outposts} paths={paths} />}
    </>
  );
};
