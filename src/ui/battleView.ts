import { create } from "zustand";
// Transient display state only; never persisted in a save or mission checkpoint.
export const useBattleView = create<{
  previewOpen: boolean;
  previewLane: number | null;
  setPreviewOpen: (open: boolean) => void;
  setPreviewLane: (lane: number | null) => void;
}>((set) => ({
  previewOpen: false,
  previewLane: null,
  setPreviewOpen: (previewOpen) => set({ previewOpen, previewLane: null }),
  setPreviewLane: (previewLane) => set({ previewLane }),
}));
