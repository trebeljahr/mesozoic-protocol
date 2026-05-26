import { type BakeSpec, useBakedIcon } from "../ui/bakedIcon";

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

export const PropPreview = ({ url, size = 38 }: { url: string; size?: number }) => {
  const png = useBakedIcon({
    cacheKey: `prop:${url}`,
    modelUrl: url,
    skinned: false,
    camera: PROP_CAMERA,
  });
  return (
    <div style={swatch(size)}>
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
