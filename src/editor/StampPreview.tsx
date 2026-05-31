import type { ReactElement } from "react";
import { PropPreview } from "./PropPreview";

// Composite thumbnail for a saved stamp — a 2×2 tile of up to four child
// PropPreviews so the palette swatch hints at the stamp's contents at a
// glance without bloating the bake cache (PropPreview already dedupes per
// url via the shared bakedIcon pipeline). When the stamp carries more than
// four children, a "+N" chip in the bottom-right corner surfaces the
// overflow — same visual language as a tab badge.

const tileContainer = (size: number): React.CSSProperties => ({
  position: "relative",
  width: size,
  height: size,
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gridTemplateRows: "1fr 1fr",
  gap: 1,
  background: "rgba(255,255,255,0.05)",
  borderRadius: 4,
  overflow: "hidden",
  flexShrink: 0,
});

const overflowChip: React.CSSProperties = {
  position: "absolute",
  right: 2,
  bottom: 2,
  padding: "0 4px",
  borderRadius: 3,
  background: "rgba(14,16,22,0.85)",
  color: "#d7deea",
  fontSize: 9,
  fontWeight: 700,
  lineHeight: "12px",
  border: "1px solid rgba(255,255,255,0.18)",
  pointerEvents: "none",
};

export const StampPreview = ({
  sampleUrls,
  childCount,
  size = 56,
}: {
  sampleUrls: string[];
  childCount: number;
  size?: number;
}): ReactElement => {
  // The grid is fixed at 2×2 — pad short stamps with blank cells so the tile
  // shape is consistent regardless of child count.
  const cells = Array.from({ length: 4 }, (_, i) => sampleUrls[i] ?? null);
  const cellSize = Math.floor((size - 1) / 2);
  const overflow = childCount > 4 ? childCount - 4 : 0;
  return (
    <div style={tileContainer(size)}>
      {cells.map((url, i) =>
        url ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: stamp cells are a fixed 2×2 grid keyed by slot, not by url (the same url can appear in multiple cells of one stamp)
          <PropPreview key={`cell-${i}`} url={url} size={cellSize} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: padding cells have no stable identity
          <div key={`pad-${i}`} style={{ width: cellSize, height: cellSize }} />
        ),
      )}
      {overflow > 0 && <span style={overflowChip}>+{overflow}</span>}
    </div>
  );
};
