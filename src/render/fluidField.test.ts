import { describe, expect, it } from "vitest";
import { buildFluidField, type FluidField } from "./fluidField";

function pixel(field: FluidField, x: number, y: number) {
  const { data, width, height } = field.texture.image;
  const b = field.bounds;
  const ix = Math.min(width - 1, Math.max(0, Math.floor(((x - b.x) / b.z) * width)));
  const iy = Math.min(height - 1, Math.max(0, Math.floor(((y - b.y) / b.w) * height)));
  const offset = (iy * width + ix) * 4;
  return Array.from(data.slice(offset, offset + 3));
}

describe("fluid union field", () => {
  it("removes the internal bank at a river entering a lake", () => {
    const river = {
      points: [
        { x: -5, y: 0 },
        { x: 2, y: 0 },
      ],
      width: 2,
    };
    const lake = { x: 1, y: 0, rx: 3, ry: 3, rot: 0 };
    const separate = buildFluidField([river], []);
    const joined = buildFluidField([river], [lake]);
    expect(pixel(separate, 0, 0.95)[0]).toBeLessThan(25);
    expect(pixel(joined, 0, 0.95)[0]).toBeGreaterThan(240);
    expect(pixel(joined, 0, 4)[0]).toBe(0);
    separate.texture.dispose();
    joined.texture.dispose();
  });

  it("uses simulation-space ellipse rotation and render-space flow direction", () => {
    const field = buildFluidField(
      [
        {
          points: [
            { x: 5, y: -3 },
            { x: 5, y: 3 },
          ],
          width: 2,
        },
      ],
      [{ x: 0, y: 0, rx: 3, ry: 1, rot: Math.PI / 2 }],
    );
    expect(pixel(field, 0, 2)[0]).toBeGreaterThan(30);
    expect(pixel(field, 2, 0)[0]).toBe(0);
    expect(pixel(field, 5, 0)[2]).toBe(0);
    field.texture.dispose();
  });

  it("handles empty and duplicate-point input with bounded GPU storage", () => {
    const empty = buildFluidField([], []);
    expect(pixel(empty, 0, 0)[0]).toBe(0);
    const huge = buildFluidField(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 2000, y: 2000 },
          ],
          width: 2,
        },
      ],
      [],
    );
    expect(huge.texture.image.width).toBeLessThanOrEqual(512);
    expect(huge.texture.image.height).toBeLessThanOrEqual(512);
    empty.texture.dispose();
    huge.texture.dispose();
  });
});
