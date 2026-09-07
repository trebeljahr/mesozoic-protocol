import { beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_BRUSH_PRESETS, footprintArea, patchAreaBudget, resolveBrushUrls } from "./brush";
import { createEditorStore, type EditorSource, propRadius } from "./editorCore";

// End-to-end check of the accumulating brush against the real store: paint
// the same spot over and over and assert the patch thickens pass by pass
// instead of landing on its final density in one tick.

const treePreset = BUILTIN_BRUSH_PRESETS.find((p) => p.id === "forest-tree");
if (!treePreset) throw new Error("forest-tree preset missing");

const emptySource = (): EditorSource => ({
  props: [],
  override: true,
  rivers: [],
  bridges: [],
  easterEggs: [],
  erasedProcedural: [],
});

let source: EditorSource;
const store = createEditorStore(() => ({
  getCurrent: () => source,
  commit: (next) => {
    source = next;
  },
  exportJson: () => "{}",
}));

const armBrush = (over: Partial<{ radius: number; density: number; maxFill: number }> = {}) => {
  // setBrushPreset toggles, so disarm first — re-arming the same preset
  // would otherwise turn the brush off.
  store.getState().setBrushPreset(null);
  store.getState().setBrushPreset("forest-tree");
  store.getState().setBrushParams({ radius: 4, density: 3, maxFill: 55, ...over });
};

const paintPasses = (n: number, x = 0, y = 0): number[] => {
  const counts: number[] = [];
  store.getState().beginStroke();
  for (let i = 0; i < n; i++) {
    store.getState().paintAt(x, y);
    counts.push(source.props.length);
  }
  store.getState().endStroke();
  return counts;
};

describe("accumulating scatter brush", () => {
  beforeEach(() => {
    source = emptySource();
    store.getState().setBrushPreset(null);
  });

  it("adds at most `density` instances per pass", () => {
    armBrush({ density: 3 });
    const counts = paintPasses(4);
    let prev = 0;
    for (const c of counts) {
      expect(c - prev).toBeLessThanOrEqual(3);
      prev = c;
    }
  });

  it("keeps thickening the same patch over repeated passes", () => {
    armBrush({ density: 3 });
    const counts = paintPasses(6);
    // Not saturated on pass one: the patch is meaningfully denser later in
    // the stroke than it was after the first tick.
    expect(counts[0]).toBeLessThanOrEqual(3);
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0]);
  });

  it("levels off at the fill ceiling instead of growing without bound", () => {
    armBrush({ density: 3, maxFill: 55 });
    paintPasses(60);
    const budget = patchAreaBudget(4, 55);
    let covered = 0;
    for (const p of source.props) {
      // Only props whose centre is inside the disc count toward the patch,
      // matching paintAt's own coverage probe.
      if (Math.hypot(p.pos.x, p.pos.y) <= 4) {
        covered += footprintArea(Math.max(propRadius(p.url, p.scale), 1.0));
      }
    }
    // One accepted candidate may straddle the ceiling, so allow a single
    // instance of overshoot above the budget.
    expect(covered).toBeLessThan(budget + footprintArea(propRadius(source.props[0].url, 1.4)));
    const before = source.props.length;
    paintPasses(10);
    expect(source.props.length).toBe(before);
  });

  it("a higher fill ceiling accumulates to a denser patch", () => {
    armBrush({ density: 3, maxFill: 20 });
    paintPasses(40);
    const sparse = source.props.length;
    source = emptySource();
    armBrush({ density: 3, maxFill: 80 });
    paintPasses(40);
    expect(source.props.length).toBeGreaterThan(sparse);
  });

  it("thins the patch back out with the Alt modifier", () => {
    armBrush({ density: 3 });
    paintPasses(30);
    const grown = source.props.length;
    expect(grown).toBeGreaterThan(3);
    store.getState().beginStroke();
    store.getState().paintAt(0, 0, { thin: true });
    store.getState().endStroke();
    const thinned = source.props.length;
    expect(thinned).toBeLessThan(grown);
    expect(grown - thinned).toBeLessThanOrEqual(3);
    // Repeated thinning passes eventually clear the patch.
    store.getState().beginStroke();
    for (let i = 0; i < 40; i++) store.getState().paintAt(0, 0, { thin: true });
    store.getState().endStroke();
    expect(source.props.filter((p) => Math.hypot(p.pos.x, p.pos.y) <= 4)).toHaveLength(0);
  });

  it("thinning leaves props the active preset can't paint alone", () => {
    armBrush({ density: 3 });
    paintPasses(20);
    const foreign = {
      id: "foreign",
      url: "/models/not-a-brush-asset.glb",
      pos: { x: 0.5, y: 0.5 },
      scale: 1,
      rot: 0,
      blocks: true,
    };
    source = { ...source, props: [...source.props, foreign] };
    store.getState().beginStroke();
    for (let i = 0; i < 40; i++) store.getState().paintAt(0, 0, { thin: true });
    store.getState().endStroke();
    expect(source.props.map((p) => p.id)).toContain("foreign");
  });

  it("respects the resolved url roster when scattering", () => {
    armBrush({ density: 3 });
    paintPasses(10);
    const roster = new Set(resolveBrushUrls(treePreset, null));
    for (const p of source.props) expect(roster.has(p.url)).toBe(true);
  });
});
