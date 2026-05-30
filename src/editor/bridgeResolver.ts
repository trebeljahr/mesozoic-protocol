import { nanoid } from "nanoid";
import { computeBridgesWithProvenance } from "../flowGeometry";
import type { AutoBridge, River, Vec2 } from "../sim/types";

// Editor-side bridge book-keeping. The renderer used to derive bridges
// fresh every frame from `computeBridges(paths, rivers)`, which:
//  - regenerated bridge instances every commit, defeating any future
//    user override (drag, custom radius, custom material),
//  - threw away which rivers fed the bridge, so the renderer couldn't
//    pick a material-appropriate deck palette,
//  - had no persistence, so authored bridges couldn't survive a reload.
//
// `resolveBridges` is the single point that turns the live (paths, rivers)
// pair into a stable list of AutoBridge with persistent ids. Called from
// `commitRivers` in editorCore, fed back into the EditorSource, and read
// by render/AutoBridges.

// Key a bridge by its kind, contributing river ids (sorted, so two paths'
// arrival order doesn't matter), and a coarse-grained position rounded
// to a tenth of a world unit. The position rounding is what lets a bridge
// survive small wiggles as the user drags an interior river point — a
// crossing roughly in the same place keeps its id and any user overrides.
export const bridgeKey = (b: {
  kind: AutoBridge["kind"];
  pos: Vec2;
  riverIds: string[];
}): string => {
  const ids = [...b.riverIds].sort().join(",");
  const x = Math.round(b.pos.x * 10) / 10;
  const y = Math.round(b.pos.y * 10) / 10;
  return `${b.kind}|${ids}|${x},${y}`;
};

// Material the bridge should render with: pull from the river whose id
// sorts first in riverIds so the choice is deterministic across commits.
// A bridge fed by multiple rivers of different materials still picks one
// stable answer rather than flickering as inputs reorder.
const pickMaterial = (riverIds: string[], rivers: River[]): AutoBridge["material"] => {
  if (riverIds.length === 0) return "water";
  const sorted = [...riverIds].sort();
  const byId = new Map(rivers.map((r) => [r.id, r] as const));
  for (const id of sorted) {
    const r = byId.get(id);
    if (r) return r.material ?? "water";
  }
  return "water";
};

export const resolveBridges = (
  paths: Vec2[][],
  rivers: River[],
  existing: AutoBridge[],
): AutoBridge[] => {
  // No paths or no rivers means no bridges possible. Still allow the
  // user-override path through (preserved only if its river still
  // exists), but the fresh-bridge list is just empty.
  const fresh =
    paths.length > 0 && rivers.length > 0 ? computeBridgesWithProvenance(paths, rivers) : [];
  const liveRiverIds = new Set(rivers.map((r) => r.id));
  const existingByKey = new Map(
    existing.map(
      (b) => [bridgeKey({ kind: b.kind, pos: b.pos, riverIds: b.riverIds }), b] as const,
    ),
  );
  const freshKeys = new Set<string>();
  const out: AutoBridge[] = [];
  for (const f of fresh) {
    const material = pickMaterial(f.riverIds, rivers);
    const key = bridgeKey({ kind: f.kind, pos: f.pos, riverIds: f.riverIds });
    freshKeys.add(key);
    const prior = existingByKey.get(key);
    if (prior && prior.kind === f.kind) {
      // Preserve user-edited geometry if the user flagged it.
      if (prior.userOverride) {
        if (f.kind === "rect" && prior.kind === "rect") {
          out.push({
            id: prior.id,
            riverIds: f.riverIds,
            material,
            userOverride: true,
            kind: "rect",
            pos: prior.pos,
            rotY: prior.rotY,
            length: prior.length,
          });
          continue;
        }
        if (f.kind === "plaza" && prior.kind === "plaza") {
          out.push({
            id: prior.id,
            riverIds: f.riverIds,
            material,
            userOverride: true,
            kind: "plaza",
            pos: prior.pos,
            radius: prior.radius,
          });
          continue;
        }
      }
      // Same crossing, no user override — keep the id but refresh geom.
      if (f.kind === "rect") {
        out.push({
          id: prior.id,
          riverIds: f.riverIds,
          material,
          userOverride: false,
          kind: "rect",
          pos: f.pos,
          rotY: f.rotY,
          length: f.length,
        });
      } else {
        out.push({
          id: prior.id,
          riverIds: f.riverIds,
          material,
          userOverride: false,
          kind: "plaza",
          pos: f.pos,
          radius: f.radius,
        });
      }
      continue;
    }
    // New crossing — mint a stable id.
    if (f.kind === "rect") {
      out.push({
        id: nanoid(8),
        riverIds: f.riverIds,
        material,
        userOverride: false,
        kind: "rect",
        pos: f.pos,
        rotY: f.rotY,
        length: f.length,
      });
    } else {
      out.push({
        id: nanoid(8),
        riverIds: f.riverIds,
        material,
        userOverride: false,
        kind: "plaza",
        pos: f.pos,
        radius: f.radius,
      });
    }
  }
  // User-override bridges hang on across commits even when the underlying
  // crossing geometry shifts a hair — but only as long as every river they
  // attribute to still exists. Drop them once the underlying river is gone.
  for (const e of existing) {
    if (!e.userOverride) continue;
    const key = bridgeKey({ kind: e.kind, pos: e.pos, riverIds: e.riverIds });
    if (freshKeys.has(key)) continue;
    const stillLive = e.riverIds.every((id) => liveRiverIds.has(id));
    if (!stillLive) continue;
    out.push(e);
  }
  return out;
};
