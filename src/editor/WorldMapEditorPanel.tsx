import { downloadJson } from "./download";
import { EditorPanel, type FooterButton } from "./EditorPanel";
import { useWorldMapEditor } from "./worldMapEditorStore";

// Dev-only world-map editor side panel. Thin wrapper over the shared
// EditorPanel — supplies the world-map store, title, and footer buttons
// (copy / download / clear all / restore generated). Mounted in App.tsx
// behind import.meta.env.DEV && screen === "worldMap".
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
      title:
        "Wipe every hand-placed world-map prop AND suppress the generated per-node clusters. Undoable.",
      onClick: onClearAll,
    },
    {
      label: "Restore generated",
      title:
        "Bring back the generated per-node clusters, including individually erased ones. Undoable.",
      onClick: () => useWorldMapEditor.getState().reloadProcedural(),
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
