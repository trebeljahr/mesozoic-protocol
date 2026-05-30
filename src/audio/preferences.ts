import { audio, type SfxBus } from "./AudioManager";

const STORAGE_KEY_V2 = "mesozoic-protocol:audio:v2";
// v1 stored a single "sfx" bus; on first run with v2 present, every
// per-bus volume is seeded from v1.sfx so existing users keep their level.
const STORAGE_KEY_V1 = "mesozoic-protocol:audio:v1";

export type AudioPrefs = {
  master: number;
  music: number;
  ui: number;
  towers: number;
  enemies: number;
  notifications: number;
  muted: boolean;
};

export const SFX_BUSES: readonly SfxBus[] = ["ui", "towers", "enemies", "notifications"];

const DEFAULTS: AudioPrefs = {
  master: 1,
  music: 0.25,
  ui: 0.6,
  towers: 0.6,
  enemies: 0.6,
  notifications: 0.6,
  muted: false,
};

const clamp01 = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;

const parseV2 = (raw: string): AudioPrefs | null => {
  try {
    const obj = JSON.parse(raw) as Partial<Record<keyof AudioPrefs, unknown>>;
    const next: AudioPrefs = { ...DEFAULTS };
    for (const k of ["master", "music", "ui", "towers", "enemies", "notifications"] as const) {
      const c = clamp01(obj[k]);
      if (c !== null) next[k] = c;
    }
    if (typeof obj.muted === "boolean") next.muted = obj.muted;
    return next;
  } catch {
    return null;
  }
};

const migrateFromV1 = (raw: string): AudioPrefs | null => {
  try {
    const old = JSON.parse(raw) as { sfx?: unknown; music?: unknown; muted?: unknown };
    const sfx = clamp01(old.sfx);
    const music = clamp01(old.music);
    const next: AudioPrefs = {
      master: DEFAULTS.master,
      music: music ?? DEFAULTS.music,
      ui: sfx ?? DEFAULTS.ui,
      towers: sfx ?? DEFAULTS.towers,
      enemies: sfx ?? DEFAULTS.enemies,
      notifications: sfx ?? DEFAULTS.notifications,
      muted: typeof old.muted === "boolean" ? old.muted : DEFAULTS.muted,
    };
    return next;
  } catch {
    return null;
  }
};

// Hard force-mute in agent preview browsers (Claude Code, Codex) — UA
// contains "Claude/" or "Codex/". Saved unmute preferences are ignored
// in these environments so dev previews never blast sound at whoever's
// nearby; the user's normal-browser preference is preserved verbatim.
const isPreviewAgentBrowser = (): boolean => {
  try {
    return /(Claude|Codex)\//i.test(navigator.userAgent);
  } catch {
    return false;
  }
};

// In any Vite dev build we *default* to muted on first run, but the
// user can unmute and the preference is honored on reload. This is
// only the seed value when nothing is stored yet — it does not
// override an existing saved preference.
const isDevBuild = (): boolean => {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
};

// SoundControls and useAudioBridge both call loadAudioPrefs in mount
// effects, so the function runs again every time the menu is reopened
// or a new level starts. After the first call we treat the live
// audio-manager state as the source of truth — otherwise a subsequent
// remount would re-apply localStorage (or DEFAULTS, when nothing is
// saved yet) and silently undo the user's manual mute toggle.
let prefsLoaded = false;

export const loadAudioPrefs = (): AudioPrefs => {
  if (prefsLoaded) return readAudioPrefs();
  prefsLoaded = true;
  const forceMute = isPreviewAgentBrowser();
  const defaultMute = isDevBuild();
  try {
    const v2 = localStorage.getItem(STORAGE_KEY_V2);
    if (v2) {
      const parsed = parseV2(v2);
      if (parsed) return forceMute ? { ...parsed, muted: true } : parsed;
    }
    const v1 = localStorage.getItem(STORAGE_KEY_V1);
    if (v1) {
      const migrated = migrateFromV1(v1);
      if (migrated) {
        saveAudioPrefs(migrated);
        try {
          localStorage.removeItem(STORAGE_KEY_V1);
        } catch {
          /* ignore */
        }
        return forceMute ? { ...migrated, muted: true } : migrated;
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS, muted: forceMute || defaultMute || DEFAULTS.muted };
};

export const saveAudioPrefs = (p: AudioPrefs) => {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(p));
  } catch {
    /* ignore */
  }
};

export const applyAudioPrefs = (p: AudioPrefs) => {
  audio.setMasterVolume(p.master);
  audio.setMusicVolume(p.music);
  audio.setBusVolume("ui", p.ui);
  audio.setBusVolume("towers", p.towers);
  audio.setBusVolume("enemies", p.enemies);
  audio.setBusVolume("notifications", p.notifications);
  audio.setMuted(p.muted);
};

export const readAudioPrefs = (): AudioPrefs => ({
  master: audio.getMasterVolume(),
  music: audio.getMusicVolume(),
  ui: audio.getBusVolume("ui"),
  towers: audio.getBusVolume("towers"),
  enemies: audio.getBusVolume("enemies"),
  notifications: audio.getBusVolume("notifications"),
  muted: audio.isMuted(),
});
