// ──────────────────────────────────────────────
// TTS Configuration Card (Connections Panel)
// ──────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import {
  Volume2,
  Key,
  Globe,
  Check,
  Loader2,
  RefreshCw,
  Play,
  Square,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { toast } from "sonner";
import { useTTSConfig, useUpdateTTSConfig, useTTSVoices } from "../../../hooks/use-tts";
import { ttsService } from "../../../lib/tts-service";
import type { TTSConfig } from "@marinara-engine/shared";
import { TTS_API_KEY_MASK } from "@marinara-engine/shared";
import { HelpTooltip } from "../../ui/HelpTooltip";

// ── Sub-components ───────────────────────────────

function FieldRow({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-[var(--foreground)]">{label}</span>
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}

const INPUT_CLS =
  "w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg p-1.5 transition-colors hover:bg-[var(--secondary)]/50">
      <span className="text-xs">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-[var(--border)] accent-rose-400"
      />
    </label>
  );
}

// ── Main card ─────────────────────────────────────

export function TTSConfigCard() {
  const { data: savedConfig, isLoading } = useTTSConfig();
  const updateConfig = useUpdateTTSConfig();

  // Local draft state
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("tts-1");
  const [voice, setVoice] = useState("alloy");
  const [speed, setSpeed] = useState(1.0);
  const [autoplayRP, setAutoplayRP] = useState(false);
  const [autoplayConvo, setAutoplayConvo] = useState(false);
  const [autoplayGame, setAutoplayGame] = useState(false);

  const [expanded, setExpanded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ttsState, setTTSState] = useState(ttsService.getState());

  // Voice fetch — keyed on the *saved* baseUrl so it only refetches when saved
  const {
    data: voicesData,
    isFetching: fetchingVoices,
    refetch: refetchVoices,
    isError: voicesError,
  } = useTTSVoices(savedConfig?.baseUrl ?? "", savedConfig?.enabled ?? false);

  // Populate draft from server on load
  useEffect(() => {
    if (!savedConfig) return;
    setEnabled(savedConfig.enabled);
    setBaseUrl(savedConfig.baseUrl);
    setApiKey(savedConfig.apiKey); // masked value from server
    setModel(savedConfig.model);
    setVoice(savedConfig.voice);
    setSpeed(savedConfig.speed);
    setAutoplayRP(savedConfig.autoplayRP);
    setAutoplayConvo(savedConfig.autoplayConvo);
    setAutoplayGame(savedConfig.autoplayGame);
    setSaveStatus("idle");
  }, [savedConfig]);

  // Track TTS playback state for the preview button
  useEffect(() => ttsService.subscribe((s) => setTTSState(s)), []);

  // Clear debounce timer on unmount
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const mark = (overrides?: Partial<TTSConfig>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("idle");
    const payload: TTSConfig = {
      enabled,
      baseUrl,
      apiKey: apiKey === TTS_API_KEY_MASK ? TTS_API_KEY_MASK : apiKey,
      model,
      voice,
      speed,
      autoplayRP,
      autoplayConvo,
      autoplayGame,
      ...overrides,
    };
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await updateConfig.mutateAsync(payload);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2000);
      } catch {
        setSaveStatus("error");
        toast.error("Failed to save TTS settings.");
      }
    }, 600);
  };

  const handlePreview = () => {
    if (ttsState === "playing" || ttsState === "loading") {
      ttsService.stop();
      return;
    }
    void ttsService.speak("Hello! This is a preview of the text to speech voice.");
  };

  const voices = voicesData?.voices ?? [];
  const voicesFromProvider = voicesData?.fromProvider ?? false;

  if (isLoading) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-rose-400/20 bg-gradient-to-br from-rose-500/5 to-orange-500/5 p-3 transition-all",
        expanded && "border-rose-400/30",
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-400 to-orange-500 text-white shadow-sm">
          <Volume2 size="1rem" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Text to Speech</div>
          <div className="text-[0.6875rem] text-[var(--muted-foreground)]">
            {enabled
              ? `${model} · ${voice}${voicesFromProvider ? "" : " (built-in voices)"}`
              : "OpenAI-compatible TTS"}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Enable toggle */}
          <label className="flex cursor-pointer items-center gap-1.5" title={enabled ? "Disable TTS" : "Enable TTS"}>
            <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{enabled ? "On" : "Off"}</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  mark({ enabled: e.target.checked });
                }}
                className="peer sr-only"
              />
              <div className="h-5 w-9 rounded-full bg-[var(--border)] transition-colors peer-checked:bg-rose-400/70" />
              <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
            </div>
          </label>

          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp size="0.875rem" /> : <ChevronDown size="0.875rem" />}
          </button>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Base URL */}
          <FieldRow
            label="Base URL"
            help="The OpenAI-compatible TTS API endpoint. Use the default for OpenAI or point to a self-hosted server."
          >
            <div className="relative">
              <Globe size="0.875rem" className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400" />
              <input
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  mark({ baseUrl: e.target.value });
                }}
                className={cn(INPUT_CLS, "pl-8 font-mono")}
                placeholder="https://api.openai.com/v1"
              />
            </div>
          </FieldRow>

          {/* API Key */}
          <FieldRow
            label="API Key"
            help="Your API key for the TTS provider. Encrypted at rest. Keep the masked value to preserve the current key, or clear the field to remove it."
          >
            <div className="relative">
              <Key size="0.875rem" className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400" />
              <input
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  mark({ apiKey: e.target.value === TTS_API_KEY_MASK ? TTS_API_KEY_MASK : e.target.value });
                }}
                type="password"
                className={cn(INPUT_CLS, "pl-8")}
                placeholder="Enter API key or clear to remove"
              />
            </div>
            <p className="text-[0.625rem] text-[var(--muted-foreground)]">
              Encrypted at rest · Keep the masked value to preserve the current key, or clear it to remove the saved key
            </p>
          </FieldRow>

          {/* Model */}
          <FieldRow label="Model" help="TTS model to use. e.g. tts-1, tts-1-hd, gpt-4o-mini-tts, or any model your provider supports.">
            <input
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                mark({ model: e.target.value });
              }}
              className={INPUT_CLS}
              placeholder="tts-1"
            />
          </FieldRow>

          {/* Voice */}
          <FieldRow label="Voice" help="Voice to use for synthesis. Fetched from your configured provider.">
            <div className="flex gap-2">
              <select
                value={voice}
                onChange={(e) => {
                  setVoice(e.target.value);
                  mark({ voice: e.target.value });
                }}
                disabled={fetchingVoices || voices.length === 0}
                className={cn(INPUT_CLS, "flex-1 cursor-pointer appearance-none")}
              >
                {fetchingVoices && <option>Loading voices…</option>}
                {!fetchingVoices && voices.length === 0 && !voicesError && (
                  <option>Save config to load voices</option>
                )}
                {!fetchingVoices && voicesError && <option>Could not load voices</option>}
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void refetchVoices()}
                disabled={fetchingVoices || !savedConfig?.enabled}
                className="flex shrink-0 items-center gap-1 rounded-xl bg-[var(--secondary)] px-3 py-2 text-xs ring-1 ring-[var(--border)] transition-colors hover:ring-rose-400/60 disabled:opacity-50"
                title="Refresh voices from provider"
              >
                <RefreshCw size="0.75rem" className={cn(fetchingVoices && "animate-spin")} />
              </button>
            </div>
            {!voicesFromProvider && voices.length > 0 && (
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                Showing OpenAI built-in voices — save & enable to load from your provider
              </p>
            )}
          </FieldRow>

          {/* Speed */}
          <FieldRow label={`Speed — ${speed.toFixed(2)}×`} help="Playback speed. 1.0 is normal; range is 0.25×–4.0×.">
            <input
              type="range"
              min={0.25}
              max={4.0}
              step={0.05}
              value={speed}
              onChange={(e) => {
                setSpeed(parseFloat(e.target.value));
                mark({ speed: parseFloat(e.target.value) });
              }}
              className="w-full accent-rose-400"
            />
            <div className="flex justify-between text-[0.6rem] text-[var(--muted-foreground)]">
              <span>0.25×</span>
              <span>1.0×</span>
              <span>4.0×</span>
            </div>
          </FieldRow>

          {/* Auto-play */}
          <div className="space-y-1">
            <span className="text-xs font-medium">Auto-play</span>
            <ToggleRow
              label="Roleplay messages"
              checked={autoplayRP}
              onChange={(v) => {
                setAutoplayRP(v);
                mark({ autoplayRP: v });
              }}
            />
            <ToggleRow
              label="Conversation messages"
              checked={autoplayConvo}
              onChange={(v) => {
                setAutoplayConvo(v);
                mark({ autoplayConvo: v });
              }}
            />
            <ToggleRow
              label="Game narration"
              checked={autoplayGame}
              onChange={(v) => {
                setAutoplayGame(v);
                mark({ autoplayGame: v });
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {/* Preview */}
            <button
              onClick={handlePreview}
              disabled={!savedConfig?.enabled || ttsState === "loading"}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs ring-1 transition-all",
                ttsState === "playing"
                  ? "bg-rose-500/10 text-rose-400 ring-rose-400/30 hover:bg-rose-500/20"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:text-[var(--foreground)] hover:ring-rose-400/60",
                (!savedConfig?.enabled || ttsState === "loading") && "cursor-not-allowed opacity-50",
              )}
              title={ttsState === "playing" ? "Stop preview" : "Preview voice"}
            >
              {ttsState === "loading" ? (
                <Loader2 size="0.75rem" className="animate-spin" />
              ) : ttsState === "playing" ? (
                <Square size="0.75rem" />
              ) : (
                <Play size="0.75rem" />
              )}
              {ttsState === "loading" ? "Loading…" : ttsState === "playing" ? "Stop" : "Preview"}
            </button>

            <div className="flex-1" />

            {/* Auto-save status */}
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-[var(--muted-foreground)]">
                <Loader2 size="0.625rem" className="animate-spin" />
                Saving…
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-emerald-400">
                <Check size="0.625rem" />
                Saved
              </span>
            )}
            {saveStatus === "error" && (
              <span className="text-[0.6875rem] text-rose-400">Save failed</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
