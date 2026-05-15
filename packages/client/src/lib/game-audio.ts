// ──────────────────────────────────────────────
// Game: Audio Manager
//
// Handles music playback with crossfade, SFX,
// and ambient sound layers. Uses Web Audio API
// for smooth transitions.
// ──────────────────────────────────────────────

const CROSSFADE_MS = 2000;
const SFX_POOL_SIZE = 8;
const SILENT_AUDIO_DATA_URI =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

type AssetMap = Record<string, { path: string }>;
type AudioSessionType = "auto" | "ambient" | "playback" | "transient" | "transient-solo" | "play-and-record";
type NavigatorWithAudioSession = Navigator & {
  audioSession?: {
    type: AudioSessionType;
  };
};

interface LoopingAudioLayer {
  ready: Promise<void>;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setMuted: (muted: boolean) => void;
  stop: () => void;
}

export interface OneShotAudioLayer {
  ready: Promise<void>;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  stop: () => void;
}

interface OneShotAudioOptions {
  volume: number;
  muted?: boolean;
  onStarted?: () => void;
  onEnded?: () => void;
  onError?: () => void;
}

/** Release an audio element without triggering an "Invalid URI" console error. */
function releaseAudio(el: HTMLAudioElement): void {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

function normalizeAssetTag(tag: string): string {
  return tag.trim().replace(/\\/g, "/").replace(/\//g, ":");
}

function assetTagToPath(tag: string): string {
  return normalizeAssetTag(tag).replace(/:/g, "/");
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function setAmbientAudioSession(): void {
  if (typeof navigator === "undefined") return;
  const audioSession = (navigator as NavigatorWithAudioSession).audioSession;
  if (!audioSession) return;

  try {
    if (audioSession.type !== "ambient") {
      audioSession.type = "ambient";
    }
  } catch {
    // Audio Session API support is platform-specific. Unsupported browsers can
    // still play normally; they just cannot request mix-with-others behavior.
  }
}

/** Singleton audio manager for game mode. */
class GameAudioManager {
  private musicElement: LoopingAudioLayer | null = null;
  private nextMusicElement: LoopingAudioLayer | null = null;
  private ambientElement: LoopingAudioLayer | null = null;
  private sfxPool: HTMLAudioElement[] = [];
  private sfxIndex = 0;
  private sfxAudioContext: AudioContext | null = null;
  private mediaUnlockElement: HTMLAudioElement | null = null;
  private mediaNodes = new WeakMap<HTMLAudioElement, { source: MediaElementAudioSourceNode; gain: GainNode }>();
  private audioContextUnlocked = false;
  private musicVolume = 0.5;
  private sfxVolume = 0.5;
  private ambientVolume = 0.35;
  private isMuted = false;
  private currentMusicTag: string | null = null;
  private currentAmbientTag: string | null = null;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  /** Tracks tags whose play() was rejected by autoplay policy. */
  private pendingMusic: { tag: string; manifest?: Record<string, { path: string }> | null } | null = null;
  private pendingAmbient: { tag: string; manifest?: Record<string, { path: string }> | null } | null = null;
  private gestureListenerAttached = false;
  /** True after the user has interacted with the page (click/touch/key). */
  private userHasInteracted = false;
  private interactionListenerAttached = false;

  constructor() {
    setAmbientAudioSession();
    // Pre-create SFX pool
    for (let i = 0; i < SFX_POOL_SIZE; i++) {
      const el = new Audio();
      el.preload = "auto";
      this.sfxPool.push(el);
    }
    this.attachInteractionListener();
  }

  /** Track user interaction so we know autoplay is allowed. */
  private attachInteractionListener(): void {
    if (this.interactionListenerAttached) return;
    this.interactionListenerAttached = true;
    const handler = () => {
      this.unlock();
      document.removeEventListener("click", handler, true);
      document.removeEventListener("touchstart", handler, true);
      document.removeEventListener("keydown", handler, true);
      document.removeEventListener("pointerdown", handler, true);
      // Retry any pending audio now that the user has interacted
      this.retryPending();
    };
    document.addEventListener("click", handler, true);
    document.addEventListener("touchstart", handler, true);
    document.addEventListener("keydown", handler, true);
    document.addEventListener("pointerdown", handler, true);
  }

  /** Attach a one-time user gesture listener to retry blocked audio. */
  private ensureGestureListener(): void {
    if (this.gestureListenerAttached) return;
    this.gestureListenerAttached = true;
    const handler = () => {
      document.removeEventListener("click", handler, true);
      document.removeEventListener("touchstart", handler, true);
      document.removeEventListener("keydown", handler, true);
      document.removeEventListener("pointerdown", handler, true);
      this.gestureListenerAttached = false;
      this.unlock();
      this.retryPending();
    };
    document.addEventListener("click", handler, true);
    document.addEventListener("touchstart", handler, true);
    document.addEventListener("keydown", handler, true);
    document.addEventListener("pointerdown", handler, true);
  }

  /** Retry any autoplay-blocked audio. Call from a user gesture for best results. */
  retryPending(): void {
    if (this.pendingMusic) {
      const { tag, manifest } = this.pendingMusic;
      this.pendingMusic = null;
      this.currentMusicTag = null;
      this.playMusic(tag, manifest);
    }
    if (this.pendingAmbient) {
      const { tag, manifest } = this.pendingAmbient;
      this.pendingAmbient = null;
      this.currentAmbientTag = null;
      this.playAmbient(tag, manifest);
    }
  }

  /** Resolve an asset tag to a URL. */
  private resolveUrl(tag: string): string {
    // Tag format: "category:subcategory:name" → path: "category/subcategory/name.*"
    // The manifest stores the full relative path with extension
    const path = assetTagToPath(tag);
    return `/api/game-assets/file/${path}`;
  }

  /** Try to find the full path from manifest, falling back to tag-based URL. */
  resolveAssetUrl(tag: string, manifest?: AssetMap | null): string {
    const normalizedTag = normalizeAssetTag(tag);
    const manifestEntry = manifest?.[tag] ?? manifest?.[normalizedTag];
    if (manifestEntry) {
      return `/api/game-assets/file/${manifestEntry.path}`;
    }
    return this.resolveUrl(tag);
  }

  private getSfxAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.sfxAudioContext) {
      const AudioContextCtor =
        window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      this.sfxAudioContext = new AudioContextCtor();
    }
    if (this.sfxAudioContext.state === "suspended") {
      void this.sfxAudioContext.resume().catch(() => {});
    }
    return this.sfxAudioContext;
  }

  private async resumeAudioContext(ctx: AudioContext): Promise<boolean> {
    if (ctx.state === "running") {
      this.audioContextUnlocked = true;
      return true;
    }

    await ctx.resume().catch(() => undefined);
    this.audioContextUnlocked = (ctx.state as string) === "running";
    return this.audioContextUnlocked;
  }

  private primeMediaElement(): void {
    if (typeof window === "undefined") return;
    if (!this.mediaUnlockElement) {
      const audio = new Audio(SILENT_AUDIO_DATA_URI);
      audio.preload = "auto";
      audio.muted = true;
      audio.volume = 0;
      this.mediaUnlockElement = audio;
    }

    const audio = this.mediaUnlockElement;
    try {
      audio.currentTime = 0;
    } catch {
      // Some browsers do not allow seeking before metadata is ready.
    }
    void audio
      .play()
      .then(() => {
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch {
          // Ignore unlock cleanup failures.
        }
      })
      .catch(() => {});
  }

  /** Unlock Web Audio from a user gesture, especially for mobile Safari. */
  unlock(): void {
    this.userHasInteracted = true;
    setAmbientAudioSession();
    this.primeMediaElement();
    const ctx = this.getSfxAudioContext();
    if (!ctx || (this.audioContextUnlocked && ctx.state === "running")) return;

    try {
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(ctx.destination);
      source.start(0);
      if (ctx.state === "running") {
        this.audioContextUnlocked = true;
      } else {
        void ctx
          .resume()
          .then(() => {
            this.audioContextUnlocked = ctx.state === "running";
          })
          .catch(() => {
            this.audioContextUnlocked = false;
          });
      }
    } catch {
      // If the unlock pulse fails, normal playback can still fall back to media element audio.
      this.audioContextUnlocked = false;
    }
  }

  private getMediaGain(audio: HTMLAudioElement): GainNode | null {
    const existing = this.mediaNodes.get(audio);
    if (existing) return existing.gain;

    const ctx = this.getSfxAudioContext();
    if (!ctx) return null;

    try {
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      this.mediaNodes.set(audio, { source, gain });
      return gain;
    } catch {
      return null;
    }
  }

  private setElementLayerVolume(audio: HTMLAudioElement | null, volume: number): void {
    if (!audio) return;
    const nextVolume = Math.max(0, Math.min(1, volume));
    const gain = this.getMediaGain(audio);
    if (gain) {
      // iOS ignores HTMLMediaElement.volume for media playback, so keep the
      // element open and use the Web Audio gain node as the exact volume control.
      audio.volume = 1;
      gain.gain.setValueAtTime(nextVolume, gain.context.currentTime);
      return;
    }
    audio.volume = nextVolume;
  }

  private createLoopingAudioLayer(url: string, volume: number, muted: boolean): LoopingAudioLayer {
    let currentVolume = clampUnit(volume);
    let currentMuted = muted;
    let stopped = false;
    let source: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;
    let fallbackAudio: HTMLAudioElement | null = null;

    const applyVolume = () => {
      const effectiveVolume = currentMuted ? 0 : currentVolume;
      if (gain) {
        gain.gain.setValueAtTime(effectiveVolume, gain.context.currentTime);
      }
      if (fallbackAudio) {
        this.setElementLayerVolume(fallbackAudio, effectiveVolume);
        fallbackAudio.muted = currentMuted;
      }
    };

    const startFallbackAudio = async () => {
      const audio = new Audio(url);
      audio.loop = true;
      fallbackAudio = audio;
      applyVolume();
      await audio.play();
    };

    const ready = (async () => {
      const ctx = this.getSfxAudioContext();
      if (!ctx) {
        await startFallbackAudio();
        return;
      }

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Audio fetch failed (${response.status})`);
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (stopped) return;
        if (!(await this.resumeAudioContext(ctx))) {
          throw new Error("Audio context is not running");
        }

        const nextSource = ctx.createBufferSource();
        const nextGain = ctx.createGain();
        nextSource.buffer = buffer;
        nextSource.loop = true;
        nextSource.connect(nextGain);
        nextGain.connect(ctx.destination);
        source = nextSource;
        gain = nextGain;
        applyVolume();
        nextSource.start();
      } catch {
        if (stopped) return;
        await startFallbackAudio();
      }
    })();

    return {
      ready,
      setVolume: (nextVolume: number) => {
        currentVolume = clampUnit(nextVolume);
        applyVolume();
      },
      getVolume: () => currentVolume,
      setMuted: (nextMuted: boolean) => {
        currentMuted = nextMuted;
        applyVolume();
      },
      stop: () => {
        stopped = true;
        if (source) {
          try {
            source.stop();
          } catch {
            // Already stopped.
          }
          source.disconnect();
          source = null;
        }
        if (gain) {
          gain.disconnect();
          gain = null;
        }
        if (fallbackAudio) {
          releaseAudio(fallbackAudio);
          fallbackAudio = null;
        }
      },
    };
  }

  playOneShot(url: string, options: OneShotAudioOptions): OneShotAudioLayer {
    let currentVolume = clampUnit(options.volume);
    let currentMuted = options.muted ?? false;
    let stopped = false;
    let started = false;
    let source: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;
    let fallbackAudio: HTMLAudioElement | null = null;

    const applyVolume = () => {
      const effectiveVolume = currentMuted ? 0 : currentVolume;
      if (gain) {
        gain.gain.setValueAtTime(effectiveVolume, gain.context.currentTime);
      }
      if (fallbackAudio) {
        this.setMediaElementVolume(fallbackAudio, effectiveVolume);
        fallbackAudio.muted = currentMuted;
      }
    };

    const cleanup = () => {
      if (source) {
        source.onended = null;
        source.disconnect();
        source = null;
      }
      if (gain) {
        gain.disconnect();
        gain = null;
      }
      if (fallbackAudio) {
        fallbackAudio.onended = null;
        fallbackAudio.onerror = null;
        releaseAudio(fallbackAudio);
        fallbackAudio = null;
      }
    };

    const finish = () => {
      if (stopped) return;
      stopped = true;
      cleanup();
      options.onEnded?.();
    };

    const fail = () => {
      if (stopped) return;
      stopped = true;
      cleanup();
      options.onError?.();
    };

    const markStarted = () => {
      if (started || stopped) return;
      started = true;
      options.onStarted?.();
    };

    const startFallbackAudio = async () => {
      const audio = new Audio(url);
      fallbackAudio = audio;
      audio.onended = finish;
      audio.onerror = fail;
      applyVolume();
      await audio.play();
      markStarted();
    };

    const ready = (async () => {
      const ctx = this.getSfxAudioContext();
      if (!ctx) {
        await startFallbackAudio();
        return;
      }

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Audio fetch failed (${response.status})`);
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (stopped) return;
        if (!(await this.resumeAudioContext(ctx))) {
          throw new Error("Audio context is not running");
        }

        const nextSource = ctx.createBufferSource();
        const nextGain = ctx.createGain();
        nextSource.buffer = buffer;
        nextSource.connect(nextGain);
        nextGain.connect(ctx.destination);
        nextSource.onended = finish;
        source = nextSource;
        gain = nextGain;
        applyVolume();
        nextSource.start();
        markStarted();
      } catch {
        if (stopped) return;
        await startFallbackAudio();
      }
    })().catch(() => {
      fail();
    });

    return {
      ready,
      setVolume: (nextVolume: number) => {
        currentVolume = clampUnit(nextVolume);
        applyVolume();
      },
      setMuted: (nextMuted: boolean) => {
        currentMuted = nextMuted;
        applyVolume();
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (source) {
          try {
            source.stop();
          } catch {
            // Already stopped.
          }
        }
        cleanup();
      },
    };
  }

  private playTone(
    ctx: AudioContext,
    startOffset: number,
    duration: number,
    fromFrequency: number,
    toFrequency: number,
    volume: number,
    type: OscillatorType = "sine",
  ): void {
    const now = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromFrequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * this.sfxVolume), now + duration * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private playNoise(
    ctx: AudioContext,
    startOffset: number,
    duration: number,
    volume: number,
    filterType: BiquadFilterType = "highpass",
    frequency = 900,
  ): void {
    const now = ctx.currentTime + startOffset;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const decay = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * decay;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(Math.max(0.0001, volume * this.sfxVolume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  }

  private playProceduralSfx(tag: string): boolean {
    if (this.isMuted || this.sfxVolume <= 0 || !this.userHasInteracted) return false;
    const ctx = this.getSfxAudioContext();
    if (!ctx) return false;
    const normalizedTag = normalizeAssetTag(tag);

    if (/menu-hover$/.test(normalizedTag)) {
      this.playTone(ctx, 0, 0.04, 760, 920, 0.08, "triangle");
      return true;
    }
    if (/(menu-confirm|menu-select|click)$/.test(normalizedTag)) {
      this.playTone(ctx, 0, 0.045, 520, 760, 0.1, "triangle");
      this.playTone(ctx, 0.04, 0.055, 760, 1040, 0.08, "triangle");
      return true;
    }
    if (/(coin-pickup|victory)$/.test(normalizedTag)) {
      [523, 659, 784, 1047].forEach((freq, index) => {
        this.playTone(ctx, index * 0.07, 0.12, freq, freq * 1.01, 0.1, "triangle");
      });
      return true;
    }
    if (/(menu-cancel|defeat)$/.test(normalizedTag)) {
      this.playTone(ctx, 0, 0.16, 220, 110, 0.13, "sawtooth");
      return true;
    }
    if (/(magic-cast)$/.test(normalizedTag)) {
      [440, 660, 880].forEach((freq, index) => {
        this.playTone(ctx, index * 0.035, 0.16, freq, freq * 1.35, 0.07, "sine");
      });
      return true;
    }
    if (/(spell-hit)$/.test(normalizedTag)) {
      this.playTone(ctx, 0, 0.16, 150, 70, 0.12, "sawtooth");
      this.playNoise(ctx, 0, 0.12, 0.08, "lowpass", 800);
      return true;
    }
    if (/(sword-swing-2)$/.test(normalizedTag)) {
      this.playNoise(ctx, 0, 0.18, 0.13, "highpass", 1200);
      this.playTone(ctx, 0.02, 0.14, 280, 520, 0.09, "square");
      return true;
    }
    if (/(sword-swing-3)$/.test(normalizedTag)) {
      this.playNoise(ctx, 0, 0.12, 0.09, "highpass", 1600);
      return true;
    }
    if (/(sword-swing|sword-unsheathe)$/.test(normalizedTag)) {
      this.playNoise(ctx, 0, 0.14, 0.1, "highpass", 1300);
      this.playTone(ctx, 0.015, 0.08, 360, 620, 0.06, "triangle");
      return true;
    }
    if (/(chainmail|metal-ring)$/.test(normalizedTag)) {
      this.playNoise(ctx, 0, 0.1, 0.08, "bandpass", 1800);
      this.playTone(ctx, 0.02, 0.11, 520, 460, 0.07, "square");
      return true;
    }
    if (/(potion|item)$/.test(normalizedTag)) {
      this.playTone(ctx, 0, 0.08, 420, 560, 0.08, "sine");
      this.playTone(ctx, 0.07, 0.09, 560, 740, 0.07, "sine");
      return true;
    }

    return false;
  }

  /** Play background music with crossfade. */
  playMusic(tag: string, manifest?: Record<string, { path: string }> | null): void {
    if (tag === this.currentMusicTag) return;
    const previousMusicTag = this.currentMusicTag;
    this.currentMusicTag = tag;

    // Defer playback if the user hasn't interacted yet (avoids autoplay warnings)
    if (!this.userHasInteracted) {
      this.pendingMusic = { tag, manifest };
      return;
    }

    const url = this.resolveAssetUrl(tag, manifest);
    const newAudio = this.createLoopingAudioLayer(url, 0, this.isMuted);

    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }

    const oldAudio = this.musicElement;
    if (this.nextMusicElement && this.nextMusicElement !== oldAudio) {
      this.nextMusicElement.stop();
      this.nextMusicElement = null;
    }
    if (oldAudio) {
      oldAudio.setMuted(this.isMuted);
      oldAudio.setVolume(this.musicVolume);
    }
    this.nextMusicElement = newAudio;

    newAudio.ready
      .then(() => {
        if (this.nextMusicElement !== newAudio) {
          newAudio.stop();
          return;
        }
        // Playback started — clear any pending retry
        this.pendingMusic = null;
        const steps = CROSSFADE_MS / 50;
        const fadeStep = this.musicVolume / steps;
        let step = 0;

        const interval = setInterval(() => {
          if (this.nextMusicElement !== newAudio) {
            clearInterval(interval);
            if (this.fadeInterval === interval) this.fadeInterval = null;
            newAudio.stop();
            return;
          }

          step++;
          // Fade in new
          newAudio.setMuted(this.isMuted);
          newAudio.setVolume(Math.min(this.musicVolume, fadeStep * step));
          // Fade out old
          if (oldAudio) {
            oldAudio.setMuted(this.isMuted);
            oldAudio.setVolume(Math.max(0, this.musicVolume - fadeStep * step));
          }

          if (step >= steps) {
            clearInterval(interval);
            if (this.fadeInterval === interval) this.fadeInterval = null;
            if (oldAudio) {
              oldAudio.stop();
            }
            this.musicElement = newAudio;
            this.nextMusicElement = null;
          }
        }, 50);

        this.fadeInterval = interval;
      })
      .catch(() => {
        if (this.nextMusicElement !== newAudio) {
          newAudio.stop();
          return;
        }

        this.nextMusicElement = null;
        newAudio.stop();

        // Autoplay blocked — queue for retry on user gesture
        this.pendingMusic = { tag, manifest };
        this.currentMusicTag = previousMusicTag;
        if (oldAudio) {
          oldAudio.setMuted(this.isMuted);
          oldAudio.setVolume(this.musicVolume);
        }
        this.ensureGestureListener();
      });
  }

  /** Stop music with fade out. */
  stopMusic(): void {
    this.currentMusicTag = null;
    this.pendingMusic = null;

    // Cancel any running crossfade so the next-element doesn't keep playing
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    if (this.nextMusicElement) {
      this.nextMusicElement.stop();
      this.nextMusicElement = null;
    }

    if (!this.musicElement) return;

    const audio = this.musicElement;
    this.musicElement = null;
    const steps = CROSSFADE_MS / 50;
    const fadeStep = audio.getVolume() / steps;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      audio.setVolume(Math.max(0, audio.getVolume() - fadeStep));
      if (step >= steps) {
        clearInterval(interval);
        audio.stop();
      }
    }, 50);
  }

  /** Play a one-shot sound effect. */
  playSfx(tag: string, manifest?: AssetMap | null): void {
    if (this.isMuted || this.sfxVolume <= 0 || !this.userHasInteracted) return;
    const url = this.resolveAssetUrl(tag, manifest);
    const audio = this.sfxPool[this.sfxIndex % SFX_POOL_SIZE]!;
    this.sfxIndex++;
    audio.onerror = () => {
      audio.onerror = null;
      this.playProceduralSfx(tag);
    };
    audio.src = url;
    this.setElementLayerVolume(audio, this.sfxVolume);
    audio.muted = false;
    audio.currentTime = 0;
    audio.play().catch(() => {
      this.playProceduralSfx(tag);
    });
  }

  /** Set looping ambient sound. */
  playAmbient(tag: string, manifest?: Record<string, { path: string }> | null): void {
    if (tag === this.currentAmbientTag) return;
    const previousAmbientTag = this.currentAmbientTag;
    const previousAmbient = this.ambientElement;
    this.currentAmbientTag = tag;

    // Defer playback if the user hasn't interacted yet (avoids autoplay warnings)
    if (!this.userHasInteracted) {
      this.pendingAmbient = { tag, manifest };
      return;
    }

    const url = this.resolveAssetUrl(tag, manifest);
    const nextAmbient = this.createLoopingAudioLayer(url, this.ambientVolume, this.isMuted);
    nextAmbient.ready
      .then(() => {
        if (this.currentAmbientTag !== tag) {
          nextAmbient.stop();
          return;
        }

        if (previousAmbient && previousAmbient !== nextAmbient) {
          previousAmbient.stop();
        }
        this.ambientElement = nextAmbient;
        this.pendingAmbient = null;
      })
      .catch((err) => {
        nextAmbient.stop();
        if (this.currentAmbientTag !== tag) {
          return;
        }

        console.warn("[audio] Ambient playback failed:", tag, err);
        this.pendingAmbient = { tag, manifest };
        this.currentAmbientTag = previousAmbientTag;
        this.ambientElement = previousAmbient ?? null;
        if (previousAmbient) {
          previousAmbient.setMuted(this.isMuted);
          previousAmbient.setVolume(this.ambientVolume);
        }
        this.ensureGestureListener();
      });
  }

  /** Stop ambient sound. */
  stopAmbient(): void {
    this.currentAmbientTag = null;
    this.pendingAmbient = null;
    if (this.ambientElement) {
      this.ambientElement.stop();
      this.ambientElement = null;
    }
  }

  /** Set global mute state. */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.musicElement) {
      this.musicElement.setMuted(muted);
    }
    if (this.nextMusicElement) {
      this.nextMusicElement.setMuted(muted);
    }
    if (this.ambientElement) {
      this.ambientElement.setMuted(muted);
    }
    // Mute any currently-playing SFX
    for (const el of this.sfxPool) {
      this.setElementLayerVolume(el, muted ? 0 : this.sfxVolume);
      el.muted = muted;
    }
  }

  /** Set volume levels (0–1). */
  setVolumes(music: number, sfx: number, ambient: number): void {
    this.musicVolume = Math.max(0, Math.min(1, music));
    this.sfxVolume = Math.max(0, Math.min(1, sfx));
    this.ambientVolume = Math.max(0, Math.min(1, ambient));
    if (!this.isMuted) {
      this.musicElement?.setVolume(this.musicVolume);
      this.nextMusicElement?.setVolume(this.musicVolume);
      this.ambientElement?.setVolume(this.ambientVolume);
    }
    for (const el of this.sfxPool) {
      this.setElementLayerVolume(el, this.sfxVolume);
    }
  }

  /** Set externally owned game audio without forcing it through Web Audio. */
  setMediaElementVolume(audio: HTMLAudioElement | null, volume: number): void {
    if (!audio) return;
    const nextVolume = clampUnit(volume);
    audio.volume = nextVolume;

    const gain = this.mediaNodes.get(audio)?.gain;
    if (gain) {
      gain.gain.setValueAtTime(nextVolume, gain.context.currentTime);
    }
  }

  /** Stop everything and clean up. */
  dispose(): void {
    this.stopMusic();
    this.stopAmbient();
    for (const el of this.sfxPool) {
      releaseAudio(el);
    }
  }

  /** Get current playback state. */
  getState() {
    return {
      musicTag: this.currentMusicTag,
      ambientTag: this.currentAmbientTag,
      isMuted: this.isMuted,
      musicVolume: this.musicVolume,
      sfxVolume: this.sfxVolume,
      ambientVolume: this.ambientVolume,
    };
  }
}

/** Global singleton instance. */
export const audioManager = new GameAudioManager();
