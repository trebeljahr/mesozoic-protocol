import type { TowerKind } from "../sim/types";

type Sample = {
  buffer: AudioBuffer | null;
  loaded: boolean;
  failed: boolean;
};

type FlameVoice = {
  sample: AudioBufferSourceNode;
  master: GainNode;
};

type MusicPlayback = {
  gain: GainNode;
  nextStartAt: number;
  firstSegment: boolean;
  refreshTimer: number | null;
  sources: Set<AudioBufferSourceNode>;
};

export type MusicTrack =
  | "music"
  | "music-forest"
  | "music-desert"
  | "music-snow"
  | "music-wasteland"
  | "music-lava"
  | "music-alien";

export type SfxBus = "ui" | "towers" | "enemies" | "notifications";

const VOICE_CAP_PER_KEY = 3;
const TOTAL_VOICE_CAP = 18;

const DEFAULT_MASTER_VOLUME = 1;
const DEFAULT_SFX_VOLUME = 0.6;
const DEFAULT_MUSIC_VOLUME = 0.25;
const MUSIC_LOOP_OVERLAP_SEC = 0.12;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private output: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private busGains: Record<SfxBus, GainNode | null> = {
    ui: null,
    towers: null,
    enemies: null,
    notifications: null,
  };
  private musicGain: GainNode | null = null;
  private samples = new Map<string, Sample>();
  private trimmedKeys = new Set<string>();
  private music: MusicPlayback | null = null;
  private currentMusicKey: MusicTrack | null = null;
  // Monotonic counter — every crossfadeTo() captures a token, and any post-
  // await work bails out if a newer request has come in. Without this, two
  // overlapping crossfadeTo() calls (e.g. pointerdown + keydown both firing
  // the first-interaction resume handler before either's await completes)
  // each create a playback and the earlier one orphans, audible as a doubled
  // track that keeps playing across subsequent screen transitions.
  private musicRequestToken = 0;
  // Key of the track currently being loaded by an in-flight crossfadeTo.
  // Lets duplicate same-key requests short-circuit before tearing down the
  // current playback and starting a redundant load.
  private musicPendingKey: MusicTrack | null = null;
  private musicUrls: Record<MusicTrack, string> | null = null;
  private lastPlayedAt = new Map<string, number>();
  private activeVoices = new Map<string, Set<AudioBufferSourceNode>>();
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private busVolumes: Record<SfxBus, number> = {
    ui: DEFAULT_SFX_VOLUME,
    towers: DEFAULT_SFX_VOLUME,
    enemies: DEFAULT_SFX_VOLUME,
    notifications: DEFAULT_SFX_VOLUME,
  };
  private musicVolume = DEFAULT_MUSIC_VOLUME;
  // Default-mute in Claude Code's preview browser (UA contains "Claude/")
  // so dev previews don't play music at whoever is nearby. Real users
  // get the persisted/default unmuted state via loadAudioPrefs().
  private muted = typeof navigator !== "undefined" && /Claude\//.test(navigator.userAgent);

  async init() {
    if (this.ctx) return;
    try {
      this.ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
    } catch (err) {
      console.warn("[AudioManager] init failed — all audio calls will no-op", err);
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;

    // Brick-wall-ish limiter targeting a -1 dBTP true-peak ceiling,
    // matching Spotify / YouTube Music loudness guidelines. Catches the
    // peaks that arise when many SFX voices sum on wave clears, so the
    // mix can sit near -14 LUFS program loudness without speaker clipping.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.output = this.ctx.createGain();
    this.output.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.limiter).connect(this.output).connect(this.ctx.destination);

    for (const bus of ["ui", "towers", "enemies", "notifications"] as const) {
      const g = this.ctx.createGain();
      g.gain.value = this.busVolumes[bus];
      g.connect(this.master);
      this.busGains[bus] = g;
    }

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);
  }

  async ensureResumed() {
    if (this.ctx && this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  private async load(key: string, url: string) {
    if (!this.ctx) return;
    if (this.samples.has(key)) return;
    const entry: Sample = { buffer: null, loaded: false, failed: false };
    this.samples.set(key, entry);
    try {
      const res = await fetch(url);
      const ab = await res.arrayBuffer();
      entry.buffer = await this.ctx.decodeAudioData(ab);
      entry.loaded = true;
    } catch {
      entry.failed = true;
    }
  }

  async preload() {
    await this.init();
    const base = import.meta.env.BASE_URL ?? "/";
    // Biome tracks are large (~5–13MB each); load them on demand when
    // the player enters a level rather than paying ~40MB up-front.
    this.musicUrls = {
      music: `${base}audio/music-ambient.mp3`,
      "music-forest": `${base}audio/music/forest.mp3`,
      "music-desert": `${base}audio/music/desert.mp3`,
      "music-snow": `${base}audio/music/snow.mp3`,
      "music-wasteland": `${base}audio/music/wasteland.mp3`,
      "music-lava": `${base}audio/music/lava.mp3`,
      "music-alien": `${base}audio/music/alien.mp3`,
    };
    const entries: [string, string][] = [
      ["shoot-pulse", `${base}audio/shoot-pulse.mp3`],
      ["shoot-flame", `${base}audio/shoot-flame.mp3`],
      ["shoot-chain", `${base}audio/shoot-chain.mp3`],
      ["shoot-cryo", `${base}audio/shoot-cryo.mp3`],
      ["shoot-mortar", `${base}audio/shoot-mortar.mp3`],
      ["impact", `${base}audio/impact.mp3`],
      ["wave-start", `${base}audio/wave-start.mp3`],
      ["wave-call", `${base}audio/wave-call.mp3`],
      ["wave-clear", `${base}audio/wave-clear.mp3`],
      ["life-lost", `${base}audio/life-lost.mp3`],
      ["game-over", `${base}audio/game-over.mp3`],
      ["upgrade", `${base}audio/upgrade.mp3`],
      ["star", `${base}audio/star.mp3`],
      ["level-select", `${base}audio/level-select.mp3`],
      ["music", `${base}audio/music-ambient.mp3`],
      ["ui-click", `${base}audio/ui-click.mp3`],
      ["ui-tab", `${base}audio/ui-tab.mp3`],
      ["ui-open", `${base}audio/ui-open.mp3`],
      ["ui-close", `${base}audio/ui-close.mp3`],
      ["ui-error", `${base}audio/ui-error.mp3`],
      ["tower-place", `${base}audio/tower-place.mp3`],
      ["tower-sell", `${base}audio/tower-sell.mp3`],
      ["tower-select", `${base}audio/tower-select.mp3`],
      ["new-enemy", `${base}audio/new-enemy.mp3`],
      ["victory", `${base}audio/victory.mp3`],
      ["defeat", `${base}audio/defeat.mp3`],
    ];
    await Promise.all(entries.map(([k, u]) => this.load(k, u)));
  }

  // Strip leading/trailing silence (MP3 encoder padding) so loop = true is gapless.
  private trimBuffer(buf: AudioBuffer): AudioBuffer {
    if (!this.ctx) return buf;
    const ch0 = buf.getChannelData(0);
    const len = ch0.length;
    const threshold = 0.002;
    const maxTrim = Math.ceil(buf.sampleRate * 0.1);

    let start = 0;
    while (start < maxTrim && start < len && Math.abs(ch0[start]) < threshold) start++;

    let end = len;
    while (end > len - maxTrim && end > start && Math.abs(ch0[end - 1]) < threshold) end--;

    if (start === 0 && end === len) return buf;
    const trimLen = end - start;
    const trimmed = this.ctx.createBuffer(buf.numberOfChannels, trimLen, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      trimmed.copyToChannel(buf.getChannelData(c).subarray(start, end), c);
    }
    return trimmed;
  }

  private totalVoices(): number {
    let n = 0;
    for (const set of this.activeVoices.values()) n += set.size;
    return n;
  }

  play(key: string, bus: SfxBus, volumeScale = 1, cooldownMs = 50, maxDurationSec?: number) {
    const busGain = this.busGains[bus];
    if (!this.ctx || !busGain || this.muted) return;
    const sample = this.samples.get(key);
    if (!sample?.loaded || !sample.buffer) return;
    const now = performance.now();
    const last = this.lastPlayedAt.get(key) ?? 0;
    if (now - last < cooldownMs) return;

    let keyVoices = this.activeVoices.get(key);
    if (!keyVoices) {
      keyVoices = new Set();
      this.activeVoices.set(key, keyVoices);
    }
    if (keyVoices.size >= VOICE_CAP_PER_KEY) return;
    if (this.totalVoices() >= TOTAL_VOICE_CAP) return;

    this.lastPlayedAt.set(key, now);

    const src = this.ctx.createBufferSource();
    src.buffer = sample.buffer;
    const gain = this.ctx.createGain();
    const trim = key === "victory" ? 0.1 : key === "star" ? 0.78 : key === "new-enemy" ? 0.88 : 1;
    gain.gain.value = Math.min(1, volumeScale * trim);
    src.connect(gain).connect(busGain);
    keyVoices.add(src);
    src.onended = () => {
      keyVoices!.delete(src);
    };
    src.start(0);
    if (maxDurationSec !== undefined) {
      const ctxNow = this.ctx.currentTime;
      const fadeLen = Math.min(0.35, maxDurationSec * 0.6);
      const fadeStart = ctxNow + Math.max(0, maxDurationSec - fadeLen);
      const stopAt = ctxNow + maxDurationSec;
      gain.gain.setValueAtTime(gain.gain.value, fadeStart);
      gain.gain.linearRampToValueAtTime(0, stopAt);
      try {
        src.stop(stopAt);
      } catch {
        /* ok */
      }
    }
  }

  playShoot(kind: TowerKind, _towerId?: number) {
    if (kind === "flame") return;
    const map: Record<Exclude<TowerKind, "flame">, [string, number, number, number]> = {
      pulse: ["shoot-pulse", 0.4, 35, 0.4],
      chain: ["shoot-chain", 0.35, 90, 0.9],
      cryo: ["shoot-cryo", 0.45, 150, 1.1],
      mortar: ["shoot-mortar", 0.55, 200, 1.4],
      hive: ["shoot-pulse", 0.3, 45, 0.4],
    };
    const [key, vol, cd, maxDur] = map[kind];
    this.play(key, "towers", vol, cd, maxDur);
  }

  // --- Continuous flamethrower sound (per-tower, looping sample) ---------
  //
  // Driven by flame-start / flame-stop sim events so the sound tracks
  // actual targeting, not damage ticks. Each firing tower owns one looping
  // voice of the shoot-flame sample with a fade in/out on its master gain.

  private static readonly MAX_FLAME_VOICES = 4;
  private activeFlames = new Map<number, FlameVoice>();

  startFlame(towerId: number) {
    const towersGain = this.busGains.towers;
    if (!this.ctx || !towersGain || this.muted) return;
    if (this.activeFlames.has(towerId)) return;
    if (this.activeFlames.size >= AudioManager.MAX_FLAME_VOICES) return;

    const sample = this.samples.get("shoot-flame");
    if (!sample?.loaded || !sample.buffer) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.55, now + 0.06);
    master.connect(towersGain);

    const sampleSrc = ctx.createBufferSource();
    sampleSrc.buffer = sample.buffer;
    sampleSrc.loop = true;
    sampleSrc.connect(master);
    sampleSrc.start(now, Math.random() * sample.buffer.duration);

    this.activeFlames.set(towerId, { sample: sampleSrc, master });
  }

  stopFlame(towerId: number) {
    const flame = this.activeFlames.get(towerId);
    if (!flame || !this.ctx) return;
    this.activeFlames.delete(towerId);

    const now = this.ctx.currentTime;
    const fade = 0.18;

    flame.master.gain.cancelScheduledValues(now);
    flame.master.gain.setValueAtTime(flame.master.gain.value, now);
    flame.master.gain.linearRampToValueAtTime(0, now + fade);

    const stopAt = now + fade + 0.01;
    try {
      flame.sample.stop(stopAt);
    } catch {
      /* ok */
    }
    const m = flame.master;
    setTimeout(
      () => {
        try {
          m.disconnect();
        } catch {
          /* ok */
        }
      },
      (fade + 0.05) * 1000,
    );
  }

  syncFlames(activeTowerIds: Iterable<number>) {
    const active = new Set(activeTowerIds);
    for (const id of [...this.activeFlames.keys()]) {
      if (!active.has(id)) this.stopFlame(id);
    }
    for (const id of active) {
      if (!this.activeFlames.has(id)) this.startFlame(id);
    }
  }

  stopAllFlames() {
    if (!this.ctx) {
      this.activeFlames.clear();
      return;
    }
    // Hard-kill path: pause/screen transitions need flames silenced now, not
    // 180ms later via the natural fade. The fade-stop in stopFlame() relies
    // on ctx.currentTime advancing, which it can't if a pause coincides with
    // the AudioContext getting suspended — voices then loop on the pause
    // screen until next interaction. Cut master to 0 immediately and stop
    // the source at currentTime.
    const now = this.ctx.currentTime;
    for (const flame of this.activeFlames.values()) {
      try {
        flame.master.gain.cancelScheduledValues(now);
        flame.master.gain.setValueAtTime(0, now);
      } catch {
        /* ok */
      }
      try {
        flame.sample.stop(now);
      } catch {
        /* ok */
      }
      try {
        flame.master.disconnect();
      } catch {
        /* ok */
      }
    }
    this.activeFlames.clear();
  }

  // Wet "mush" splat for enemy deaths: a short noise burst bandpassed from
  // bright-and-wet down to dull-and-low, paired with a sub-bass thump that
  // pitches down. Reads as a creature's body bursting rather than a clean
  // hit. Synthesised because real splat samples loop poorly when many
  // enemies die at once on wave clears.
  private lastSplatAt = 0;
  private activeSplats = new Set<AudioScheduledSourceNode>();
  playSplat(volumeScale = 0.55) {
    const enemiesGain = this.busGains.enemies;
    if (!this.ctx || !enemiesGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const wallNow = performance.now();
    if (wallNow - this.lastSplatAt < 25) return;
    if (this.activeSplats.size >= 10) return;
    this.lastSplatAt = wallNow;

    const duration = 0.22;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(duration * sampleRate);

    const noiseBuf = ctx.createBuffer(1, length, sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(900, now);
    bp.frequency.exponentialRampToValueAtTime(180, now + duration);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;

    const noiseGain = ctx.createGain();
    const peak = Math.min(0.7, volumeScale);
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(peak, now + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(bp).connect(lp).connect(noiseGain).connect(enemiesGain);

    const startHz = 90 + Math.random() * 18;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + duration * 0.55);

    const oscGain = ctx.createGain();
    const oscPeak = peak * 0.6;
    oscGain.gain.setValueAtTime(0, now);
    oscGain.gain.linearRampToValueAtTime(oscPeak, now + 0.005);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.75);

    osc.connect(oscGain).connect(enemiesGain);

    this.activeSplats.add(noise);
    this.activeSplats.add(osc);
    noise.onended = () => this.activeSplats.delete(noise);
    osc.onended = () => this.activeSplats.delete(osc);

    noise.start(now);
    noise.stop(now + duration);
    osc.start(now);
    osc.stop(now + duration);
  }

  // Sci-fi laser zap for the HQ base gun. A fast downward pitch sweep
  // (the classic "pew") on a dual-oscillator core plus a short noise
  // spark, so the last-ditch defence reads as an energy weapon firing
  // rather than the projectile-impact thud it used to borrow. Synthesised
  // (like playSplat) so multi-path levels can fire several beams a second
  // without loop seams or shipping a sample.
  private lastLaserAt = 0;
  private activeLasers = new Set<AudioScheduledSourceNode>();
  playLaser(volumeScale = 0.45) {
    const towersGain = this.busGains.towers;
    if (!this.ctx || !towersGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const wallNow = performance.now();
    if (wallNow - this.lastLaserAt < 45) return;
    if (this.activeLasers.size >= 8) return;
    this.lastLaserAt = wallNow;

    const dur = 0.16;
    const peak = Math.min(0.6, volumeScale);
    // Per-shot pitch jitter so a steady-firing HQ doesn't read as one
    // looping sample.
    const j = 0.96 + Math.random() * 0.08;

    // Master envelope: fast attack, exponential decay — the discharge
    // tailing off.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur);

    // Lowpass sweeps down with the pitch so the bright top doesn't sound
    // thin/harsh.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(5200, now);
    lp.frequency.exponentialRampToValueAtTime(1400, now + dur);
    lp.Q.value = 1;
    lp.connect(env).connect(towersGain);

    // Core sweep — saw drops fast from bright to low for the "pew".
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.setValueAtTime(1500 * j, now);
    o1.frequency.exponentialRampToValueAtTime(300 * j, now + dur * 0.85);
    const o1g = ctx.createGain();
    o1g.gain.value = 0.5;
    o1.connect(o1g).connect(lp);

    // Detuned square higher up adds the electric edge.
    const o2 = ctx.createOscillator();
    o2.type = "square";
    o2.frequency.setValueAtTime(2300 * j, now);
    o2.frequency.exponentialRampToValueAtTime(460 * j, now + dur * 0.85);
    const o2g = ctx.createGain();
    o2g.gain.value = 0.18;
    o2.connect(o2g).connect(lp);

    // Spark transient — brief noise burst gives the discharge its bite.
    const sparkDur = 0.012;
    const noise = this.makeNoise(ctx, sparkDur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(peak * 0.5, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + sparkDur);
    noise.connect(ng).connect(towersGain);

    for (const osc of [o1, o2]) {
      this.activeLasers.add(osc);
      osc.onended = () => this.activeLasers.delete(osc);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    }
    this.activeLasers.add(noise);
    noise.onended = () => this.activeLasers.delete(noise);
    noise.start(now);
    noise.stop(now + sparkDur);
  }

  // Footfall for heavy units. Synthesised (like playSplat) so the sim can
  // drive step rate freely without shipping per-surface samples or fighting
  // loop seams when many giants march at once. Two voices:
  //   "dino"  — sub-bass body thump + dull low-passed earth impact.
  //   "robot" — metallic servo tick + tonal clank + actuator whir + foot thud.
  private lastFootstepAt = 0;
  private activeFootsteps = new Set<AudioScheduledSourceNode>();
  playFootstep(source: "dino" | "robot", weight = 1) {
    const bus = source === "robot" ? this.busGains.towers : this.busGains.enemies;
    if (!this.ctx || !bus || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const wallNow = performance.now();
    // Global throttle + voice cap: a wave of synced giants can't machine-gun
    // the mix or spawn unbounded nodes.
    if (wallNow - this.lastFootstepAt < 26) return;
    if (this.activeFootsteps.size >= 12) return;
    this.lastFootstepAt = wallNow;
    if (source === "robot") this.synthRobotStep(ctx, bus, now);
    else this.synthDinoStep(ctx, bus, now, weight);
  }

  private trackStep(node: AudioScheduledSourceNode, start: number, stop: number) {
    this.activeFootsteps.add(node);
    node.onended = () => this.activeFootsteps.delete(node);
    node.start(start);
    node.stop(stop);
  }

  private makeNoise(ctx: AudioContext, durSec: number): AudioBufferSourceNode {
    const len = Math.ceil(durSec * ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    return node;
  }

  private synthDinoStep(ctx: AudioContext, dst: AudioNode, now: number, weight: number) {
    const w = Math.max(0.2, Math.min(1, weight));
    // Bigger creature → lower pitch, louder. Per-step jitter so a column of
    // titans doesn't read as one looping sample.
    const pitch = (1.05 - 0.25 * w) * (0.97 + Math.random() * 0.06);
    const vol = 0.3 * w;
    const dur = 0.22;

    // Sub-bass body thump — the weight landing.
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(82 * pitch, now);
    sub.frequency.exponentialRampToValueAtTime(34 * pitch, now + dur * 0.6);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(vol, now + 0.006);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    sub.connect(subGain).connect(dst);
    this.trackStep(sub, now, now + dur);

    // Dull earth impact — short low-passed noise burst.
    const noiseDur = 0.1;
    const noise = this.makeNoise(ctx, noiseDur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320 * pitch;
    lp.Q.value = 0.7;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0, now);
    nGain.gain.linearRampToValueAtTime(vol * 0.55, now + 0.004);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);
    noise.connect(lp).connect(nGain).connect(dst);
    this.trackStep(noise, now, now + noiseDur);
  }

  private synthRobotStep(ctx: AudioContext, dst: AudioNode, now: number) {
    const jitter = 0.95 + Math.random() * 0.1;

    // Metallic servo tick — band-passed noise click reads as struck metal.
    const tickDur = 0.06;
    const noise = this.makeNoise(ctx, tickDur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500 * jitter;
    bp.Q.value = 5;
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0, now);
    tickGain.gain.linearRampToValueAtTime(0.09, now + 0.002);
    tickGain.gain.exponentialRampToValueAtTime(0.001, now + tickDur);
    noise.connect(bp).connect(tickGain).connect(dst);
    this.trackStep(noise, now, now + tickDur);

    // Two short inharmonic partials add a tonal clank over the noise tick.
    for (const f of [760, 1140]) {
      const p = ctx.createOscillator();
      p.type = "triangle";
      p.frequency.value = f * jitter;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.04, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      p.connect(g).connect(dst);
      this.trackStep(p, now, now + 0.06);
    }

    // Actuator whir — quick downward sweep, the leg moving.
    const servo = ctx.createOscillator();
    servo.type = "sawtooth";
    servo.frequency.setValueAtTime(300 * jitter, now);
    servo.frequency.exponentialRampToValueAtTime(110, now + 0.09);
    const servoLp = ctx.createBiquadFilter();
    servoLp.type = "lowpass";
    servoLp.frequency.value = 900;
    const servoGain = ctx.createGain();
    servoGain.gain.setValueAtTime(0, now);
    servoGain.gain.linearRampToValueAtTime(0.05, now + 0.005);
    servoGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    servo.connect(servoLp).connect(servoGain).connect(dst);
    this.trackStep(servo, now, now + 0.1);

    // Small foot thud — mech weight, lighter than a dino's.
    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(80 * jitter, now);
    thud.frequency.exponentialRampToValueAtTime(46, now + 0.09);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0, now);
    thudGain.gain.linearRampToValueAtTime(0.13, now + 0.005);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    thud.connect(thudGain).connect(dst);
    this.trackStep(thud, now, now + 0.12);
  }

  // Move-order acknowledgement for the robot. Synthesised like the footsteps
  // so it shares the mech's voice: a rising two-step comms blip over a short
  // servo whir, reading as "order received" rather than a generic UI click.
  // Only fired for accepted orders — rejections keep ui("error").
  private lastRobotOrderAt = 0;
  private activeRobotOrder = new Set<AudioScheduledSourceNode>();
  playRobotOrder(volumeScale = 0.5) {
    const uiGain = this.busGains.ui;
    if (!this.ctx || !uiGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const wallNow = performance.now();
    // Rapid re-orders (dragging the destination around) shouldn't stack.
    if (wallNow - this.lastRobotOrderAt < 70) return;
    if (this.activeRobotOrder.size >= 8) return;
    this.lastRobotOrderAt = wallNow;

    const peak = Math.min(0.5, volumeScale);
    const track = (node: AudioScheduledSourceNode, start: number, stop: number) => {
      this.activeRobotOrder.add(node);
      node.onended = () => this.activeRobotOrder.delete(node);
      node.start(start);
      node.stop(stop);
    };

    // Two ascending square blips — the affirmative. Second one lands a
    // fifth up so the pair reads as confirmation, not an alarm.
    const blipDur = 0.055;
    for (const [i, freq] of [660, 990].entries()) {
      const at = now + i * 0.065;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak * 0.22, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, at + blipDur);
      // Soften the square's top harmonics so it sits under the blip's body
      // instead of piercing on repeat orders.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3200;
      osc.connect(lp).connect(g).connect(uiGain);
      track(osc, at, at + blipDur + 0.01);
    }

    // Servo whir sweeping up — the legs taking the order.
    const servoDur = 0.14;
    const servo = ctx.createOscillator();
    servo.type = "sawtooth";
    servo.frequency.setValueAtTime(180, now);
    servo.frequency.exponentialRampToValueAtTime(420, now + servoDur);
    const servoLp = ctx.createBiquadFilter();
    servoLp.type = "lowpass";
    servoLp.frequency.value = 1100;
    const servoGain = ctx.createGain();
    servoGain.gain.setValueAtTime(0, now);
    servoGain.gain.linearRampToValueAtTime(peak * 0.1, now + 0.01);
    servoGain.gain.exponentialRampToValueAtTime(0.001, now + servoDur);
    servo.connect(servoLp).connect(servoGain).connect(uiGain);
    track(servo, now, now + servoDur + 0.01);

    // Relay tick — tiny band-passed noise click for the mechanical bite.
    const tickDur = 0.02;
    const noise = this.makeNoise(ctx, tickDur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 4;
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(peak * 0.16, now);
    tickGain.gain.exponentialRampToValueAtTime(0.001, now + tickDur);
    noise.connect(bp).connect(tickGain).connect(uiGain);
    track(noise, now, now + tickDur);
  }

  ui(kind: "click" | "tab" | "open" | "close" | "error" | "select") {
    const map: Record<typeof kind, [string, number, number, number]> = {
      click: ["ui-click", 0.4, 30, 0.4],
      tab: ["ui-click", 0.4, 40, 0.4],
      open: ["ui-click", 0.4, 80, 0.4],
      close: ["ui-click", 0.4, 80, 0.4],
      error: ["ui-error", 0.5, 120, 0.6],
      select: ["ui-click", 0.42, 60, 0.4],
    };
    const [key, vol, cd, maxDur] = map[kind];
    this.play(key, "ui", vol, cd, maxDur);
  }

  private async ensureMusicLoaded(key: MusicTrack) {
    if (this.samples.has(key)) {
      const s = this.samples.get(key);
      if (s?.loaded) return true;
      if (s?.failed) return false;
      // Still loading — wait for it.
      while (this.samples.get(key)?.loaded === false && !this.samples.get(key)?.failed) {
        await new Promise((r) => setTimeout(r, 30));
      }
      return this.samples.get(key)?.loaded === true;
    }
    const url = this.musicUrls?.[key];
    if (!url) return false;
    await this.load(key, url);
    return this.samples.get(key)?.loaded === true;
  }

  startMusic(key: MusicTrack = "music") {
    this.crossfadeTo(key);
  }

  private clearMusicRefresh(playback: MusicPlayback) {
    if (playback.refreshTimer !== null) {
      window.clearTimeout(playback.refreshTimer);
      playback.refreshTimer = null;
    }
  }

  private stopMusicPlayback(playback: MusicPlayback, fadeSec: number) {
    if (!this.ctx) return;
    this.clearMusicRefresh(playback);
    const now = this.ctx.currentTime;
    // Read the live computed gain *before* cancelScheduledValues, otherwise
    // mid-ramp cancellation collapses the param back to its last anchored
    // setValueAtTime (0 during a fade-in) and we silently jump-cut instead
    // of fading out from where we actually were.
    const currentGain = playback.gain.gain.value;
    playback.gain.gain.cancelScheduledValues(now);
    playback.gain.gain.setValueAtTime(currentGain, now);
    playback.gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    for (const src of playback.sources) {
      try {
        src.stop(now + fadeSec + 0.05);
      } catch {
        /* ok */
      }
    }
    window.setTimeout(
      () => {
        playback.sources.clear();
        try {
          playback.gain.disconnect();
        } catch {
          /* ok */
        }
      },
      (fadeSec + 0.1) * 1000,
    );
  }

  private scheduleMusicRefresh(playback: MusicPlayback, buffer: AudioBuffer) {
    if (!this.ctx || this.music !== playback) return;
    this.clearMusicRefresh(playback);
    const overlap = Math.min(MUSIC_LOOP_OVERLAP_SEC, Math.max(0.04, buffer.duration * 0.01));
    const segment = Math.max(1, buffer.duration - overlap);
    const nextDelayMs = Math.max(5000, Math.min(15000, segment * 500));
    playback.refreshTimer = window.setTimeout(() => {
      if (this.music !== playback) return;
      this.refillMusicSchedule(playback, buffer);
    }, nextDelayMs);
  }

  private startMusicSegment(playback: MusicPlayback, buffer: AudioBuffer, startAt: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const overlap = Math.min(MUSIC_LOOP_OVERLAP_SEC, Math.max(0.04, buffer.duration * 0.01));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const srcGain = ctx.createGain();
    const fadeIn = !playback.firstSegment;
    const fadeOutStart = startAt + Math.max(0.1, buffer.duration - overlap);
    srcGain.gain.setValueAtTime(fadeIn ? 0 : 1, startAt);
    if (fadeIn) srcGain.gain.linearRampToValueAtTime(1, startAt + overlap);
    srcGain.gain.setValueAtTime(1, fadeOutStart);
    srcGain.gain.linearRampToValueAtTime(0, startAt + buffer.duration);
    src.connect(srcGain).connect(playback.gain);
    playback.sources.add(src);
    src.onended = () => playback.sources.delete(src);
    src.start(startAt);
    src.stop(startAt + buffer.duration + 0.02);
    playback.firstSegment = false;
    playback.nextStartAt = startAt + buffer.duration - overlap;
  }

  private refillMusicSchedule(playback: MusicPlayback, buffer: AudioBuffer) {
    if (!this.ctx || this.music !== playback) return;
    const scheduleAheadSec = Math.max(buffer.duration * 2, 45);
    while (playback.nextStartAt < this.ctx.currentTime + scheduleAheadSec) {
      this.startMusicSegment(playback, buffer, playback.nextStartAt);
    }
    this.scheduleMusicRefresh(playback, buffer);
  }

  async crossfadeTo(key: MusicTrack, fadeSec = 1.5) {
    if (!this.ctx || !this.musicGain) return;
    // Already playing this exact track — nothing to do.
    if (this.currentMusicKey === key && this.music) return;
    // A previous crossfadeTo for the same key is mid-load — don't tear it
    // down and start a duplicate. This drops the redundant request that
    // would otherwise race and create an orphaned playback.
    if (this.musicPendingKey === key) return;

    const token = ++this.musicRequestToken;
    this.currentMusicKey = key;
    this.musicPendingKey = key;

    // Fade out the current track immediately, before awaiting the new
    // track's load. Biome MP3s are 5-13MB and can take seconds on first
    // fetch — if we waited, the lobby track would keep playing well into
    // the level. Setting this.music to null also frees the slot for the
    // new track without re-fading the same source twice.
    if (this.music) this.stopMusicPlayback(this.music, fadeSec);
    this.music = null;

    const ok = await this.ensureMusicLoaded(key);
    // Superseded by a newer crossfadeTo or stopMusic — bail without
    // creating a playback that would orphan once the latest request lands.
    if (token !== this.musicRequestToken) return;
    if (!ok) {
      this.musicPendingKey = null;
      return;
    }
    const sample = this.samples.get(key);
    if (!sample?.buffer) {
      this.musicPendingKey = null;
      return;
    }
    if (!this.trimmedKeys.has(key)) {
      sample.buffer = this.trimBuffer(sample.buffer);
      this.trimmedKeys.add(key);
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const newGain = ctx.createGain();
    newGain.gain.setValueAtTime(0, now);
    newGain.gain.linearRampToValueAtTime(1, now + fadeSec);
    newGain.connect(this.musicGain);

    const playback: MusicPlayback = {
      gain: newGain,
      nextStartAt: now,
      firstSegment: true,
      refreshTimer: null,
      sources: new Set(),
    };
    this.music = playback;
    this.musicPendingKey = null;
    this.refillMusicSchedule(playback, sample.buffer);
  }

  stopMusic() {
    this.currentMusicKey = null;
    this.musicPendingKey = null;
    // Invalidate any in-flight crossfadeTo so it doesn't resurrect music
    // right after we stopped it.
    this.musicRequestToken++;
    if (!this.ctx) {
      this.music = null;
      return;
    }
    if (this.music) {
      this.stopMusicPlayback(this.music, 0.6);
      this.music = null;
    }
  }

  stopAllSfx(except?: string) {
    for (const [key, set] of this.activeVoices.entries()) {
      if (key === except) continue;
      for (const src of set) {
        try {
          src.stop();
        } catch {
          /* ok */
        }
      }
      set.clear();
    }
    this.stopAllFlames();
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (this.output) this.output.gain.value = v ? 0 : 1;
  }

  isMuted() {
    return this.muted;
  }

  setBusVolume(bus: SfxBus, v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    this.busVolumes[bus] = clamped;
    const g = this.busGains[bus];
    if (g) g.gain.value = clamped;
  }

  getBusVolume(bus: SfxBus) {
    return this.busVolumes[bus];
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  getMasterVolume() {
    return this.masterVolume;
  }

  setMusicVolume(v: number) {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.musicGain) this.musicGain.gain.value = this.musicVolume;
  }

  getMusicVolume() {
    return this.musicVolume;
  }

  // Plays a short representative sample on the right channel so a user
  // dragging a volume slider hears the level change in real time.
  previewBus(key: "master" | "music" | SfxBus) {
    if (!this.ctx || this.muted) return;
    switch (key) {
      case "master":
        // Master gates every channel; route through ui (short, non-musical).
        this.play("ui-click", "ui", 0.5, 0);
        break;
      case "music":
        this.playMusicPreview();
        break;
      case "ui":
        this.play("ui-click", "ui", 0.5, 0);
        break;
      case "towers":
        this.play("shoot-pulse", "towers", 0.45, 0, 0.4);
        break;
      case "enemies":
        this.playSplat(0.55);
        break;
      case "notifications":
        this.play("wave-start", "notifications", 0.5, 0, 0.6);
        break;
    }
  }

  private lastMusicPreviewAt = 0;
  private playMusicPreview() {
    if (!this.ctx || !this.musicGain || this.muted) return;
    const sample = this.samples.get("music");
    if (!sample?.loaded || !sample.buffer) return;
    const wallNow = performance.now();
    if (wallNow - this.lastMusicPreviewAt < 120) return;
    this.lastMusicPreviewAt = wallNow;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const duration = 0.55;
    const maxOffset = Math.max(0, sample.buffer.duration - duration - 0.1);
    const offset = Math.random() * maxOffset;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.7, now + 0.04);
    g.gain.setValueAtTime(0.7, now + duration - 0.12);
    g.gain.linearRampToValueAtTime(0, now + duration);
    src.connect(g).connect(this.musicGain);
    src.start(now, offset);
    try {
      src.stop(now + duration + 0.05);
    } catch {
      /* ok */
    }
  }

  destroy() {
    this.stopMusic();
    this.stopAllSfx();
    this.activeSplats.clear();
    this.samples.clear();
    this.trimmedKeys.clear();
    this.lastPlayedAt.clear();
    this.activeVoices.clear();
    this.musicUrls = null;
    this.music = null;
    this.currentMusicKey = null;
    this.musicPendingKey = null;
    const ctx = this.ctx;
    this.master = null;
    this.output = null;
    this.limiter = null;
    this.musicGain = null;
    this.busGains = { ui: null, towers: null, enemies: null, notifications: null };
    this.ctx = null;
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => {
        /* ok */
      });
    }
  }
}

export const audio = new AudioManager();

if (import.meta.hot) {
  import.meta.hot.dispose(() => audio.destroy());
}
