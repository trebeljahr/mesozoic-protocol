import { useGame } from "../store";
import { downloadJson } from "./download";
import { EditorPanel, type FooterButton } from "./EditorPanel";
import { clearAllLevels, exportAllLevelsJson, useEditor } from "./editorStore";

// Dev-only level-editor side panel. Thin wrapper over the shared EditorPanel —
// supplies the level-editor store, per-level title, and the level-editor's
// footer buttons (copy / download level / download all levels / re-roll
// procedural / clear procedural / clear hand-placed / clear all / clear all
// levels with confirm). Mounted in App.tsx behind import.meta.env.DEV.
export const LevelEditorPanel = () => {
  const levelId = useGame((s) => s.world.levelId);
  // Lock the asset palette + brush presets to this level's biome by default.
  // EditorPanel exposes an "All biomes" toggle to escape the filter per
  // session if the user wants to mix in a foreign biome's prop.
  const biome = useGame((s) => s.world.biome);

  const onDownload = () => {
    downloadJson(`mz-level-${levelId}.json`, useEditor.getState().exportJson());
  };

  const onDownloadAll = () => {
    downloadJson("mz-all-levels.json", exportAllLevelsJson());
  };

  const onClearAll = () => {
    if (
      !window.confirm(
        "Clear hand-placed props and rivers for EVERY level? This is irreversible (history is per-session).",
      )
    ) {
      return;
    }
    clearAllLevels();
  };

  const exportButtons: FooterButton[] = [
    { label: "Download", title: `Download mz-level-${levelId}.json`, onClick: onDownload },
    {
      label: "Download all",
      title: "Download every level's edits in one file",
      onClick: onDownloadAll,
    },
  ];

  // Generation is deterministic in the procedural seed, so a landscape you
  // like can be pinned by writing its seed number back into the level data.
  // Re-rolling until it looks right and then reading the seed off this
  // prompt is the intended authoring loop.
  const onSetSeed = () => {
    const current = useGame.getState().world.proceduralSeed;
    const answer = window.prompt(
      `Procedural seed for L${levelId} — same seed regenerates the same landscape.`,
      String(current),
    );
    if (answer === null) return;
    const parsed = Number(answer.trim());
    if (!Number.isFinite(parsed)) {
      window.alert(`"${answer}" is not a number.`);
      return;
    }
    useEditor.getState().reloadProcedural(Math.floor(parsed));
  };

  const clearButtons: FooterButton[] = [
    {
      label: "Re-roll procedural",
      title: `Pick a new procedural seed and regenerate procedural set-dressing on L${levelId} (hand-placed props preserved). Undoable.`,
      onClick: () => useEditor.getState().reloadProcedural(),
    },
    {
      label: "Set seed…",
      title: `Regenerate L${levelId}'s procedural landscape from a specific seed (reproducible). Undoable.`,
      onClick: onSetSeed,
    },
    {
      label: "Clear procedural",
      title: `Suppress procedural set-dressing on L${levelId} (hand-placed props preserved). Undoable.`,
      onClick: () => useEditor.getState().clearProcedural(),
    },
    {
      label: "Clear hand-placed",
      title: `Wipe hand-placed props and rivers on L${levelId} (procedural set-dressing preserved). Undoable.`,
      onClick: () => useEditor.getState().clearManual(),
    },
    {
      label: "Clear all",
      title: `Wipe BOTH hand-placed and procedural set-dressing on L${levelId} (path + base tower preserved). Undoable.`,
      onClick: () => useEditor.getState().clear(),
    },
    {
      label: "Clear all levels",
      title: "Wipe authored props on EVERY level (irreversible)",
      onClick: onClearAll,
    },
  ];

  return (
    <EditorPanel
      store={useEditor}
      title={`Level Editor · L${levelId}`}
      fabLabel="Edit Level"
      fabTitle="Open level editor (dev only)"
      copyButton={{
        title: "Copy JSON to clipboard",
        logExport: (json) => console.log("[level-editor] export L%d:\n%s", levelId, json),
      }}
      exportButtons={exportButtons}
      clearButtons={clearButtons}
      biomeFilter={biome}
    />
  );
};
