import { useGame } from "../store";
import { downloadJson } from "./download";
import { EditorPanel, type FooterButton } from "./EditorPanel";
import { clearAllLevels, exportAllLevelsJson, useEditor } from "./editorStore";

// Dev-only level-editor side panel. Thin wrapper over the shared EditorPanel —
// supplies the level-editor store, per-level title, and the level-editor's
// footer buttons (copy / download level / download all levels / reload
// procedural / clear procedural / clear manual / clear level / clear all
// levels with confirm). Mounted in App.tsx behind import.meta.env.DEV.
export const LevelEditorPanel = () => {
  const levelId = useGame((s) => s.world.levelId);

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

  const clearButtons: FooterButton[] = [
    {
      label: "Reload procedural",
      title: `Pick a new procedural seed and regenerate procedural set-dressing on L${levelId} (hand-placed props preserved)`,
      onClick: () => useEditor.getState().reloadProcedural(),
    },
    {
      label: "Clear procedural",
      title: `Suppress procedural set-dressing on L${levelId} (hand-placed props preserved)`,
      onClick: () => useEditor.getState().clearProcedural(),
    },
    {
      label: "Clear manual",
      title: `Wipe hand-placed props and rivers on L${levelId} (procedural set-dressing preserved)`,
      onClick: () => useEditor.getState().clearManual(),
    },
    {
      label: "Clear level",
      title: `Wipe BOTH hand-placed and procedural set-dressing on L${levelId} (path + base tower preserved)`,
      onClick: () => {
        if (
          !window.confirm(
            `Clear BOTH hand-placed and procedural set-dressing on L${levelId}? Path and base tower are preserved.`,
          )
        ) {
          return;
        }
        useEditor.getState().clear();
      },
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
    />
  );
};
