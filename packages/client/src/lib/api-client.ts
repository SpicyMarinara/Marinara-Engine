// ──────────────────────────────────────────────
// Generic API client for communicating with the backend
// ──────────────────────────────────────────────

const BASE = "/api";
export const ADMIN_SECRET_STORAGE_KEY = "marinara_admin_secret";

export function getAdminSecretHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const secret = window.localStorage.getItem(ADMIN_SECRET_STORAGE_KEY)?.trim();
  return secret ? { "X-Admin-Secret": secret } : {};
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type JsonRepairKind = "game_setup" | "session_conclusion" | "campaign_progression";

export type JsonRepairRequest = {
  kind: JsonRepairKind;
  title: string;
  rawJson: string;
  applyEndpoint: string;
  applyBody?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function getJsonRepairRequest(error: unknown): JsonRepairRequest | null {
  if (!(error instanceof ApiError) || !isRecord(error.payload)) return null;
  const repair = error.payload.jsonRepair;
  if (!isRecord(repair)) return null;

  const kind = repair.kind;
  const title = repair.title;
  const rawJson = repair.rawJson;
  const applyEndpoint = repair.applyEndpoint;
  if (
    (kind !== "game_setup" && kind !== "session_conclusion" && kind !== "campaign_progression") ||
    typeof title !== "string" ||
    typeof rawJson !== "string" ||
    typeof applyEndpoint !== "string"
  ) {
    return null;
  }

  return {
    kind,
    title,
    rawJson,
    applyEndpoint,
    applyBody: isRecord(repair.applyBody) ? repair.applyBody : undefined,
  };
}

export function isJsonRepairApiError(error: unknown): boolean {
  return getJsonRepairRequest(error) !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...getAdminSecretHeader(), ...(init?.headers as Record<string, string>) };
  // Only set Content-Type for requests that have a body
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText, body);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  /** Download a JSON endpoint as a file (triggers browser save-as). */
  download: async (path: string, fallbackFilename = "export.json") => {
    const res = await fetch(`${BASE}${path}`, { headers: getAdminSecretHeader(), cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, "Download failed");
    const disposition = res.headers.get("Content-Disposition");
    let filename = fallbackFilename;
    if (disposition) {
      const match = disposition.match(/filename="?([^";\n]+)"?/);
      if (match?.[1]) filename = decodeURIComponent(match[1]);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Download a POST endpoint as a file (useful for bulk exports). */
  downloadPost: async (path: string, body: unknown, fallbackFilename = "export.bin") => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { ...getAdminSecretHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, payload.error ?? "Download failed", payload);
    }
    const disposition = res.headers.get("Content-Disposition");
    let filename = fallbackFilename;
    if (disposition) {
      const match = disposition.match(/filename="?([^";\n]+)"?/);
      if (match?.[1]) filename = decodeURIComponent(match[1]);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Stream an SSE endpoint. Returns an async iterable of parsed events.
   */
  stream: async function* (path: string, body?: unknown): AsyncGenerator<string> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { ...getAdminSecretHeader(), "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        const json = JSON.parse(text);
        detail = json.error || json.message || text.slice(0, 200);
      } catch {
        /* couldn't parse body */
      }
      throw new ApiError(res.status, detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "token" && parsed.data) yield parsed.data;
            else if (parsed.type === "error") throw new ApiError(500, parsed.data ?? "Generation error", parsed);
            else if (parsed.type === "done") return;
          } catch (e) {
            // If not JSON, yield as raw text
            if (!(e instanceof ApiError)) yield data;
          }
        }
      }
    }
  },

  /**
   * Stream an SSE endpoint. Returns an async iterable of all typed events.
   * Unlike `stream()`, this does NOT filter to only token events.
   */
  streamEvents: async function* (
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): AsyncGenerator<{ type: string; data: unknown }> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { ...getAdminSecretHeader(), "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });

    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        const json = JSON.parse(text);
        detail = json.error || json.message || text.slice(0, 200);
      } catch {
        /* couldn't parse body */
      }
      throw new ApiError(res.status, detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            yield parsed;
            if (parsed.type === "error") return; // error is a terminal event — stop iteration
          } catch {
            // JSON parse failed — yield raw data as a token
            yield { type: "token", data };
          }
        }
      }
    }
  },

  /** Upload a file via multipart/form-data */
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: getAdminSecretHeader(),
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, body.error ?? res.statusText, body);
    }

    return res.json() as Promise<T>;
  },
};
