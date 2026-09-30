import { expect, it, vi } from "vitest";

vi.mock("../demo", () => ({ IS_DEMO: true, isLevelBeyondDemo: (id: number) => id > 5 }));

import { emptyProgress } from "../progress";
import { isMapLevelDiscovered, mapDiscovery } from "./worldMapDiscovery";

it("keeps the full campaign concealed after the demo is complete, even with an imported full save", () => {
  const p = emptyProgress();
  for (let id = 1; id <= 30; id++) p.starsByLevel[id] = { normal: 3, breach: 1, containment: 1 };
  expect(isMapLevelDiscovered(5, p)).toBe(true);
  expect(isMapLevelDiscovered(6, p)).toBe(false);
  const discovery = mapDiscovery(p);
  expect(discovery.complete).toBe(false);
  expect(discovery.radii.slice(5).every((radius) => radius === 0)).toBe(true);
});
