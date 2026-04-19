// ──────────────────────────────────────────────
// Full-Page Connection Editor
// Click a connection → opens this editor (like presets/characters)
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useUIStore } from "../../stores/ui.store";
import {
  useConnection,
  useConnections,
  useUpdateConnection,
  useDeleteConnection,
  useTestConnection,
  useTestMessage,
  useFetchModels,
} from "../../hooks/use-connections";
import {
  ArrowLeft,
  Save,
  Trash2,
  Link,
  Wifi,
  MessageSquare,
  Search,
  Tag,
  Check,
  X,
  Loader2,
  AlertCircle,
  Zap,
  Globe,
  Key,
  Server,
  Bot,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { DraftNumberInput } from "../ui/DraftNumberInput";
import { HelpTooltip } from "../ui/HelpTooltip";
import { PROVIDERS, MODEL_LISTS, IMAGE_GENERATION_SOURCES, type APIProvider } from "@marinara-engine/shared";

/** Links where users can obtain API keys for each provider */
const API_KEY_LINKS: Partial<Record<APIProvider, { label: string; url: string }>> = {
  openai: { label: "Get your OpenAI API key", url: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Get your Anthropic API key", url: "https://console.anthropic.com/settings/keys" },
  google: { label: "Get your Google AI API key", url: "https://aistudio.google.com/apikey" },
  mistral: { label: "Get your Mistral API key", url: "https://console.mistral.ai/api-keys" },
  cohere: { label: "Get your Cohere API key", url: "https://dashboard.cohere.com/api-keys" },
  openrouter: { label: "Get your OpenRouter API key", url: "https://openrouter.ai/keys" },
  nanogpt: { label: "Get your NanoGPT API key", url: "https://nano-gpt.com/api" },
};

// ═══════════════════════════════════════════════
//  Main Editor
// ═══════════════════════════════════════════════

export function ConnectionEditor() {
  const connectionDetailId = useUIStore((s) => s.connectionDetailId);
  const closeConnectionDetail = useUIStore((s) => s.closeConnectionDetail);

  const { data: conn, isLoading } = useConnection(connectionDetailId);
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();
  const testConnection = useTestConnection();
  const testMessage = useTestMessage();
  const fetchModels = useFetchModels();
  const { data: allConnections } = useConnections();

  const [dirty, setDirty] = useState(false);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Local editable state
  const [localName, setLocalName] = useState("");
  const [localProvider, setLocalProvider] = useState<APIProvider>("openai");
  const [localBaseUrl, setLocalBaseUrl] = useState("");
  const [localApiKey, setLocalApiKey] = useState("");
  const [localModel, setLocalModel] = useState("");
  const [localMaxContext, setLocalMaxContext] = useState(128000);
  const [localEnableCaching, setLocalEnableCaching] = useState(false);
  const [localDefaultForAgents, setLocalDefaultForAgents] = useState(false);
  const [localEmbeddingModel, setLocalEmbeddingModel] = useState("");
  const [localEmbeddingBaseUrl, setLocalEmbeddingBaseUrl] = useState("");
  const [localEmbeddingConnectionId, setLocalEmbeddingConnectionId] = useState("");
  const [localOpenrouterProvider, setLocalOpenrouterProvider] = useState("");
  const [localComfyuiWorkflow, setLocalComfyuiWorkflow] = useState("");

  // Test results
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs: number } | null>(null);
  const [msgResult, setMsgResult] = useState<{
    success: boolean;
    response: string;
    latencyMs: number;
    error?: string;
  } | null>(null);

  // Model search
  const [modelSearch, setModelSearch] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number; maxH: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!showModelDropdown || !modelTriggerRef.current) {
      setDropdownRect(null);
      return;
    }

    const update = () => {
      if (!modelTriggerRef.current) return;
      const rect = modelTriggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      // Flip above trigger if there's more space above
      const openAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
      const maxH = Math.min(320, openAbove ? spaceAbove : spaceBelow);
      setDropdownRect({
        top: openAbove ? rect.top - maxH - 4 : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxH,
      });
    };

    update();

    // Recalculate on scroll/resize so the dropdown tracks the trigger
    const scrollParent =
      modelTriggerRef.current.closest(".overflow-y-auto, .overflow-auto, .overflow-y-scroll, .overflow-scroll") ??
      window;
    scrollParent.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      scrollParent.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [showModelDropdown]);

  // Remote models fetched from provider API
  const [remoteModels, setRemoteModels] = useState<Array<{ id: string; name: string }>>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Populate from server
  useEffect(() => {
    if (!conn) return;
    const c = conn as Record<string, unknown>;
    setLocalName((c.name as string) ?? "");
    setLocalProvider((c.provider as APIProvider) ?? "openai");
    setLocalBaseUrl((c.baseUrl as string) ?? "");
    setLocalApiKey(""); // never pre-fill (it's masked)
    setLocalModel((c.model as string) ?? "");
    setLocalMaxContext(Number(c.maxContext) || 128000);
    setLocalEnableCaching(c.enableCaching === "true" || c.enableCaching === true);
    setLocalDefaultForAgents(c.defaultForAgents === "true" || c.defaultForAgents === true);
    setLocalEmbeddingModel((c.embeddingModel as string) ?? "");
    setLocalEmbeddingBaseUrl((c.embeddingBaseUrl as string) ?? "");
    setLocalEmbeddingConnectionId((c.embeddingConnectionId as string) ?? "");
    setLocalOpenrouterProvider((c.openrouterProvider as string) ?? "");
    setLocalComfyuiWorkflow((c.comfyuiWorkflow as string) ?? "");
    setDirty(false);
    setSaveError(null);
    setTestResult(null);
    setMsgResult(null);
  }, [conn]);

  // Model list for current provider
  const providerModels = useMemo(() => {
    return MODEL_LISTS[localProvider] ?? [];
  }, [localProvider]);

  // Merge known models with remote models (remote first, deduped)
  const allModels = useMemo(() => {
    const knownIds = new Set(providerModels.map((m) => m.id));
    const uniqueRemote = remoteModels
      .filter((m) => !knownIds.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, context: 0, maxOutput: 0, isRemote: true as const }));
    const known = providerModels.map((m) => ({ ...m, isRemote: false as const }));
    return [...known, ...uniqueRemote];
  }, [providerModels, remoteModels]);

  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return allModels;
    const q = modelSearch.toLowerCase();
    return allModels.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [allModels, modelSearch]);

  const selectedModelInfo = useMemo(() => {
    return providerModels.find((m) => m.id === localModel) ?? null;
  }, [providerModels, localModel]);

  // Clear remote models when provider changes
  useEffect(() => {
    setRemoteModels([]);
    setFetchError(null);
  }, [localProvider]);

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closeConnectionDetail();
  }, [dirty, closeConnectionDetail]);

  const handleSave = useCallback(async () => {
    if (!connectionDetailId) return;
    setSaveError(null);
    const payload: Record<string, unknown> = {
      id: connectionDetailId,
      name: localName,
      provider: localProvider,
      baseUrl: localBaseUrl,
      model: localModel,
      maxContext: localMaxContext,
      enableCaching: localEnableCaching,
      defaultForAgents: localDefaultForAgents,
      embeddingModel: localEmbeddingModel,
      embeddingBaseUrl: localEmbeddingBaseUrl,
      embeddingConnectionId: localEmbeddingConnectionId || null,
      openrouterProvider: localOpenrouterProvider || null,
      comfyuiWorkflow: localComfyuiWorkflow || null,
    };
    // Only send API key if user typed a new one
    if (localApiKey.trim()) {
      payload.apiKey = localApiKey;
    }
    try {
      await updateConnection.mutateAsync(payload as { id: string } & Record<string, unknown>);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save connection");
    }
  }, [
    connectionDetailId,
    localName,
    localProvider,
    localBaseUrl,
    localApiKey,
    localModel,
    localMaxContext,
    localEnableCaching,
    localDefaultForAgents,
    localEmbeddingModel,
    localEmbeddingBaseUrl,
    localEmbeddingConnectionId,
    localOpenrouterProvider,
    localComfyuiWorkflow,
    updateConnection,
  ]);

  const handleDelete = useCallback(() => {
    if (!connectionDetailId) return;
    if (!confirm("Delete this connection?")) return;
    deleteConnection.mutate(connectionDetailId, { onSuccess: () => closeConnectionDetail() });
  }, [connectionDetailId, deleteConnection, closeConnectionDetail]);

  const handleTestConnection = useCallback(async () => {
    if (!connectionDetailId) return;
    // Save first if dirty, and wait for it to complete
    if (dirty) {
      try {
        await handleSave();
      } catch {
        return;
      }
    }
    setTestResult(null);
    testConnection.mutate(connectionDetailId, {
      onSuccess: (data) => setTestResult(data as { success: boolean; message: string; latencyMs: number }),
      onError: (err) =>
        setTestResult({ success: false, message: err instanceof Error ? err.message : "Failed", latencyMs: 0 }),
    });
  }, [connectionDetailId, dirty, handleSave, testConnection]);

  const handleTestMessage = useCallback(async () => {
    if (!connectionDetailId) return;
    if (dirty) {
      try {
        await handleSave();
      } catch {
        return;
      }
    }
    setMsgResult(null);
    testMessage.mutate(connectionDetailId, {
      onSuccess: (data) =>
        setMsgResult(data as { success: boolean; response: string; latencyMs: number; error?: string }),
      onError: (err) =>
        setMsgResult({
          success: false,
          response: "",
          latencyMs: 0,
          error: err instanceof Error ? err.message : "Failed",
        }),
    });
  }, [connectionDetailId, dirty, handleSave, testMessage]);

  const handleFetchModels = useCallback(async () => {
    if (!connectionDetailId) return;
    setFetchError(null);
    // Save first if dirty so the server has the right baseUrl/apiKey/provider
    if (dirty) {
      try {
        await handleSave();
      } catch {
        return;
      }
    }
    fetchModels.mutate(connectionDetailId, {
      onSuccess: (data) => {
        const result = data as { models: Array<{ id: string; name: string }> };
        setRemoteModels(result.models);
        setShowModelDropdown(true);
        requestAnimationFrame(() => {
          modelSearchInputRef.current?.focus();
          modelSearchInputRef.current?.select();
        });
      },
      onError: (err) => {
        setFetchError(err instanceof Error ? err.message : "Failed to fetch models");
      },
    });
  }, [connectionDetailId, dirty, handleSave, fetchModels]);

  const selectModel = useCallback((model: { id: string; context?: number }) => {
    setLocalModel(model.id);
    if (model.context) setLocalMaxContext(Number(model.context));
    setShowModelDropdown(false);
    setModelSearch("");
    setDirty(true);
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);

  const providerDef = PROVIDERS[localProvider];
  const isImageGenerationProvider = localProvider === "image_generation";

  if (!connectionDetailId) return null;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="shimmer h-8 w-48 rounded-xl" />
          <div className="shimmer h-4 w-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!conn) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[var(--muted-foreground)]">Connection not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <button
          onClick={handleClose}
          className="shrink-0 rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
        >
          <ArrowLeft size="1.125rem" />
        </button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 text-white shadow-sm">
          <Link size="1.125rem" />
        </div>
        <input
          value={localName}
          onChange={(e) => {
            setLocalName(e.target.value);
            markDirty();
          }}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)]"
          placeholder="Connection name…"
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {saveError && (
            <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-red-400">
              <AlertCircle size="0.6875rem" /> <span className="max-md:hidden">Save failed</span>
            </span>
          )}
          {savedFlash && !dirty && (
            <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-emerald-400">
              <Check size="0.6875rem" /> <span className="max-md:hidden">Saved</span>
            </span>
          )}
          {dirty && !saveError && (
            <span className="mr-2 text-[0.625rem] font-medium text-amber-400 max-md:hidden">Unsaved</span>
          )}
          <button
            onClick={handleSave}
            disabled={updateConnection.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-400 to-blue-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            <Save size="0.8125rem" /> <span className="max-md:hidden">Save</span>
          </button>
          <button
            onClick={handleDelete}
            className="rounded-xl p-2 transition-all hover:bg-[var(--destructive)]/15 active:scale-95"
          >
            <Trash2 size="0.9375rem" className="text-[var(--destructive)]" />
          </button>
        </div>
      </div>

      {/* Unsaved warning */}
      {showUnsavedWarning && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <span>You have unsaved changes.</span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUnsavedWarning(false)}
              className="rounded-lg px-3 py-1 hover:bg-[var(--accent)]"
            >
              Keep editing
            </button>
            <button
              onClick={() => closeConnectionDetail()}
              className="rounded-lg px-3 py-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/15"
            >
              Discard
            </button>
            <button
              onClick={async () => {
                await handleSave();
                closeConnectionDetail();
              }}
              className="rounded-lg bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
            >
              Save & close
            </button>
          </div>
        </div>
      )}

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          <AlertCircle size="0.8125rem" />
          <span className="flex-1">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="rounded-lg px-2 py-0.5 hover:bg-red-500/20">
            <X size="0.75rem" />
          </button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-6 max-md:p-4">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* ── Connection Name ── */}
          <FieldGroup
            label="Connection Name"
            icon={<Tag size="0.875rem" className="text-sky-400" />}
            help="A friendly name to identify this connection. Use something descriptive like 'Claude Sonnet — RP' or 'GPT-4o Main'."
          >
            <input
              value={localName}
              onChange={(e) => {
                setLocalName(e.target.value);
                markDirty();
              }}
              className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="e.g. Claude Sonnet — RP"
            />
          </FieldGroup>

          {/* ── Provider ── */}
          <FieldGroup
            label="Provider"
            icon={<Globe size="0.875rem" className="text-sky-400" />}
            help="The AI service you want to connect to. Each provider has its own models, pricing, and features. OpenAI and Anthropic are the most popular."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {(Object.entries(PROVIDERS) as [APIProvider, typeof providerDef][]).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => {
                    setLocalProvider(key);
                    // Auto-fill base URL
                    setLocalBaseUrl(info.defaultBaseUrl);
                    // Clear model if switching provider
                    setLocalModel("");
                    markDirty();
                  }}
                  className={cn(
                    "truncate rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
                    localProvider === key
                      ? "bg-sky-400/15 text-sky-400 ring-1 ring-sky-400/30"
                      : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                  )}
                >
                  {info.name}
                </button>
              ))}
            </div>
          </FieldGroup>

          {/* ── OpenRouter Provider Preference ── */}
          {localProvider === "openrouter" && (
            <FieldGroup
              label="Preferred Provider"
              icon={<Server size="0.875rem" className="text-sky-400" />}
              help="Choose which backend provider OpenRouter should route your requests to. Leave empty to let OpenRouter choose automatically based on price and availability."
            >
              <input
                value={localOpenrouterProvider}
                onChange={(e) => {
                  setLocalOpenrouterProvider(e.target.value);
                  markDirty();
                }}
                className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="e.g. Anthropic, Google, Amazon Bedrock…"
              />
              <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                Forces OpenRouter to route through a specific provider. The provider name must match exactly as shown on{" "}
                <a
                  href="https://openrouter.ai/models"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:underline"
                >
                  openrouter.ai/models
                </a>
                . Leave empty for automatic routing.
              </p>
            </FieldGroup>
          )}

          {/* ── API Key ── */}
          <FieldGroup
            label="API Key"
            icon={<Key size="0.875rem" className="text-sky-400" />}
            help="Your authentication key from the AI provider. You can get one from their website. It's like a password that lets Marinara talk to the AI service."
          >
            <input
              value={localApiKey}
              onChange={(e) => {
                setLocalApiKey(e.target.value);
                markDirty();
              }}
              type="password"
              className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder={conn ? "••••••••  (leave empty to keep existing key)" : "Enter API key…"}
            />
            <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
              Your key is encrypted at rest. Leave blank when editing to keep the existing key.
            </p>
            {API_KEY_LINKS[localProvider] && (
              <a
                href={API_KEY_LINKS[localProvider]!.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-sky-400 transition-colors hover:text-sky-300"
              >
                <ExternalLink size="0.625rem" />
                {API_KEY_LINKS[localProvider]!.label}
              </a>
            )}
            {localProvider === "custom" && (
              <p className="mt-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
                For local models (Ollama, LM Studio, KoboldCpp, etc.) you can leave this empty — just set the Base URL
                below.
              </p>
            )}
          </FieldGroup>

          {/* ── Base URL ── */}
          <FieldGroup
            label="Base URL"
            icon={<Globe size="0.875rem" className="text-sky-400" />}
            help="The API endpoint URL. Usually auto-filled for known providers. Only change this if you're using a proxy, local server, or custom endpoint."
          >
            <input
              value={localBaseUrl}
              onChange={(e) => {
                setLocalBaseUrl(e.target.value);
                markDirty();
              }}
              className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm font-mono ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder={providerDef?.defaultBaseUrl || "https://api.example.com/v1"}
            />
            {providerDef?.defaultBaseUrl && !localBaseUrl && (
              <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                Default: {providerDef.defaultBaseUrl}
              </p>
            )}
            {localProvider === "custom" && (
              <p className="mt-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
                Local model examples: Ollama →{" "}
                <code className="rounded bg-[var(--secondary)] px-1">http://localhost:11434/v1</code> · LM Studio →{" "}
                <code className="rounded bg-[var(--secondary)] px-1">http://localhost:1234/v1</code> · KoboldCpp →{" "}
                <code className="rounded bg-[var(--secondary)] px-1">http://localhost:5001/v1</code>
              </p>
            )}
            <p className="mt-1.5 flex items-start gap-1 text-[0.625rem] text-amber-400/80">
              <AlertCircle size="0.625rem" className="mt-px shrink-0" />
              <span>
                Only use URLs from providers you trust. A malicious endpoint could intercept your messages and API keys.
              </span>
            </p>
            {localProvider === "custom" && (
              <p className="mt-1.5 flex items-start gap-1 text-[0.625rem] text-sky-400/80">
                <AlertCircle size="0.625rem" className="mt-px shrink-0" />
                <span>
                  <strong>Windows users:</strong> If your proxy or local server isn't detected, Windows Defender
                  Firewall may be blocking the connection. Open{" "}
                  <em>Windows Security → Firewall & network protection → Allow an app through firewall</em> and add
                  Node.js or your proxy application.
                </span>
              </p>
            )}
          </FieldGroup>

          {/* ── Image Service (only for image_generation provider) ── */}
          {localProvider === "image_generation" && (
            <FieldGroup
              label="Image Service"
              icon={<Globe size="0.875rem" className="text-sky-400" />}
              help="Select which image generation service to use. This sets the Base URL automatically. You can also set a custom URL in the Base URL field above."
            >
              <div className="grid grid-cols-2 gap-1.5">
                {IMAGE_GENERATION_SOURCES.map((src) => {
                  const isActive = localBaseUrl === src.defaultBaseUrl;
                  return (
                    <button
                      key={src.id}
                      onClick={() => {
                        setLocalBaseUrl(src.defaultBaseUrl);
                        markDirty();
                      }}
                      className={cn(
                        "flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-[0.6875rem] transition-all",
                        isActive
                          ? "bg-sky-400/15 text-sky-400 ring-1 ring-sky-400/30"
                          : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{src.name}</span>
                        {isActive && <Check size="0.625rem" />}
                      </div>
                      <span className="text-[0.5625rem] opacity-70">{src.description}</span>
                    </button>
                  );
                })}
              </div>
            </FieldGroup>
          )}

          {/* ── Model Selection ── */}
          <FieldGroup
            label="Model"
            icon={<Server size="0.875rem" className="text-sky-400" />}
            help="The specific AI model to use. You can pick from the list or type a custom model ID directly."
          >
            {/* Standard model dropdown + manual input (used for all providers including image_generation) */}
            <div ref={modelTriggerRef} className="relative">
              <div
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className={cn(
                  "relative flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--secondary)] px-3 py-2.5 ring-1 ring-[var(--border)] transition-all hover:ring-[var(--ring)]",
                  showModelDropdown && "z-50 ring-sky-400/50",
                )}
              >
                <Search size="0.8125rem" className="shrink-0 text-[var(--muted-foreground)]" />
                {showModelDropdown ? (
                  <input
                    ref={modelSearchInputRef}
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
                    placeholder="Search models…"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={cn("flex-1 text-sm", !localModel && "text-[var(--muted-foreground)]")}>
                    {localModel
                      ? selectedModelInfo
                        ? `${selectedModelInfo.name} (${selectedModelInfo.id})`
                        : localModel
                      : "Select a model…"}
                  </span>
                )}
                <ChevronDown
                  size="0.875rem"
                  className={cn(
                    "shrink-0 text-[var(--muted-foreground)] transition-transform",
                    showModelDropdown && "rotate-180",
                  )}
                />
              </div>

              {showModelDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => {
                      setShowModelDropdown(false);
                      setModelSearch("");
                    }}
                    onWheel={(e) => {
                      // Let scroll pass through to parent
                      e.currentTarget.style.pointerEvents = "none";
                      requestAnimationFrame(() => {
                        (e.currentTarget as HTMLElement).style.pointerEvents = "";
                      });
                    }}
                    onTouchMove={(e) => {
                      // Let touch-scroll pass through to parent
                      e.currentTarget.style.pointerEvents = "none";
                      requestAnimationFrame(() => {
                        (e.currentTarget as HTMLElement).style.pointerEvents = "";
                      });
                    }}
                  />
                  <div
                    className="fixed z-50 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
                    style={
                      dropdownRect
                        ? {
                            top: dropdownRect.top,
                            left: dropdownRect.left,
                            width: dropdownRect.width,
                            maxHeight: dropdownRect.maxH,
                          }
                        : undefined
                    }
                  >
                    {/* Fetch from API button */}
                    <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] p-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFetchModels();
                        }}
                        disabled={fetchModels.isPending}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-400/10 px-3 py-2 text-xs font-medium text-sky-400 transition-all hover:bg-sky-400/20 active:scale-[0.98] disabled:opacity-50"
                      >
                        {fetchModels.isPending ? (
                          <Loader2 size="0.75rem" className="animate-spin" />
                        ) : (
                          <Globe size="0.75rem" />
                        )}
                        {fetchModels.isPending ? "Fetching…" : "Fetch Models from API"}
                      </button>
                      {fetchError && <p className="mt-1.5 text-[0.625rem] text-[var(--destructive)]">{fetchError}</p>}
                      {remoteModels.length > 0 && !fetchError && (
                        <p className="mt-1 text-[0.625rem] text-emerald-400">
                          {remoteModels.length} model{remoteModels.length !== 1 ? "s" : ""} available from API
                        </p>
                      )}
                    </div>

                    {localProvider === "custom" ? (
                      <div className="p-3">
                        <p className="mb-2 text-[0.625rem] text-[var(--muted-foreground)]">
                          Custom endpoints: type the model ID or fetch from API above.
                        </p>
                        <input
                          value={localModel}
                          onChange={(e) => {
                            setLocalModel(e.target.value);
                            markDirty();
                          }}
                          className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-sky-400/50"
                          placeholder="model-name-or-path"
                        />
                        {/* Show fetched models for custom provider */}
                        {remoteModels.length > 0 && (
                          <div className="mt-2 max-h-48 overflow-y-auto">
                            {remoteModels
                              .filter((m) => {
                                const q = (modelSearch || localModel).trim().toLowerCase();
                                if (!q) return true;
                                return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
                              })
                              .map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => selectModel({ id: m.id })}
                                  className={cn(
                                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                                    localModel === m.id && "bg-sky-400/5",
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{m.name}</span>
                                      {localModel === m.id && <Check size="0.75rem" className="text-sky-400" />}
                                    </div>
                                    <span className="text-[0.625rem] text-[var(--muted-foreground)]">{m.id}</span>
                                  </div>
                                  <span className="shrink-0 rounded-md bg-sky-400/10 px-1.5 py-0.5 text-[0.5625rem] font-medium text-sky-400">
                                    API
                                  </span>
                                </button>
                              ))}
                          </div>
                        )}
                        <button
                          onClick={() => {
                            setShowModelDropdown(false);
                            setModelSearch("");
                          }}
                          className="mt-2 w-full rounded-lg bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-400/20"
                        >
                          Done
                        </button>
                      </div>
                    ) : filteredModels.length === 0 ? (
                      <div className="p-4 text-center text-xs text-[var(--muted-foreground)]">
                        No models found. Try a different search or type the model ID below.
                        <input
                          value={localModel}
                          onChange={(e) => {
                            setLocalModel(e.target.value);
                            markDirty();
                          }}
                          className="mt-2 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-sky-400/50"
                          placeholder="Custom model ID…"
                        />
                      </div>
                    ) : (
                      filteredModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => selectModel(m)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--accent)]",
                            localModel === m.id && "bg-sky-400/5",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{m.name}</span>
                              {m.isRemote && (
                                <span className="rounded-md bg-sky-400/10 px-1.5 py-0.5 text-[0.5625rem] font-medium text-sky-400">
                                  API
                                </span>
                              )}
                              {localModel === m.id && <Check size="0.75rem" className="text-sky-400" />}
                            </div>
                            <span className="text-[0.625rem] text-[var(--muted-foreground)]">{m.id}</span>
                          </div>
                          <div className="shrink-0 text-right">
                            {m.context > 0 && (
                              <div className="text-[0.625rem] font-medium text-sky-400">{formatContext(m.context)}</div>
                            )}
                            {m.maxOutput > 0 && (
                              <div className="text-[0.5625rem] text-[var(--muted-foreground)]">
                                {formatContext(m.maxOutput)} out
                              </div>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Manual model ID input below dropdown */}
            {localProvider !== "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={localModel}
                  onChange={(e) => {
                    setLocalModel(e.target.value);
                    markDirty();
                  }}
                  className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-[var(--ring)]"
                  placeholder="Or type model ID directly…"
                />
              </div>
            )}

            {/* Context display */}
            {selectedModelInfo && (
              <div className="mt-2 flex items-center gap-4 rounded-lg bg-sky-400/5 px-3 py-2 text-[0.6875rem]">
                <span className="text-[var(--muted-foreground)]">
                  Context: <strong className="text-sky-400">{formatContext(selectedModelInfo.context)}</strong>
                </span>
                <span className="text-[var(--muted-foreground)]">
                  Max Output: <strong className="text-sky-400">{formatContext(selectedModelInfo.maxOutput)}</strong>
                </span>
              </div>
            )}
          </FieldGroup>

          {/* ── ComfyUI Workflow ── */}
          {localProvider === "image_generation" &&
            (localBaseUrl.includes(":8188") || localBaseUrl.toLowerCase().includes("comfyui")) && (
              <FieldGroup
                label="ComfyUI Workflow (Optional)"
                icon={<Zap size="0.875rem" className="text-sky-400" />}
                help="Paste a custom ComfyUI workflow JSON (API format). Use placeholders: %prompt%, %negative_prompt%, %width%, %height%, %seed%, %model%. Leave empty to use the built-in default txt2img workflow."
              >
                <textarea
                  value={localComfyuiWorkflow}
                  onChange={(e) => {
                    setLocalComfyuiWorkflow(e.target.value);
                    markDirty();
                  }}
                  placeholder='Paste workflow JSON here (exported from ComfyUI via "Save (API Format)")…'
                  className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-mono outline-none ring-1 ring-[var(--border)] transition-shadow placeholder:text-[var(--muted-foreground)]/50 focus:ring-sky-400/50 min-h-[120px] max-h-[300px] resize-y"
                />
                <p className="text-[0.55rem] text-[var(--muted-foreground)] mt-1">
                  Export your workflow from ComfyUI using <strong>Save (API Format)</strong> in the menu. Placeholders
                  like <code>%prompt%</code> will be replaced at generation time.
                </p>
              </FieldGroup>
            )}

          {/* ── Max Context ── */}
          {localProvider !== "image_generation" && (
            <FieldGroup
              label="Max Context Window"
              icon={<Zap size="0.875rem" className="text-sky-400" />}
              help="The maximum number of tokens this model can process at once (your messages + its reply). This is auto-set when you pick a model from the list."
            >
              <div className="flex items-center gap-3">
                <DraftNumberInput
                  value={localMaxContext}
                  min={0}
                  selectOnFocus
                  onCommit={(nextValue) => {
                    setLocalMaxContext(nextValue);
                    markDirty();
                  }}
                  className="w-40 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
                <span className="text-xs text-[var(--muted-foreground)]">{formatContext(localMaxContext)} tokens</span>
              </div>
              <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                This is auto-set when selecting a model from the list. Override manually if needed.
              </p>
            </FieldGroup>
          )}

          {/* ── Prompt Caching (Anthropic only) ── */}
          {localProvider === "anthropic" && (
            <FieldGroup
              label="Prompt Caching"
              icon={<Zap size="0.875rem" className="text-amber-400" />}
              help="Enables Anthropic prompt caching, which caches your system prompt and conversation history between requests. Reduces latency and costs for multi-turn conversations. Cache lasts 5 minutes and is refreshed on each use."
            >
              <label className="flex items-center gap-3 cursor-pointer rounded-xl p-2 transition-colors hover:bg-[var(--secondary)]/50">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={localEnableCaching}
                    onChange={(e) => {
                      setLocalEnableCaching(e.target.checked);
                      markDirty();
                    }}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-9 rounded-full bg-[var(--border)] transition-colors peer-checked:bg-amber-400/70" />
                  <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
                </div>
                <span className="text-sm">Enable prompt caching</span>
              </label>
              <p className="text-[0.625rem] text-[var(--muted-foreground)] px-2">
                Caches the system prompt explicitly and uses automatic caching for conversation history. Read tokens
                cost 90% less than regular input tokens. Cache writes cost 25% more on first use.
              </p>
            </FieldGroup>
          )}

          {/* ── Default for Agents ── */}
          <FieldGroup
            label={isImageGenerationProvider ? "Default for Illustrator" : "Default for Agents"}
            icon={<Bot size="0.875rem" className="text-teal-400" />}
            help={
              isImageGenerationProvider
                ? "When enabled, the Illustrator agent will use this image generation connection by default whenever it does not have a specific Image Generation Connection assigned."
                : "When enabled, all agents that don't have a specific connection override will use this connection instead of the chat's active connection."
            }
          >
            <label className="flex items-center gap-3 cursor-pointer select-none px-2 py-1">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={localDefaultForAgents}
                  onChange={(e) => {
                    setLocalDefaultForAgents(e.target.checked);
                    markDirty();
                  }}
                  className="peer sr-only"
                />
                <div className="h-5 w-9 rounded-full bg-[var(--border)] transition-colors peer-checked:bg-teal-400/70" />
                <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </div>
              <span className="text-sm">
                {isImageGenerationProvider
                  ? "Use as default Illustrator image connection"
                  : "Use as default agent connection"}
              </span>
            </label>
            {isImageGenerationProvider && (
              <p className="px-2 text-[0.625rem] text-[var(--muted-foreground)]">
                Only one image generation connection should be marked as the default for Illustrator.
              </p>
            )}
          </FieldGroup>

          {/* ── Embedding Model (for lorebook vectorization) ── */}
          {localProvider !== "image_generation" && (
            <FieldGroup
              label="Embedding Model"
              icon={<Server size="0.875rem" className="text-violet-400" />}
              help="Optional. The model used for generating embeddings when vectorizing lorebook entries. Leave empty to skip semantic matching. Examples: text-embedding-3-small, text-embedding-ada-002."
            >
              <input
                value={localEmbeddingModel}
                onChange={(e) => {
                  setLocalEmbeddingModel(e.target.value);
                  markDirty();
                }}
                className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm font-mono ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="e.g. text-embedding-3-small"
              />
              <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                Used for lorebook semantic search. Entries matching by meaning (not just keywords) will be included in
                the prompt.
              </p>

              {/* Embedding Base URL Override */}
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
                  Embedding Endpoint URL
                </label>
                <input
                  value={localEmbeddingBaseUrl}
                  onChange={(e) => {
                    setLocalEmbeddingBaseUrl(e.target.value);
                    markDirty();
                  }}
                  className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm font-mono ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  placeholder="e.g. http://localhost:5002/v1"
                />
                <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                  Optional. A separate base URL for your embedding backend. Useful when running two instances of
                  llama.cpp on different ports — one for chat, one for embeddings. Leave empty to use the
                  connection&apos;s main URL.
                </p>
              </div>

              {/* Embedding Connection Override */}
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
                  Embedding Connection
                </label>
                <select
                  value={localEmbeddingConnectionId}
                  onChange={(e) => {
                    setLocalEmbeddingConnectionId(e.target.value);
                    markDirty();
                  }}
                  className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  <option value="">Same as this connection</option>
                  {((allConnections ?? []) as Record<string, unknown>[])
                    .filter((c) => c.id !== connectionDetailId && c.provider !== "image_generation")
                    .map((c) => (
                      <option key={c.id as string} value={c.id as string}>
                        {c.name as string}
                        {c.embeddingModel ? ` (${c.embeddingModel})` : ""}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                  Use a different connection&apos;s API key and base URL for embeddings. The embedding model name above
                  will still be used unless the chosen connection has its own embedding model configured.
                </p>
              </div>
            </FieldGroup>
          )}

          {/* ── Test Section ── */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-4">
            <h3 className="text-sm font-semibold">Connection Tests</h3>
            <div className="flex gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testConnection.isPending}
                className="flex items-center gap-1.5 rounded-xl bg-sky-400/10 px-4 py-2.5 text-xs font-medium text-sky-400 ring-1 ring-sky-400/20 transition-all hover:bg-sky-400/20 active:scale-[0.98] disabled:opacity-50"
              >
                {testConnection.isPending ? (
                  <Loader2 size="0.8125rem" className="animate-spin" />
                ) : (
                  <Wifi size="0.8125rem" />
                )}
                Test Connection
              </button>
              {localProvider !== "image_generation" && (
                <button
                  onClick={handleTestMessage}
                  disabled={testMessage.isPending || !localModel}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-400/10 px-4 py-2.5 text-xs font-medium text-emerald-400 ring-1 ring-emerald-400/20 transition-all hover:bg-emerald-400/20 active:scale-[0.98] disabled:opacity-50"
                >
                  {testMessage.isPending ? (
                    <Loader2 size="0.8125rem" className="animate-spin" />
                  ) : (
                    <MessageSquare size="0.8125rem" />
                  )}
                  Send Test Message
                </button>
              )}
            </div>

            <p className="text-[0.625rem] text-[var(--muted-foreground)]">
              <strong>Test Connection</strong> verifies your API key works.
              {localProvider !== "image_generation" && (
                <>
                  {" "}
                  <strong>Send Test Message</strong> sends "hi" to the model and shows the response.
                </>
              )}
            </p>

            {/* Connection test result */}
            {testResult && (
              <TestResultCard label="Connection Test" success={testResult.success} latencyMs={testResult.latencyMs}>
                {testResult.message}
              </TestResultCard>
            )}

            {/* Message test result */}
            {msgResult && (
              <TestResultCard label="Test Message" success={msgResult.success} latencyMs={msgResult.latencyMs}>
                {msgResult.success ? (
                  <div className="mt-1.5 rounded-lg bg-[var(--secondary)] p-2.5 text-xs leading-relaxed">
                    {msgResult.response}
                  </div>
                ) : (
                  <span className="text-[var(--destructive)]">{msgResult.error || "No response received"}</span>
                )}
              </TestResultCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════

function FieldGroup({
  label,
  icon,
  help,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <h3 className="text-xs font-semibold text-[var(--foreground)]">{label}</h3>
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}

function TestResultCard({
  label,
  success,
  latencyMs,
  children,
}: {
  label: string;
  success: boolean;
  latencyMs: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        success ? "border-emerald-400/20 bg-emerald-400/5" : "border-[var(--destructive)]/20 bg-[var(--destructive)]/5",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        {success ? (
          <Check size="0.8125rem" className="text-emerald-400" />
        ) : (
          <AlertCircle size="0.8125rem" className="text-[var(--destructive)]" />
        )}
        <span className={success ? "text-emerald-400" : "text-[var(--destructive)]"}>
          {label}: {success ? "Success" : "Failed"}
        </span>
        <span className="ml-auto text-[0.625rem] text-[var(--muted-foreground)]">{latencyMs}ms</span>
      </div>
      <div className="mt-1 text-[0.6875rem] text-[var(--foreground)]">{children}</div>
    </div>
  );
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}
