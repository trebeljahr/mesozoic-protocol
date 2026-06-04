import { downloadJson } from "./download";
import { EditorPanel, type FooterButton } from "./EditorPanel";
import { useWorldMapEditor } from "./worldMapEditorStore";

// Dev-only world-map editor side panel. Thin wrapper over the shared
// EditorPanel — supplies the world-map store, title, and footer buttons
// (copy / download / clear all (undoable)). Mounted in App.tsx behind
// import.meta.env.DEV && screen === "worldMap". The override-procedural
// checkbox is hidden because the world map has no procedural set-dressing
// to suppress.
export const WorldMapEditorPanel = () => {
  const onDownload = () => {
    downloadJson("mz-worldmap.json", useWorldMapEditor.getState().exportJson());
  };

  const onClearAll = () => {
    useWorldMapEditor.getState().clear();
  };

  const exportButtons: FooterButton[] = [
    { label: "Download", title: "Download mz-worldmap.json", onClick: onDownload },
  ];

  const clearButtons: FooterButton[] = [
    {
      label: "Clear all",
      title: "Wipe every hand-placed world-map prop. Undoable.",
      onClick: onClearAll,
    },
  ];

  return (
    <EditorPanel
      store={useWorldMapEditor}
      title="World Map Editor"
      fabLabel="Edit Map"
      fabTitle="Open world-map editor (dev only)"
      copyButton={{
        title: "Copy JSON to clipboard",
        logExport: (json) => console.log("[worldmap-editor] export:\n%s", json),
      }}
      exportButtons={exportButtons}
      clearButtons={clearButtons}
    />
  );
};
