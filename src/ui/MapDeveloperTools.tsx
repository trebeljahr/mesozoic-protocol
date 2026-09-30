import { useState } from "react";
import { EditLevelButton } from "../editor/EditLevelButton";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { LEVELS } from "../levels";
import { getStars, isLevelUnlocked } from "../progress";
import { useGame } from "../store";

// Developer actions belong in one deliberate surface, never over every marker.
export const MapDeveloperTools = ({ onClose }: { onClose: () => void }) => {
  const progress = useGame((s) => s.progress);
  const [levelId, setLevelId] = useState(1);
  const unlocked = isLevelUnlocked(levelId, progress);
  return (
    <details className="map-developer-tools">
      <summary>Developer tools</summary>
      <label htmlFor="map-dev-level">Outpost</label>
      <select
        id="map-dev-level"
        value={levelId}
        onChange={(e) => setLevelId(Number(e.target.value))}
      >
        {LEVELS.map((level) => (
          <option key={level.id} value={level.id}>
            {level.id}. {level.name}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        {([0, 1, 2, 3] as const).map((stars) => (
          <button
            key={stars}
            type="button"
            className="btn btn-ghost btn--sm"
            aria-pressed={getStars(progress, levelId) === stars}
            onClick={() => useGame.getState().debugSetLevelStars(levelId, stars)}
          >
            {stars} ★
          </button>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn--sm"
          onClick={() => {
            if (unlocked) useGame.getState().debugLockFromLevel(levelId);
            else useGame.getState().debugUnlockThroughLevel(levelId);
          }}
        >
          {unlocked ? "Lock from here" : "Unlock through here"}
        </button>
      </div>
      {import.meta.env.DEV && (
        <div className="flex flex-wrap gap-2">
          <EditLevelButton levelId={levelId} />
          <button
            type="button"
            className="btn btn-ghost btn--sm"
            onClick={() => {
              onClose();
              useWorldMapEditor.setState({
                active: true,
                panelCollapsed: false,
                chromeHidden: false,
              });
            }}
          >
            Edit map
          </button>
        </div>
      )}
    </details>
  );
};
