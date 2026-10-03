import { describe, expect, it, vi } from "vitest";
import { LEVELS, levelHasMode } from "./levels";
import { outpostActivation } from "./outpostActivation";
import { emptyProgress, recordLevelResult } from "./progress";
import { useGame } from "./store";

describe("shared outpost activation", () => {
  it("rejects locked nodes and starts a fresh outpost normally", () => {
    expect(outpostActivation(1, emptyProgress())).toBe("normal");
    expect(outpostActivation(2, emptyProgress())).toBe("locked");
    expect(outpostActivation(999, emptyProgress())).toBe("locked");
  });
  it("routes eligible outposts to challenge choices for every input caller", () => {
    let progress = emptyProgress();
    const startLevel = vi.fn();
    const openModePicker = vi.fn();
    const previous = useGame.getState();
    try {
      for (const level of LEVELS) {
        progress = recordLevelResult(progress, level.id, "normal", 3);
        const eligible = levelHasMode(level, "breach") || levelHasMode(level, "containment");
        useGame.setState({ progress, startLevel, openModePicker });
        startLevel.mockClear();
        openModePicker.mockClear();
        useGame.getState().activateOutpost(level.id);
        expect(eligible ? openModePicker : startLevel).toHaveBeenCalledExactlyOnceWith(level.id);
        expect(eligible ? startLevel : openModePicker).not.toHaveBeenCalled();
      }
    } finally {
      useGame.setState(previous);
    }
  });
});
