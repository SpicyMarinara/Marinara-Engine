import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@marinara-engine/shared";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isSameOriginApi(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function mergeHeaders(init?: RequestInit): Headers {
  return new Headers(init?.headers ?? (init?.body !== undefined ? { "Content-Type": "application/json" } : undefined));
}

export function installCsrfFetchShim() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const method =
      init?.method?.toUpperCase() ??
      (typeof Request !== "undefined" && input instanceof Request ? input.method.toUpperCase() : "GET");

    if (!UNSAFE_METHODS.has(method) || !isSameOriginApi(input)) {
      return nativeFetch(input, init);
    }

    const headers = mergeHeaders(init);
    headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
    return nativeFetch(input, { ...init, headers });
  };
}
