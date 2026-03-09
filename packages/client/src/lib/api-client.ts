// ──────────────────────────────────────────────
// Generic API client for communicating with the backend
// ──────────────────────────────────────────────

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  // Only set Content-Type for requests that have a body
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...init,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

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
    const res = await fetch(`${BASE}${path}`);
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

  /**
   * Stream an SSE endpoint. Returns an async iterable of parsed events.
   */
  stream: async function* (path: string, body?: unknown): AsyncGenerator<string> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok || !res.body) {
      throw new ApiError(res.status, "Stream failed");
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
            else if (parsed.type === "error") throw new ApiError(500, parsed.data ?? "Generation error");
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
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!res.ok || !res.body) {
      throw new ApiError(res.status, "Stream failed");
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
            if (parsed.type === "error") {
              throw new ApiError(500, parsed.data ?? "Generation error");
            }
            yield parsed;
          } catch (e) {
            if (e instanceof ApiError) throw e;
            // Non-JSON — yield as raw token
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
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, body.error ?? res.statusText);
    }

    return res.json() as Promise<T>;
  },
};
