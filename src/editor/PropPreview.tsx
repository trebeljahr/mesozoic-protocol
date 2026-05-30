import { useEffect, useRef, useState } from "react";
import { type BakeSpec, prewarmIcon, useBakedIcon } from "../ui/bakedIcon";

// Dev-only thumbnail for an editor palette entry. Re-uses the shared
// bakedIcon offscreen renderer so every prop GLB gets baked once and the
// resulting PNG is shared across both editor palettes (LevelEditorPanel /
// WorldMapEditorPanel). No r3f Canvas per swatch — the offscreen pipeline
// is the only thing keeping the picker from blowing past the browser's
// WebGL-context cap when ~100 biome assets render at once.

// 3/4 view framed slightly above the ground plane. The bakedIcon pipeline
// normalizes every model to a 1×1×1 cube grounded at y=0, so this single
// camera works across trees, rocks, buildings, and cosmetic props alike.
const PROP_CAMERA: BakeSpec["camera"] = {
  position: [2.1, 1.4, 1.7],
  target: [0, 0.45, 0],
  fov: 30,
};

// Four orbit yaw stops the hover cycle steps through. Quarter-turns give
// each asset a front/side/back/other-side glance without bloating the
// bake cache — each angle is keyed independently so the renderer
// produces them lazily on first hover and reuses thereafter.
const ANGLES: { yaw: number }[] = [
  { yaw: 0 },
  { yaw: Math.PI / 2 },
  { yaw: Math.PI },
  { yaw: -Math.PI / 2 },
];

const HOVER_CYCLE_MS = 600;

const swatch = (size: number): React.CSSProperties => ({
  width: size,
  height: size,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(255,255,255,0.05)",
  borderRadius: 4,
  flexShrink: 0,
  overflow: "hidden",
});

/**
 * Kick off bakes for angles 1..3 of a prop. The resting angle (0) is
 * already requested by the mounted swatch, so prewarming the other three
 * once on hover-start primes the cache without doubling work on first
 * paint. Safe to call repeatedly — bakedIcon dedupes per cacheKey.
 */
export const prewarmPropAngles = (url: string): void => {
  for (let i = 1; i < ANGLES.length; i++) {
    prewarmIcon({
      cacheKey: `prop:${url}:a${i}`,
      modelUrl: url,
      skinned: false,
      camera: PROP_CAMERA,
      rotY: ANGLES[i].yaw,
    });
  }
};

export const PropPreview = ({
  url,
  size = 38,
  angleIndex: angleIndexProp = 0,
}: {
  url: string;
  size?: number;
  angleIndex?: number;
}) => {
  // Hover-driven cycle through ANGLES — the prop is the resting baseline
  // (defaults to 0); pointerEnter/focus starts a setInterval that
  // advances the index every HOVER_CYCLE_MS, pointerLeave/blur clears
  // it and snaps back to the prop. The interval ref doubles as a guard
  // against duplicate intervals when focus/pointer events overlap.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const angleIndex = hoverIndex ?? angleIndexProp;

  const stop = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setHoverIndex(null);
  };

  const start = () => {
    if (intervalRef.current !== null) return;
    prewarmPropAngles(url);
    setHoverIndex(0);
    intervalRef.current = window.setInterval(() => {
      setHoverIndex((i) => ((i ?? 0) + 1) % ANGLES.length);
    }, HOVER_CYCLE_MS);
  };

  // Clear the interval on unmount so it doesn't fire after the swatch
  // filters out of the search results (the leave handler doesn't run
  // when React removes the node from the DOM).
  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const png = useBakedIcon({
    cacheKey: `prop:${url}:a${angleIndex}`,
    modelUrl: url,
    skinned: false,
    camera: PROP_CAMERA,
    rotY: ANGLES[angleIndex].yaw,
  });
  return (
    <div
      style={swatch(size)}
      onPointerEnter={start}
      onPointerLeave={stop}
      onFocus={start}
      onBlur={stop}
    >
      {png ? (
        <img
          src={png}
          alt=""
          aria-hidden
          width={size}
          height={size}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : null}
    </div>
  );
};
