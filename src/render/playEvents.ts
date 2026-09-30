import { events, type RootState } from "@react-three/fiber";
import { useEditor } from "../editor/editorStore";
import { useGame } from "../store";
import { prioritizePlayHits } from "./interactionPriority";

export function playEvents(root: Parameters<typeof events>[0]) {
  const manager = events(root);
  let contextMenu = false;
  return {
    ...manager,
    compute: (event: Parameters<NonNullable<typeof manager.compute>>[0], state: RootState) => {
      contextMenu = event.type === "contextmenu" || event.button === 2;
      manager.compute?.(event, state);
    },
    filter: (hits: Parameters<typeof prioritizePlayHits>[0]) => {
      const state = useGame.getState();
      if (useEditor.getState().active || state.screen !== "playing") return hits;
      const ground = hits.find((hit) => hit.object.userData.placementPlane === true);
      const pos = ground && { x: ground.point.x, y: -ground.point.z };
      const tower = state.world.towerById.get(state.world.selectedTowerId ?? -1);
      return prioritizePlayHits(hits, {
        groundCommand:
          !!state.world.robot.dashAim ||
          (!contextMenu &&
            (state.selectedKind !== null ||
              (tower?.kind === "mortar" && tower.targetingMode === "spot"))),
        friendlyAtGround: !!pos && (!!state.towerAtPos(pos) || state.hqAtPos(pos)),
        robotAlive: state.world.robot.alive,
        robotMoving: state.world.robot.selected,
        contextMenu,
      });
    },
  };
}
