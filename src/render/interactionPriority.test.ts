import { type Intersection, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { type InteractionIntent, prioritizePlayHits } from "./interactionPriority";

const hit = (data = {}): Intersection => {
  const object = new Object3D();
  object.userData = data;
  return { object, point: new Vector3(), distance: 1 };
};
const ground = hit({ placementPlane: true });
const robot = hit({ robotProxy: true });
const corpse = hit({ corpseClickBlocker: true });
const dino = hit({ enemyId: 1 });
const intent: InteractionIntent = {
  groundCommand: false,
  friendlyAtGround: false,
  robotAlive: true,
  robotMoving: false,
  contextMenu: false,
};

describe("playfield overlap priority", () => {
  it("selects a tower footprint beneath dinosaurs and corpses", () => {
    expect(
      prioritizePlayHits([corpse, dino, ground], { ...intent, friendlyAtGround: true }),
    ).toEqual([ground]);
  });
  it("selects the visible tower model even outside its ground footprint", () => {
    const tower = hit();
    const root = new Object3D();
    root.userData.towerId = 7;
    root.add(tower.object);
    expect(prioritizePlayHits([dino, tower, ground], intent)).toEqual([tower]);
  });
  it("selects the robot through a corpse and dinosaur", () => {
    expect(prioritizePlayHits([corpse, dino, robot, ground], intent)).toEqual([robot]);
  });
  it("routes placement and aimed abilities to ground despite overlapping units", () => {
    expect(
      prioritizePlayHits([corpse, dino, robot, ground], { ...intent, groundCommand: true }),
    ).toEqual([ground]);
  });
  it("moves the selected robot through corpses and props", () => {
    expect(
      prioritizePlayHits([corpse, hit(), dino, ground], { ...intent, robotMoving: true }),
    ).toEqual([ground]);
  });
  it("still permits clicking the selected robot to deselect it", () => {
    expect(prioritizePlayHits([corpse, robot, ground], { ...intent, robotMoving: true })).toEqual([
      robot,
    ]);
  });
  it("preserves right-click inspection unless cancelling an aimed ability", () => {
    const hits = [dino, ground];
    expect(prioritizePlayHits(hits, { ...intent, robotMoving: true, contextMenu: true })).toBe(
      hits,
    );
    expect(prioritizePlayHits(hits, { ...intent, groundCommand: true, contextMenu: true })).toEqual(
      [ground],
    );
  });
  it("preserves passive corpse shielding and ignores dead robot proxies", () => {
    const hits = [corpse, dino, robot, ground];
    expect(prioritizePlayHits(hits, { ...intent, robotAlive: false })).toBe(hits);
  });
});
