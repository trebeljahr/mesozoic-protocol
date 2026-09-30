import { useEffect } from "react";
import type { Biome } from "../biomes";
import { EASTER_EGG_BY_ID } from "../easterEggs";
import type { GameEvent, Tower } from "../sim/types";
import { useGame } from "../store";
import { audio, type MusicTrack } from "./AudioManager";
import { applyAudioPrefs, loadAudioPrefs } from "./preferences";

const biomeTrack = (biome: Biome): MusicTrack => `music-${biome}` as MusicTrack;

export const useAudioBridge = () => {
  useEffect(() => {
    let cancelled = false;
    const activeFlameTowerIds = (towers: Tower[]) =>
      towers.filter((t) => t.kind === "flame" && t.flameActive).map((t) => t.id);
    const activeFlameSignature = (towers: Tower[]) => activeFlameTowerIds(towers).join(",");
    audio.preload().then(() => {
      if (cancelled) return;
      applyAudioPrefs(loadAudioPrefs());
    });

    type GameState = ReturnType<typeof useGame.getState>;
    // Start biome music the moment the level loads, even with Field Report
    // up. Mobile loads the biome MP3 (5-13MB) in seconds; gating on intro
    // dismiss meant the level ran with no music until tap-through. Music
    // crossfades in behind the briefing as soon as the buffer is ready.
    const pickTrack = (s: GameState): MusicTrack => {
      if (s.screen === "playing") return biomeTrack(s.world.biome);
      return "music";
    };

    const resumeOnInteract = async () => {
      // Detach listeners synchronously before the await so a pointerdown
      // and keydown firing in the same task don't both run this handler
      // and double-trigger startMusic (which would orphan a playback).
      window.removeEventListener("pointerdown", resumeOnInteract);
      window.removeEventListener("keydown", resumeOnInteract);
      await audio.ensureResumed();
      audio.startMusic(pickTrack(useGame.getState()));
    };
    window.addEventListener("pointerdown", resumeOnInteract);
    window.addEventListener("keydown", resumeOnInteract);

    const unsubMusic = useGame.subscribe((state, prev) => {
      const next = pickTrack(state);
      if (next === pickTrack(prev)) return;
      audio.crossfadeTo(next);
    });

    // Compare via `ui.status` (a fresh snapshot per set()) rather than
    // `world.status`. The store mutates `world` in place on pause, so
    // `state.world === prev.world` and a direct `world.status` compare
    // would never see the running→paused transition.
    const unsubFlames = useGame.subscribe((state, prev) => {
      const towersChanged = state.world.towers !== prev.world.towers;
      const screenChanged = state.screen !== prev.screen;
      const statusChanged = state.ui.status !== prev.ui.status;
      if (!towersChanged && !screenChanged && !statusChanged) return;
      if (towersChanged && !screenChanged && !statusChanged) {
        if (activeFlameSignature(state.world.towers) === activeFlameSignature(prev.world.towers)) {
          return;
        }
      }
      if (state.screen !== "playing" || state.ui.status !== "running") {
        audio.stopAllFlames();
        return;
      }
      audio.syncFlames(activeFlameTowerIds(state.world.towers));
    });

    // Generic UI feedback: every button activation plays a click. Buttons
    // can override the sample with `data-ui-sound` (e.g. "close" for close
    // buttons, "select" for the tower picker) — see `audio.ui` for the
    // valid set. The attribute keeps the audio contract explicit at the
    // source instead of inferred from class-name strings.
    //
    // Listens on `click` (not `pointerdown`) so a touch that drags into a
    // scroll — never producing a click — doesn't fire the sample.
    type UiSound = "click" | "tab" | "open" | "close" | "error" | "select";
    const VALID_SOUNDS: ReadonlySet<UiSound> = new Set([
      "click",
      "tab",
      "open",
      "close",
      "error",
      "select",
    ]);
    const onUiClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest("button") as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      const attr = btn.dataset.uiSound as UiSound | undefined;
      audio.ui(attr && VALID_SOUNDS.has(attr) ? attr : "click");
    };
    document.addEventListener("click", onUiClick);

    const unsub = useGame.getState().onEvent((e: GameEvent) => {
      const state = useGame.getState();
      switch (e.type) {
        case "shoot":
          if (state.screen !== "playing" || state.world.status !== "running") break;
          audio.playShoot(e.towerKind, e.towerId);
          break;
        case "impact":
          audio.play("impact", "enemies", 0.25, 60, 1.0);
          break;
        case "hq-laser":
          if (state.screen !== "playing" || state.world.status !== "running") break;
          audio.playLaser();
          break;
        case "death":
          audio.playSplat();
          break;
        case "wave-start":
          audio.play("wave-start", "notifications", 0.18, 350, 0.65);
          break;
        case "boss-wave-start":
          // Boss sting: layer "new-enemy" (dramatic announcement cue) on
          // top of the standard wave-start so the moment reads as bigger
          // than a regular wave. Reuses existing samples — no new audio
          // assets shipped with this change.
          audio.play("new-enemy", "notifications", 0.7, 500, 2.3);
          break;
        case "boss-defeated":
          // Takedown sting — repurpose victory horn as an in-run windfall
          // cue. Distinct from wave-clear so a boss kill doesn't blur
          // into the normal end-of-wave tone.
          audio.play("victory", "notifications", 0.34, 500, 1.8);
          break;
        case "life-lost":
          audio.play("life-lost", "enemies", 0.7, 120);
          break;
        case "upgrade":
          audio.play("upgrade", "towers", 0.5, 100);
          break;
        case "tower-placed":
          audio.play("tower-place", "towers", 0.55, 60, 1.2);
          break;
        case "tower-sold":
          audio.play("tower-sell", "towers", 0.6, 60, 0.8);
          break;
        case "place-failed":
          audio.ui("error");
          break;
        case "drone-assign-failed":
          audio.ui("error");
          break;
        case "wave-called-early":
          audio.play("wave-clear", "notifications", 0.6, 500);
          break;
        case "easter-egg-click": {
          // Per-def sfx override (e.g. skull plays a deeper impact crack
          // on top of the generic egg click). Layered so the per-def
          // sample lands first, then the standard click tone tags the
          // pickup feedback.
          const def = EASTER_EGG_BY_ID[e.defId];
          if (def?.sfx) {
            audio.play(def.sfx.sample, "ui", def.sfx.volume ?? 0.7, 60, def.sfx.duration);
          }
          audio.play("tower-sell", "ui", 0.65, 60, 0.8);
          break;
        }
        case "flame-start":
          if (state.screen !== "playing" || state.world.status !== "running") break;
          audio.startFlame(e.towerId);
          break;
        case "flame-stop":
          audio.stopFlame(e.towerId);
          break;
        case "footstep":
          if (state.screen !== "playing" || state.world.status !== "running") break;
          audio.playFootstep(e.source, e.weight);
          break;
        case "robot-ability": {
          // Per-ability voicing reuses the existing tower/shot sample
          // library so the player gets feedback on every cast without
          // shipping new audio assets.
          if (state.screen !== "playing" || state.world.status !== "running") break;
          switch (e.kind) {
            case "dash-aim":
              audio.ui("tab");
              break;
            case "dash":
              audio.play("shoot-pulse", "towers", 0.55, 80, 0.35);
              break;
            case "burst":
              audio.play(
                state.world.robot.damageType === "cold" ? "shoot-cryo" : "shoot-mortar",
                "towers",
                0.5,
                120,
                1.0,
              );
              break;
            case "buff":
              audio.play("upgrade", "ui", 0.6, 120, 0.9);
              break;
            case "barrage":
              audio.play("shoot-pulse", "towers", 0.6, 120, 0.9);
              break;
            case "storm":
              audio.play(
                state.world.robot.damageType === "cold" ? "shoot-cryo" : "shoot-chain",
                "towers",
                0.6,
                120,
                0.9,
              );
              break;
            case "flameRings":
              audio.play("shoot-flame", "towers", 0.55, 120, 0.9);
              break;
            case "frenzy":
              audio.play("upgrade", "ui", 0.6, 120, 1.4);
              break;
            case "killshot":
              audio.play("shoot-mortar", "towers", 0.7, 120, 1.4);
              break;
          }
          break;
        }
        case "game-over":
          audio.stopAllSfx();
          // Base destroyed: punctuate the fall with an explosion. Played
          // after stopAllSfx so the fresh voice survives the cutoff; skipped
          // on victory (won) since nothing blew up.
          if (!e.won) audio.play("shoot-mortar", "enemies", 0.85, 0, 1.4);
          audio.stopMusic();
          break;
      }
    });

    return () => {
      cancelled = true;
      unsub();
      unsubMusic();
      unsubFlames();
      document.removeEventListener("click", onUiClick);
      window.removeEventListener("pointerdown", resumeOnInteract);
      window.removeEventListener("keydown", resumeOnInteract);
    };
  }, []);
};
