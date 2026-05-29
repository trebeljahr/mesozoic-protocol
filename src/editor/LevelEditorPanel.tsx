import { useGame } from "../store";
import { downloadJson } from "./download";
import { EditorPanel, type FooterButton } from "./EditorPanel";
import { clearAllLevels, exportAllLevelsJson, useEditor } from "./editorStore";

// Dev-only level-editor side panel. Thin wrapper over the shared EditorPanel —
// supplies the level-editor store, per-level title, override toggle source,
// and the level-editor's footer buttons (copy / download level / download
// all levels / clear level / clear all levels with confirm). Mounted in
// App.tsx behind import.meta.env.DEV.
export const LevelEditorPanel = () => {
  const levelId = useGame((s) => s.world.levelId);
  const overrideActive = useGame((s) => s.world.overrideActive);

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
      label: "Clear",
      title: `Clear manual and procedural set-dressing on L${levelId}; keeps paths and HQ`,
      onClick: () => useEditor.getState().clear(),
    },
    {
      label: "Clear procedural",
      title: `Clear only procedural set-dressing on L${levelId}`,
      onClick: () => useEditor.getState().clearProcedural(),
    },
    {
      label: "Clear manual",
      title: `Clear only hand-placed props and rivers on L${levelId}`,
      onClick: () => useEditor.getState().clearManual(),
    },
    {
      label: "Reload procedural",
      title: `Pick a new procedural seed for L${levelId}`,
      onClick: () => useEditor.getState().reloadProcedural(),
    },
    {
      label: "Clear all",
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
      showOverride
      override={overrideActive}
      copyButton={{
        title: "Copy JSON to clipboard",
        logExport: (json) => console.log("[level-editor] export L%d:\n%s", levelId, json),
      }}
      exportButtons={exportButtons}
      clearButtons={clearButtons}
    />
  );
};
