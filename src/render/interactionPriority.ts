import type { Intersection, Object3D } from "three";

export function towerHitId(object: Object3D): number | undefined {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (typeof node.userData.towerId === "number") return node.userData.towerId;
  }
}

export type InteractionIntent = {
  groundCommand: boolean;
  friendlyAtGround: boolean;
  robotAlive: boolean;
  robotMoving: boolean;
  contextMenu: boolean;
};

// Resolve intent before R3F dispatches any handlers. A nearer dinosaur,
// corpse or prop must not consume a command meant for a friendly unit.
export function prioritizePlayHits(
  hits: Intersection[],
  intent: InteractionIntent,
): Intersection[] {
  const ground = hits.find((hit) => hit.object.userData.placementPlane === true);
  if (ground && intent.groundCommand) return [ground];
  if (intent.contextMenu) return hits;
  const tower = hits.find((hit) => towerHitId(hit.object) !== undefined);
  if (tower) return [tower];
  if (ground && intent.friendlyAtGround) return [ground];
  const robot = hits.find((hit) => hit.object.userData.robotProxy === true);
  if (robot && intent.robotAlive) return [robot];
  if (ground && intent.robotMoving) return [ground];
  return hits;
}
