import { describe, expect, it } from "vitest";
import { isLightningBeam, lightningEnvelope, writeLightningSegment } from "./lightningGeometry";

describe("lightning render contract", () => {
  it("routes tower and robot electricity without swallowing warm ballistics", () => {
    for (const color of ["#9fd8ff", "#7ee0ff", "#cfe8ff", "#9beaff"])
      expect(isLightningBeam(color)).toBe(true);
    expect(isLightningBeam("#ffe9a0")).toBe(false);
  });
  it("extinguishes at simulation expiry and restrikes before fading", () => {
    expect(lightningEnvelope(0)).toBe(0);
    expect(lightningEnvelope(-1)).toBe(0);
    expect(lightningEnvelope(0.06)).toBeLessThan(lightningEnvelope(0.04));
    expect(lightningEnvelope(0.001)).toBeLessThan(lightningEnvelope(0.02));
  });
  it("faces outward so default front-face culling preserves the tube", () => {
    const p = new Float32Array(54);
    writeLightningSegment(p, new Float32Array(54), 0, 0, 0, 0, 1, 0, 0, 0.1, 0.1, 1, 1, 1);
    for (let triangle = 0; triangle < 6; triangle++) {
      const i = triangle * 9;
      const uy = p[i + 4] - p[i + 1],
        uz = p[i + 5] - p[i + 2];
      const ux = p[i + 3] - p[i];
      const vx = p[i + 6] - p[i],
        vy = p[i + 7] - p[i + 1],
        vz = p[i + 8] - p[i + 2];
      const ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const cy = p[i + 1] + p[i + 4] + p[i + 7];
      const cz = p[i + 2] + p[i + 5] + p[i + 8];
      expect(ny * cy + nz * cz).toBeGreaterThan(0);
    }
  });
  it.each([
    [4, 2, -3],
    [0, 5, 0],
    [0, 0, 0],
  ])("keeps geometry finite and inside its pool slot for %j", (x, y, z) => {
    const positions = new Float32Array(162).fill(99);
    const colors = new Float32Array(162).fill(99);
    writeLightningSegment(positions, colors, 1, 0, 0, 0, x, y, z, 0.03, 0.01, 4, 3, 2);
    expect([...positions].every(Number.isFinite)).toBe(true);
    expect([...positions.slice(0, 54), ...positions.slice(108)].every((v) => v === 99)).toBe(true);
    expect(colors[54]).toBe(4); // HDR energy is not clamped to display RGB.
    // Both tube rings are centered on the simulation endpoints.
    for (const end of [false, true]) {
      const sum = [0, 0, 0];
      let count = 0;
      for (let v = 0; v < 18; v++) {
        const k = v % 6;
        if ((k === 2 || k === 4 || k === 5) !== end) continue;
        for (let axis = 0; axis < 3; axis++) sum[axis] += positions[54 + v * 3 + axis];
        count++;
      }
      for (let axis = 0; axis < 3; axis++)
        expect(sum[axis] / count).toBeCloseTo(end ? [x, y, z][axis] : 0, 5);
    }
  });
});
