// ──────────────────────────────────────────────
// CustomThemeInjector: Injects active custom theme
// CSS and enabled extension CSS/JS into the DOM
// ──────────────────────────────────────────────
//
// Extension JS is loaded via <script src="/api/extensions/:id/script.js"> —
// a same-origin URL that satisfies `script-src 'self'` without needing
// 'unsafe-eval' or any 'unsafe-inline' allowance. The server wraps each
// extension in an IIFE; this component populates `window.__marinaraExt`
// with the per-extension `marinara` helper API immediately before
// inserting the <script> tag, and removes the entry on cleanup so a
// late-loading script just bails silently.
// ──────────────────────────────────────────────
import { useEffect } from "react";
import { useThemes } from "../../hooks/use-themes";
import { useExtensions } from "../../hooks/use-extensions";
import type { InstalledExtension } from "@marinara-engine/shared";

interface MarinaraExtensionAPI {
  extensionId: string;
  extensionName: string;
  addStyle: (css: string) => HTMLStyleElement;
  addElement: (parent: Element | string, tag: string, attrs?: Record<string, string>) => Element | null;
  apiFetch: (path: string, options?: RequestInit) => Promise<unknown>;
  on: (target: EventTarget, event: string, handler: EventListenerOrEventListenerObject) => void;
  setInterval: (fn: () => void, ms: number) => number;
  setTimeout: (fn: () => void, ms: number) => number;
  observe: (target: Element | string, callback: MutationCallback, options?: MutationObserverInit) => MutationObserver | null;
  onCleanup: (fn: () => void) => void;
}

declare global {
  interface Window {
    __marinaraExt?: Map<string, MarinaraExtensionAPI>;
  }
}

function buildExtensionAPI(ext: InstalledExtension, cleanups: Array<() => void>): MarinaraExtensionAPI {
  const cssIdPrefix = `marinara-ext-js-style-${ext.id}-`;

  return {
    extensionId: ext.id,
    extensionName: ext.name,

    addStyle: (css: string) => {
      const style = document.createElement("style");
      style.id = `${cssIdPrefix}${Date.now()}`;
      style.textContent = css;
      document.head.appendChild(style);
      cleanups.push(() => style.remove());
      return style;
    },

    addElement: (parent, tag, attrs) => {
      const target = typeof parent === "string" ? document.querySelector(parent) : parent;
      if (!target) return null;
      const el = document.createElement(tag);
      if (attrs) {
        Object.entries(attrs).forEach(([k, v]) => {
          if (k === "innerHTML") el.innerHTML = v;
          else if (k === "textContent") el.textContent = v;
          else el.setAttribute(k, v);
        });
      }
      target.appendChild(el);
      cleanups.push(() => el.remove());
      return el;
    },

    apiFetch: async (path, options) => {
      const res = await fetch(`/api${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      return res.json();
    },

    on: (target, event, handler) => {
      target.addEventListener(event, handler);
      cleanups.push(() => target.removeEventListener(event, handler));
    },

    setInterval: (fn, ms) => {
      const id = window.setInterval(fn, ms);
      cleanups.push(() => window.clearInterval(id));
      return id;
    },

    setTimeout: (fn, ms) => {
      const id = window.setTimeout(fn, ms);
      cleanups.push(() => window.clearTimeout(id));
      return id;
    },

    observe: (target, callback, options) => {
      const el = typeof target === "string" ? document.querySelector(target) : target;
      if (!el) return null;
      const observer = new MutationObserver(callback);
      observer.observe(el, options || { childList: true, subtree: true });
      cleanups.push(() => observer.disconnect());
      return observer;
    },

    onCleanup: (fn) => {
      cleanups.push(fn);
    },
  };
}

export function CustomThemeInjector() {
  const { data: syncedThemes = [] } = useThemes();
  const activeTheme = syncedThemes.find((theme) => theme.isActive) ?? null;
  const { data: installedExtensions = [] } = useExtensions();

  // Inject active custom theme CSS
  useEffect(() => {
    const id = "marinara-custom-theme";
    let style = document.getElementById(id) as HTMLStyleElement | null;

    if (!activeTheme) {
      style?.remove();
      return;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = activeTheme.css;

    return () => {
      style?.remove();
    };
  }, [activeTheme]);

  // Inject enabled extension CSS
  useEffect(() => {
    const prefix = "marinara-ext-";

    document.querySelectorAll(`style[id^="${prefix}"]`).forEach((el) => el.remove());

    for (const ext of installedExtensions) {
      if (!ext.enabled || !ext.css) continue;
      const style = document.createElement("style");
      style.id = `${prefix}${ext.id}`;
      style.textContent = ext.css;
      document.head.appendChild(style);
    }

    return () => {
      document.querySelectorAll(`style[id^="${prefix}"]`).forEach((el) => el.remove());
    };
  }, [installedExtensions]);

  // Load enabled extension JS as same-origin <script src> (CSP-safe).
  useEffect(() => {
    const cleanupFns: Array<() => void> = [];
    const tagPrefix = "marinara-ext-js-";

    document.querySelectorAll(`script[id^="${tagPrefix}"]`).forEach((el) => el.remove());

    const apiMap: Map<string, MarinaraExtensionAPI> = window.__marinaraExt ?? new Map();
    window.__marinaraExt = apiMap;

    for (const ext of installedExtensions) {
      if (!ext.enabled || !ext.js) continue;

      const extensionCleanups: Array<() => void> = [];
      const extensionAPI = buildExtensionAPI(ext, extensionCleanups);
      apiMap.set(ext.id, extensionAPI);

      const script = document.createElement("script");
      script.id = `${tagPrefix}${ext.id}`;
      script.async = false;
      // Cache-bust on every update so toggling enabled / editing JS takes
      // effect immediately. The server already sends Cache-Control: no-store,
      // but the query param defends against any intermediary caching too.
      script.src = `/api/extensions/${encodeURIComponent(ext.id)}/script.js?v=${encodeURIComponent(ext.updatedAt)}`;
      document.head.appendChild(script);

      cleanupFns.push(() => {
        apiMap.delete(ext.id);
        script.remove();
        extensionCleanups.forEach((fn) => {
          try {
            fn();
          } catch (e) {
            console.warn(`[Extension:${ext.name}] Cleanup error:`, e);
          }
        });
      });
    }

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
  }, [installedExtensions]);

  return null;
}
