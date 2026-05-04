// ──────────────────────────────────────────────
// Routes: Text-to-Speech
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ttsConfigSchema,
  TTS_SETTINGS_KEY,
  TTS_API_KEY_MASK,
  type TTSSource,
  type TTSConfig,
  type TTSVoicesResponse,
} from "@marinara-engine/shared";
import { createAppSettingsStorage } from "../services/storage/app-settings.storage.js";
import { encryptApiKey, decryptApiKey } from "../utils/crypto.js";
import { isTtsLocalUrlsEnabled } from "../config/runtime-config.js";
import { safeFetch } from "../utils/security.js";

// OpenAI built-in voices used as fallback when the provider has no /audio/voices endpoint
const OPENAI_FALLBACK_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];

const TTS_SOURCE_DEFAULTS: Record<TTSSource, { baseUrl: string; model: string }> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "tts-1",
  },
  elevenlabs: {
    baseUrl: "https://api.elevenlabs.io",
    model: "eleven_multilingual_v2",
  },
};

const ELEVENLABS_NON_TTS_MODELS = new Set(["eleven_ttv_v3", "eleven_multilingual_ttv_v2"]);
const ELEVENLABS_TTS_MODEL_ALIASES: Record<string, string> = {
  tts_v3: "eleven_v3",
  elevenlabs_v3: "eleven_v3",
  elevenlabs_tts_v3: "eleven_v3",
};
const MAX_TTS_AUDIO_BYTES = 20 * 1024 * 1024;

const speakSchema = z.object({
  text: z.string().min(1).max(4096),
  speaker: z.string().max(120).optional(),
  tone: z.string().max(80).optional(),
  voice: z.string().max(200).optional(),
});

type VoiceOption = NonNullable<TTSVoicesResponse["voiceOptions"]>[number];

// ── Helpers ─────────────────────────────────────

function parseStoredConfig(raw: string | null) {
  if (!raw) return ttsConfigSchema.parse({});
  try {
    return ttsConfigSchema.parse(JSON.parse(raw));
  } catch {
    return ttsConfigSchema.parse({});
  }
}

/**
 * Resolve the stored config and decrypt the API key.
 * Returns config with the plain-text key (never sent to client).
 */
async function loadConfig(storage: ReturnType<typeof createAppSettingsStorage>) {
  const raw = await storage.get(TTS_SETTINGS_KEY);
  const cfg = parseStoredConfig(raw);
  cfg.apiKey = decryptApiKey(cfg.apiKey);
  return cfg;
}

function responseFromVoiceOptions(
  source: TTSSource,
  voiceOptions: VoiceOption[],
  fromProvider: boolean,
): TTSVoicesResponse {
  return {
    voices: voiceOptions.map((v) => v.id),
    voiceOptions,
    fromProvider,
    source,
  };
}

function fallbackVoices(source: TTSSource): TTSVoicesResponse {
  if (source === "elevenlabs") {
    return responseFromVoiceOptions(source, [], false);
  }

  return responseFromVoiceOptions(
    source,
    OPENAI_FALLBACK_VOICES.map((voice) => ({ id: voice, name: voice })),
    false,
  );
}

function configuredBaseUrl(cfg: TTSConfig) {
  const fallbackBase = TTS_SOURCE_DEFAULTS[cfg.source].baseUrl;
  return (cfg.baseUrl || fallbackBase).replace(/\/+$/, "");
}

function elevenLabsApiRoot(baseUrl: string) {
  return baseUrl.replace(/\/v\d+$/, "");
}

function normalizeElevenLabsTtsModelId(model: string) {
  const trimmed = model.trim();
  return ELEVENLABS_TTS_MODEL_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readLabels(value: unknown): Record<string, string | number | boolean | null> | null {
  const obj = asObject(value);
  if (!obj) return null;

  const labels = Object.fromEntries(
    Object.entries(obj).filter((entry): entry is [string, string | number | boolean | null] => {
      const [, labelValue] = entry;
      return (
        labelValue === null ||
        typeof labelValue === "string" ||
        typeof labelValue === "number" ||
        typeof labelValue === "boolean"
      );
    }),
  );

  return Object.keys(labels).length > 0 ? labels : null;
}

function parseVoiceOption(value: unknown): VoiceOption | null {
  if (typeof value === "string") {
    return value.trim() ? { id: value, name: value } : null;
  }

  const obj = asObject(value);
  if (!obj) return null;

  const id =
    readString(obj["voice_id"]) ?? readString(obj["voiceId"]) ?? readString(obj["id"]) ?? readString(obj["name"]);
  if (!id) return null;

  const name = readString(obj["name"]) ?? id;
  return {
    id,
    name,
    description: readString(obj["description"]) ?? null,
    previewUrl: readString(obj["preview_url"]) ?? readString(obj["previewUrl"]) ?? null,
    category: readString(obj["category"]) ?? null,
    labels: readLabels(obj["labels"]),
  };
}

function parseVoiceOptions(data: unknown): VoiceOption[] {
  const list = Array.isArray(data)
    ? data
    : (() => {
        const obj = asObject(data);
        const voices = obj?.["voices"] ?? obj?.["data"];
        return Array.isArray(voices) ? voices : [];
      })();

  return list.map(parseVoiceOption).filter((voice): voice is VoiceOption => Boolean(voice));
}

function mergeVoiceOptions(voiceOptions: VoiceOption[]): VoiceOption[] {
  const byId = new Map<string, VoiceOption>();
  for (const option of voiceOptions) {
    const existing = byId.get(option.id);
    if (!existing) {
      byId.set(option.id, option);
      continue;
    }

    byId.set(option.id, {
      ...existing,
      ...option,
      description: option.description ?? existing.description ?? null,
      previewUrl: option.previewUrl ?? existing.previewUrl ?? null,
      category: option.category ?? existing.category ?? null,
      labels: { ...(existing.labels ?? {}), ...(option.labels ?? {}) },
    });
  }
  return [...byId.values()];
}

function elevenLabsHeaders(apiKey: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["xi-api-key"] = apiKey;
  return headers;
}

function openAiHeaders(apiKey: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return headers;
}

function openAiModelSupportsSpeechInstructions(model: string) {
  return /^gpt-4o/i.test(model.trim());
}

function readProviderErrorDetail(body: string): string {
  if (!body.trim()) return "";

  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const directDetail = readString(data.detail);
    const detail = asObject(data.detail);
    const detailMessage = readString(detail?.message) ?? readString(detail?.status);
    return readString(data.message) ?? readString(data.error) ?? directDetail ?? detailMessage ?? body.slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

function buildSpeechInstructions(input: { speaker?: string; tone?: string }) {
  const parts: string[] = [];
  if (input.speaker?.trim()) {
    parts.push(`Voice the line as ${input.speaker.trim()}.`);
  }
  if (input.tone?.trim()) {
    parts.push(`Use a ${input.tone.trim()} tone.`);
  }
  if (parts.length === 0) return undefined;
  parts.push("Do not read speaker names, brackets, markup, or stage directions aloud.");
  return parts.join(" ");
}

function toElevenLabsCueTag(value: string): string | null {
  const tag = value
    .trim()
    .replace(/^[\[\]"']+|[\]\]"']+$/g, "")
    .replace(/\s+/g, " ");
  if (!tag || /[\r\n<>]/.test(tag)) return null;

  const normalized = tag.toLowerCase();
  if (/^(main|side|extra|action|thought|whisper(?::.+)?)$/.test(normalized)) return null;

  return `[${tag}]`;
}

export function buildElevenLabsTextInput(text: string, tone?: string): string {
  const tags = (tone ?? "")
    .split(",")
    .map(toElevenLabsCueTag)
    .filter((tag): tag is string => Boolean(tag));
  if (tags.length === 0) return text;

  const prefix = tags.join(" ");
  const trimmedText = text.trimStart();
  if (trimmedText.toLowerCase().startsWith(prefix.toLowerCase())) return text;
  return `${prefix} ${text}`;
}

export function resolveTTSRequestVoice(configuredVoice: string, requestedVoice?: string | null): string {
  const trimmedRequest = requestedVoice?.trim();
  return trimmedRequest || configuredVoice;
}

async function fetchElevenLabsVoiceOptions(
  baseUrl: string,
  apiKey: string,
  query: Record<string, string> = {},
): Promise<VoiceOption[]> {
  const voiceOptions: VoiceOption[] = [];
  let nextPageToken: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${elevenLabsApiRoot(baseUrl)}/v2/voices`);
    url.searchParams.set("page_size", "100");
    url.searchParams.set("include_total_count", "false");
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    if (nextPageToken) {
      url.searchParams.set("next_page_token", nextPageToken);
    }

    const res = await safeFetch(url, {
      headers: elevenLabsHeaders(apiKey),
      signal: AbortSignal.timeout(10_000),
      policy: { allowLocal: isTtsLocalUrlsEnabled(), allowedProtocols: ["https:", "http:"] },
      maxResponseBytes: 2 * 1024 * 1024,
    });

    if (!res.ok) throw new Error(`ElevenLabs voices request failed (${res.status})`);

    const data = await res.json();
    voiceOptions.push(...parseVoiceOptions(data));

    const obj = asObject(data);
    const hasMore = obj?.has_more === true;
    nextPageToken = readString(obj?.next_page_token) ?? null;
    if (!hasMore || !nextPageToken) break;
  }

  return voiceOptions;
}

async function fetchProviderVoices(cfg: TTSConfig): Promise<TTSVoicesResponse> {
  if (!cfg.enabled) return fallbackVoices(cfg.source);

  const base = configuredBaseUrl(cfg);

  if (cfg.source === "elevenlabs") {
    if (!cfg.apiKey) return fallbackVoices(cfg.source);

    const [defaultVoices, accountVoices] = await Promise.all([
      fetchElevenLabsVoiceOptions(base, cfg.apiKey, { voice_type: "default" }).catch(() => []),
      fetchElevenLabsVoiceOptions(base, cfg.apiKey).catch(() => []),
    ]);
    const voices = mergeVoiceOptions([...defaultVoices, ...accountVoices]);
    return voices.length > 0 ? responseFromVoiceOptions(cfg.source, voices, true) : fallbackVoices(cfg.source);
  }

  const res = await safeFetch(`${base}/audio/voices`, {
    headers: openAiHeaders(cfg.apiKey),
    signal: AbortSignal.timeout(10_000),
    policy: { allowLocal: isTtsLocalUrlsEnabled(), allowedProtocols: ["https:", "http:"] },
    maxResponseBytes: 2 * 1024 * 1024,
  });

  if (!res.ok) return fallbackVoices(cfg.source);

  const voices = parseVoiceOptions(await res.json());
  return voices.length > 0 ? responseFromVoiceOptions(cfg.source, voices, true) : fallbackVoices(cfg.source);
}

// ── Routes ──────────────────────────────────────

export async function ttsRoutes(app: FastifyInstance) {
  const storage = createAppSettingsStorage(app.db);

  /**
   * GET /api/tts/config
   * Returns TTS config with the API key masked.
   */
  app.get("/config", async () => {
    const raw = await storage.get(TTS_SETTINGS_KEY);
    const cfg = parseStoredConfig(raw);
    // Mask the stored (encrypted) key — just tell client whether one is saved
    const hasKey = Boolean(cfg.apiKey);
    return { ...cfg, apiKey: hasKey ? TTS_API_KEY_MASK : "" };
  });

  /**
   * PUT /api/tts/config
   * Saves TTS config. Encrypts the API key before storage.
   * If apiKey equals the mask, the existing key is kept unchanged.
   */
  app.put("/config", async (req, reply) => {
    const input = ttsConfigSchema.parse(req.body);

    if (input.apiKey === TTS_API_KEY_MASK) {
      // Client sent the mask back — preserve the existing encrypted key
      const existing = parseStoredConfig(await storage.get(TTS_SETTINGS_KEY));
      input.apiKey = existing.apiKey; // already encrypted blob
    } else {
      input.apiKey = encryptApiKey(input.apiKey);
    }

    await storage.set(TTS_SETTINGS_KEY, JSON.stringify(input));
    return reply.status(204).send();
  });

  /**
   * GET /api/tts/voices
   * Fetches available voices from the configured provider.
   */
  app.get("/voices", async () => {
    const cfg = await loadConfig(storage);

    try {
      return await fetchProviderVoices(cfg);
    } catch {
      return fallbackVoices(cfg.source);
    }
  });

  /**
   * POST /api/tts/speak
   * Proxies a TTS request to the configured provider and streams the audio back.
   */
  app.post("/speak", async (req, reply) => {
    const { text, speaker, tone, voice } = speakSchema.parse(req.body);

    const cfg = await loadConfig(storage);

    if (!cfg.enabled) {
      return reply.status(400).send({ error: "TTS is not enabled" });
    }

    if (cfg.source === "elevenlabs" && !cfg.apiKey) {
      return reply.status(400).send({ error: "ElevenLabs API key is not configured" });
    }

    const requestVoice = resolveTTSRequestVoice(cfg.voice, voice);

    if (cfg.source === "elevenlabs" && !requestVoice) {
      return reply.status(400).send({ error: "ElevenLabs voice is not selected" });
    }

    const base = configuredBaseUrl(cfg);
    const configuredModel = (cfg.model || TTS_SOURCE_DEFAULTS[cfg.source].model).trim();
    const model = cfg.source === "elevenlabs" ? normalizeElevenLabsTtsModelId(configuredModel) : configuredModel;
    const normalizedModel = model.toLowerCase();
    if (cfg.source === "elevenlabs" && ELEVENLABS_NON_TTS_MODELS.has(normalizedModel)) {
      return reply.status(400).send({
        error: `ElevenLabs model "${model}" cannot generate text-to-speech`,
        detail: `That model is for Text to Voice / voice design. Use "eleven_v3" for Eleven v3 speech, or "eleven_multilingual_v2", "eleven_flash_v2_5", or "eleven_turbo_v2_5" for regular TTS.`,
      });
    }

    const url =
      cfg.source === "elevenlabs"
        ? `${elevenLabsApiRoot(base)}/v1/text-to-speech/${encodeURIComponent(requestVoice)}?output_format=mp3_44100_128`
        : `${base}/audio/speech`;
    const providerText = cfg.source === "elevenlabs" ? buildElevenLabsTextInput(text, tone) : text;
    const elevenLabsLanguageCode = cfg.elevenLabsLanguageCode?.trim();
    const speechInstructions =
      cfg.source === "openai" && openAiModelSupportsSpeechInstructions(cfg.model)
        ? buildSpeechInstructions({ speaker, tone })
        : undefined;

    let providerRes: Response;
    try {
      providerRes = await safeFetch(url, {
        method: "POST",
        headers: cfg.source === "elevenlabs" ? elevenLabsHeaders(cfg.apiKey) : openAiHeaders(cfg.apiKey),
        body:
          cfg.source === "elevenlabs"
            ? JSON.stringify({
                text: providerText,
                model_id: model,
                ...(elevenLabsLanguageCode ? { language_code: elevenLabsLanguageCode } : {}),
                voice_settings: {
                  stability: cfg.elevenLabsStability,
                  speed: cfg.speed,
                },
              })
            : JSON.stringify({
                model,
                input: providerText,
                voice: requestVoice,
                speed: cfg.speed,
                response_format: "mp3",
                ...(speechInstructions ? { instructions: speechInstructions } : {}),
              }),
        signal: AbortSignal.timeout(60_000),
        policy: { allowLocal: isTtsLocalUrlsEnabled(), allowedProtocols: ["https:", "http:"] },
        maxResponseBytes: MAX_TTS_AUDIO_BYTES,
        allowedContentTypes: ["audio/", "application/octet-stream"],
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.name === "TimeoutError" ? "TTS request timed out" : "TTS provider unreachable";
      return reply.status(502).send({ error: msg });
    }

    if (!providerRes.ok) {
      const body = await providerRes.text().catch(() => "");
      return reply
        .status(502)
        .send({ error: `TTS provider returned ${providerRes.status}`, detail: readProviderErrorDetail(body) });
    }

    const audioBuffer = await providerRes.arrayBuffer();
    reply.header("Content-Type", "audio/mpeg");
    reply.header("Content-Length", String(audioBuffer.byteLength));
    return reply.send(Buffer.from(audioBuffer));
  });
}
