import { expect, it } from "vitest";
import { lakeNorm, snapIntoLake } from "../editor/editorCore";
import { lakeDistance } from "../lakeShape";
import { makeLakeGeometry } from "./lakeGeometry";

it("keeps rotated mesh shores, terrain banks, and editor hit tests aligned", () => {
  const lake = { id: "test", pos: { x: 4, y: -3 }, rx: 6, ry: 2, rot: 0.7 };
  const shape = { ...lake, x: lake.pos.x, y: lake.pos.y };
  const geometry = makeLakeGeometry();
  const positions = geometry.getAttribute("position");
  const radii: number[] = [];
  for (let i = 1; i < positions.count; i++) {
    const lx = positions.getX(i) * lake.rx,
      ly = positions.getY(i) * lake.ry;
    const dx = lx * Math.cos(lake.rot) - ly * Math.sin(lake.rot);
    const dy = lx * Math.sin(lake.rot) + ly * Math.cos(lake.rot);
    const x = lake.pos.x + dx,
      y = lake.pos.y + dy;
    expect(lakeDistance(shape, x, y)).toBeCloseTo(0, 5);
    expect(lakeNorm(lake, x, y)).toBeCloseTo(1, 5);
    const mouth = snapIntoLake(lake, { x: lake.pos.x + dx * 2, y: lake.pos.y + dy * 2 });
    expect(lakeNorm(lake, mouth.x, mouth.y)).toBeLessThan(0.73);
    radii.push(Math.hypot(positions.getX(i), positions.getY(i)));
  }
  expect(Math.max(...radii)).toBeLessThan(1);
  expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.25);
  geometry.dispose();
});
