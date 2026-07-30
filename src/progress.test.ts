import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DIFFICULTIES,
  emptyProgress,
  getModeStars,
  getStars,
  hasUnlockedChallengeModes,
  isLevelUnlocked,
  isModeUnlocked,
  LEVEL_MODES,
  levelTotalStars,
  loadSlot,
  PROGRESS_VERSION,
  recordEndlessResult,
  recordLevelResult,
  saveSlot,
  starsForLives,
  starsForRun,
  totalStars,
} from "./progress";

// Minimal Storage stand-in. src/progress.ts reaches through
// `window.localStorage` behind a guard, so a plain object is enough — no
// jsdom, no DOM globals.
const createStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  } as Storage;
};

const LEGACY_KEY = "mesozoic-protocol:progress:v1";
const slotKey = (id: 1 | 2 | 3) => `mesozoic-protocol:slot:${id}:v1`;

let storage: Storage;

beforeEach(() => {
  storage = createStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("star accounting", () => {
  it("grades normal runs on lives and challenge runs on win/lose", () => {
    expect(starsForLives(20)).toBe(3);
    expect(starsForLives(19)).toBe(2);
    expect(starsForLives(10)).toBe(2);
    expect(starsForLives(9)).toBe(1);
    expect(starsForLives(1)).toBe(1);
    expect(starsForLives(0)).toBe(0);

    expect(starsForRun("normal", 20, true)).toBe(3);
    expect(starsForRun("normal", 20, false)).toBe(0);
    expect(starsForRun("breach", 1, true)).toBe(1);
    expect(starsForRun("containment", 1, true)).toBe(1);
    expect(starsForRun("containment", 1, false)).toBe(0);
  });

  it("caps each level at 3 normal + 1 breach + 1 containment", () => {
    let p = emptyProgress();
    // Out-of-range input must clamp, not leak into the save.
    p = recordLevelResult(p, 1, "normal", 99);
    p = recordLevelResult(p, 1, "breach", 7);
    p = recordLevelResult(p, 1, "containment", 7);
    expect(getModeStars(p, 1)).toEqual({ normal: 3, breach: 1, containment: 1 });
    expect(levelTotalStars(p, 1)).toBe(5);
    expect(totalStars(p)).toBe(5);
  });

  it("never regresses a level's best result", () => {
    let p = recordLevelResult(emptyProgress(), 2, "normal", 3);
    const afterBest = p;
    p = recordLevelResult(p, 2, "normal", 1);
    // Same reference back = the store can skip a redundant persist.
    expect(p).toBe(afterBest);
    expect(getStars(p, 2)).toBe(3);
    // A failed challenge run (0 stars) must not set the bonus star.
    expect(recordLevelResult(p, 2, "breach", 0)).toBe(p);
  });

  it("keeps totalStars within the campaign ceiling", () => {
    let p = emptyProgress();
    for (const mode of LEVEL_MODES) {
      for (let id = 1; id <= 30; id++) p = recordLevelResult(p, id, mode, 3);
    }
    expect(totalStars(p)).toBe(30 * 5);
    for (let id = 1; id <= 30; id++) expect(levelTotalStars(p, id)).toBeLessThanOrEqual(5);
  });
});

describe("unlock gating", () => {
  it("chains level unlocks off the previous level's normal clear", () => {
    const fresh = emptyProgress();
    expect(isLevelUnlocked(1, fresh)).toBe(true);
    expect(isLevelUnlocked(2, fresh)).toBe(false);
    const cleared = recordLevelResult(fresh, 1, "normal", 1);
    expect(isLevelUnlocked(2, cleared)).toBe(true);
    expect(isLevelUnlocked(3, cleared)).toBe(false);
  });

  it("opens breach and containment only after a 3-star normal clear", () => {
    const oneStar = recordLevelResult(emptyProgress(), 1, "normal", 1);
    expect(isModeUnlocked(oneStar, 1, "normal")).toBe(true);
    expect(isModeUnlocked(oneStar, 1, "breach")).toBe(false);
    expect(hasUnlockedChallengeModes(oneStar)).toBe(false);

    const threeStar = recordLevelResult(oneStar, 1, "normal", 3);
    expect(isModeUnlocked(threeStar, 1, "breach")).toBe(true);
    expect(isModeUnlocked(threeStar, 1, "containment")).toBe(true);
    expect(hasUnlockedChallengeModes(threeStar)).toBe(true);
  });

  it("only records an endless run when it beats the stored best", () => {
    const p = recordEndlessResult(emptyProgress(), "arena", "medium", 12);
    expect(p.endlessBest?.["arena:medium"]).toBe(12);
    expect(recordEndlessResult(p, "arena", "medium", 12)).toBe(p);
    expect(recordEndlessResult(p, "arena", "medium", 13).endlessBest?.["arena:medium"]).toBe(13);
  });
});

describe("slot persistence", () => {
  it("round-trips a save through localStorage", () => {
    let p = recordLevelResult(emptyProgress(), 4, "normal", 2);
    p = recordLevelResult(p, 4, "breach", 1);
    p = { ...p, bolts: 42, difficulty: "hard", stats: { killsTotal: 9, winsTotal: 3 } };
    saveSlot(1, p, "Rico");

    const loaded = loadSlot(1);
    expect(loaded.meta.name).toBe("Rico");
    expect(loaded.progress.version).toBe(PROGRESS_VERSION);
    expect(loaded.progress.bolts).toBe(42);
    expect(loaded.progress.difficulty).toBe("hard");
    expect(loaded.progress.stats).toEqual({ killsTotal: 9, winsTotal: 3 });
    expect(getModeStars(loaded.progress, 4)).toEqual({ normal: 2, breach: 1, containment: 0 });
    expect(totalStars(loaded.progress)).toBe(3);
  });

  it("falls back to an empty save for an unwritten or corrupt slot", () => {
    expect(loadSlot(2).progress).toEqual(emptyProgress());
    storage.setItem(slotKey(2), "{not json");
    expect(loadSlot(2).progress).toEqual(emptyProgress());
    storage.setItem(slotKey(2), JSON.stringify({ progress: { version: 99 } }));
    expect(loadSlot(2).progress).toEqual(emptyProgress());
  });

  it("repairs an out-of-range difficulty instead of trusting the blob", () => {
    storage.setItem(
      slotKey(3),
      JSON.stringify({
        meta: { name: "x", lastPlayed: 1 },
        progress: { version: 4, starsByLevel: {}, difficulty: "impossible" },
      }),
    );
    expect(DIFFICULTIES).toContain(loadSlot(3).progress.difficulty);
  });
});

describe("save migrations", () => {
  it("promotes a v1 numeric star map and the heroic/iron mode names", () => {
    storage.setItem(
      slotKey(1),
      JSON.stringify({
        meta: { name: "old", lastPlayed: 1 },
        progress: {
          version: 1,
          // v1 stored a bare 0-3 per level.
          starsByLevel: { 1: 3, 2: 2, 3: { normal: 1, heroic: 1, iron: 1 } },
          // v3 achievement ids, renamed in v4.
          unlocked: { heroic_effort: 111, iron_will: 222, first_blood: 333 },
          // Pre-branch meta-skill ranks keyed by node id.
          metaSkills: { pulse: { "pulse.barrel": 3, a: 2 }, bogus: { a: 1 } },
          encountered: { boss: true },
        },
      }),
    );

    const { progress } = loadSlot(1);
    expect(progress.version).toBe(PROGRESS_VERSION);
    expect(getModeStars(progress, 1)).toEqual({ normal: 3, breach: 0, containment: 0 });
    expect(getModeStars(progress, 3)).toEqual({ normal: 1, breach: 1, containment: 1 });
    expect(totalStars(progress)).toBe(8);
    // Renamed achievements keep their original unlock timestamps.
    expect(progress.unlocked).toEqual({
      breach_holdout: 111,
      containment_holdout: 222,
      first_blood: 333,
    });
    // Legacy per-node ranks are dropped; branch ranks survive.
    expect(progress.metaSkills).toEqual({ pulse: { a: 2 } });
    // A pre-variant save that saw the apex boss counts as having met them all.
    expect(Object.values(progress.matriarchsEncountered).filter(Boolean)).toHaveLength(6);
  });

  it("promotes the pre-slot save into slot 1 exactly once", async () => {
    storage.setItem(
      LEGACY_KEY,
      JSON.stringify({ version: 2, starsByLevel: { 1: { normal: 3 } }, bolts: 7 }),
    );
    // Fresh module instance so the one-shot migration guard re-arms.
    vi.resetModules();
    const progressModule = await import("./progress");
    const { progress } = progressModule.loadSlot(1);
    expect(progress.bolts).toBe(7);
    expect(progressModule.getStars(progress, 1)).toBe(3);
    // The legacy blob is consumed, not left behind to re-import later.
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
    expect(storage.getItem(slotKey(1))).not.toBeNull();
  });

  it("does not clobber an existing slot 1 with a stale legacy blob", async () => {
    const keep = recordLevelResult(emptyProgress(), 9, "normal", 3);
    vi.resetModules();
    const progressModule = await import("./progress");
    progressModule.saveSlot(1, keep, "keep me");
    storage.setItem(LEGACY_KEY, JSON.stringify({ version: 2, starsByLevel: { 1: { normal: 1 } } }));
    const { progress, meta } = progressModule.loadSlot(1);
    expect(meta.name).toBe("keep me");
    expect(progressModule.getStars(progress, 9)).toBe(3);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });
});
