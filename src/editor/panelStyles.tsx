import type { CSSProperties, ReactElement } from "react";

// Shared dev-only editor panel styles + pencil icon. Lives alongside
// EditorPanel.tsx so both editor wrappers draw from a single visual
// vocabulary. Side-effect free so the whole editor surface stays
// tree-shakeable behind import.meta.env.DEV.

export const panel: CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  bottom: 8,
  width: 340,
  zIndex: 10000,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  gap: 8,
  padding: 10,
  background: "rgba(14,16,22,0.94)",
  border: "1px solid #3a4150",
  borderRadius: 8,
  color: "#e6e9ef",
  font: "12px/1.4 system-ui, sans-serif",
  boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarGutter: "stable",
  touchAction: "pan-y",
  overscrollBehavior: "contain",
  // Explicit so the panel always swallows pointer events (and the
  // EditorPanel's onPointerDownCapture stopper actually has a target). If a
  // parent ever sets pointerEvents: none, panel clicks would otherwise leak
  // straight to the canvas / document-level drag gate.
  pointerEvents: "auto",
};

export const miniPanel: CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  gap: 6,
  maxWidth: "calc(100vw - 16px)",
  padding: 8,
  background: "rgba(14,16,22,0.94)",
  border: "1px solid #3a4150",
  borderRadius: 8,
  color: "#e6e9ef",
  font: "12px/1.2 system-ui, sans-serif",
  boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
  pointerEvents: "auto",
};

export const btn = (on = false): CSSProperties => ({
  padding: "5px 8px",
  borderRadius: 5,
  border: `1px solid ${on ? "#6aa9ff" : "#3a4150"}`,
  background: on ? "#1d3a66" : "#1a1f29",
  color: "#e6e9ef",
  cursor: "pointer",
  fontSize: 12,
});

export const dangerBtn: CSSProperties = {
  ...btn(),
  borderColor: "#7a3a3a",
  background: "#3a1c1c",
};

// Compact palette swatch — preview thumbnail above a truncated label. Fixed
// width so the palette grid wraps cleanly across role groups.
export const swatchBtn = (on = false): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  padding: 4,
  width: 80,
  borderRadius: 5,
  border: `1px solid ${on ? "#6aa9ff" : "#3a4150"}`,
  background: on ? "#1d3a66" : "#1a1f29",
  color: "#e6e9ef",
  cursor: "pointer",
  fontSize: 9,
  lineHeight: 1.15,
});

export const swatchLabel: CSSProperties = {
  width: "100%",
  textAlign: "center",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// Brush slider grid — label left, range middle, value right.
export const sliderRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "70px 1fr 36px",
  alignItems: "center",
  gap: 6,
};

export const fab: CSSProperties = {
  position: "fixed",
  left: "calc(10px + env(safe-area-inset-left, 0px))",
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 11px",
  borderRadius: 7,
  border: "1px solid #3a4150",
  background: "rgba(14,16,22,0.92)",
  color: "#e6e9ef",
  cursor: "pointer",
  font: "12px/1 system-ui, sans-serif",
};

export const PencilIcon = (): ReactElement => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
  >
    <title>Edit</title>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
