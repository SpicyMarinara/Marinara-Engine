import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@marinara-engine/shared";
import { toast } from "sonner";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// One toast per offending origin per cooldown window. Without this a page
// that fires several mutations in parallel (e.g. opening a panel that loads
// settings and saves a default) would stack identical toasts.
const TOAST_COOLDOWN_MS = 10_000;
const lastToastByOrigin = new Map<string, number>();

type CsrfErrorBody = {
  code?: unknown;
  error?: unknown;
  origin?: unknown;
  hint?: unknown;
};

function isSameOriginApi(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function looksLikeCsrfFailure(body: CsrfErrorBody): boolean {
  if (typeof body.code === "string" && body.code.startsWith("CSRF_")) return true;
  // Pre-code-field servers: detect by error-message shape so older backends
  // paired with a new frontend still surface a toast instead of silent failure.
  if (typeof body.error === "string" && /CSRF|trusted list \(CSRF_TRUSTED_ORIGINS\)/i.test(body.error)) return true;
  return false;
}

function notifyCsrf(body: CsrfErrorBody): void {
  const origin = typeof body.origin === "string" ? body.origin : window.location.origin;
  const now = Date.now();
  const last = lastToastByOrigin.get(origin) ?? 0;
  if (now - last < TOAST_COOLDOWN_MS) return;
  lastToastByOrigin.set(origin, now);

  const code = typeof body.code === "string" ? body.code : "";
  const title =
    code === "CSRF_MISSING_HEADER"
      ? "Save blocked: missing CSRF header"
      : code === "CSRF_CROSS_SITE"
        ? "Save blocked: cross-site request rejected"
        : "Save blocked: origin not trusted";

  const description =
    typeof body.hint === "string" && body.hint
      ? body.hint
      : typeof body.error === "string" && body.error
        ? body.error
        : "Marinara rejected this request as untrusted. Add this origin to CSRF_TRUSTED_ORIGINS in your .env, then try again.";

  toast.error(title, {
    description,
    duration: 12_000,
  });
}

async function inspectForCsrf(response: Response): Promise<void> {
  if (response.status !== 403) return;
  try {
    const body = (await response.clone().json()) as CsrfErrorBody;
    if (!looksLikeCsrfFailure(body)) return;
    notifyCsrf(body);
  } catch {
    // Response wasn't JSON or the body was already consumed elsewhere — fall
    // through quietly; the calling code will surface its own error from the
    // 403 in that case.
  }
}

export function installCsrfFetchShim() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const unsafeSameOriginApi = UNSAFE_METHODS.has(method) && isSameOriginApi(input);

    if (!unsafeSameOriginApi) {
      return nativeFetch(input, init);
    }

    const request = new Request(input, init);
    request.headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
    const response = await nativeFetch(request);
    // Fire-and-forget — never block the caller on toast logic.
    void inspectForCsrf(response);
    return response;
  };
}
