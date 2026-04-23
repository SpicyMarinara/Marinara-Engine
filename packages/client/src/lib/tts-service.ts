// ──────────────────────────────────────────────
// TTS Service — Server-proxied audio playback
// ──────────────────────────────────────────────

export type TTSState = "idle" | "loading" | "playing" | "error";

type StateListener = (state: TTSState, activeId: string | null) => void;

class TTSService {
  private audio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private abortController: AbortController | null = null;
  private state: TTSState = "idle";
  private sequence = 0;
  /** ID of the entity (e.g. message id) currently being spoken */
  private activeId: string | null = null;
  private listeners = new Set<StateListener>();

  // ── Listeners ─────────────────────────────────

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): TTSState {
    return this.state;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  private setState(s: TTSState, id: string | null = this.activeId) {
    this.state = s;
    this.activeId = s === "idle" || s === "error" ? null : id;
    this.listeners.forEach((fn) => fn(this.state, this.activeId));
  }

  private isCurrentSequence(sequence: number): boolean {
    return this.sequence === sequence;
  }

  // ── Playback ──────────────────────────────────

  /** Speak the given text. `id` is an optional caller-supplied key (e.g. message id) so callers can track which item is active. */
  async speak(text: string, id?: string): Promise<void> {
    this.stop();
    const sequence = ++this.sequence;

    this.setState("loading", id ?? null);
    const abortController = new AbortController();
    this.abortController = abortController;

    let res: Response;
    try {
      res = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: abortController.signal,
      });
    } catch (err) {
      if (!this.isCurrentSequence(sequence)) return;
      if (err instanceof Error && err.name === "AbortError") {
        this.setState("idle");
        return;
      }
      this.setState("error");
      return;
    }

    if (!this.isCurrentSequence(sequence)) return;
    if (!res.ok) {
      this.setState("error");
      return;
    }

    let blob: Blob;
    try {
      blob = await res.blob();
    } catch {
      if (!this.isCurrentSequence(sequence)) return;
      this.setState("error");
      return;
    }

    if (!this.isCurrentSequence(sequence)) return;
    if (this.abortController === abortController) {
      this.abortController = null;
    }

    const objectUrl = URL.createObjectURL(blob);
    if (!this.isCurrentSequence(sequence)) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    this.currentObjectUrl = objectUrl;

    const audio = new Audio(objectUrl);
    this.audio = audio;

    audio.onended = () => {
      if (!this.isCurrentSequence(sequence) || this.audio !== audio) return;
      this.cleanup();
      this.setState("idle");
    };
    audio.onerror = () => {
      if (!this.isCurrentSequence(sequence) || this.audio !== audio) return;
      this.cleanup();
      this.setState("error");
    };

    this.setState("playing", id ?? null);
    audio.play().catch(() => {
      if (!this.isCurrentSequence(sequence) || this.audio !== audio) return;
      this.cleanup();
      this.setState("error");
    });
  }

  /** Stop any in-progress fetch or playback. */
  stop(): void {
    this.sequence += 1;
    this.abortController?.abort();
    this.abortController = null;

    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }

    this.cleanup();
    this.setState("idle");
  }

  private cleanup(): void {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }
}

export const ttsService = new TTSService();
