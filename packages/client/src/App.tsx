// ──────────────────────────────────────────────
// App: Root component with layout
// ──────────────────────────────────────────────
import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { APP_VERSION } from "@marinara-engine/shared";
import { AppShell } from "./components/layout/AppShell";
import { CustomThemeInjector } from "./components/layout/CustomThemeInjector";
import { ModelDownloadModal } from "./components/modals/ModelDownloadModal";
import { AppDialogRenderer } from "./components/ui/AppDialogRenderer";
import { ChibiProfessorMariEasterEgg } from "./components/ui/ChibiProfessorMariEasterEgg";
import { CsrfOriginWarningBanner } from "./components/diagnostics/CsrfOriginWarningBanner";
import { Toaster } from "sonner";
import { useUIStore } from "./stores/ui.store";
import { useSidecarStore } from "./stores/sidecar.store";
import { api } from "./lib/api-client";
import { forceRefreshSpa } from "./lib/browser-runtime";
import { useLegacyThemeMigration } from "./hooks/use-themes";
import { useLegacyExtensionMigration } from "./hooks/use-extensions";
import { useSettingsSync } from "./hooks/use-settings-sync";

const VERSION_RECOVERY_KEY = "marinara:pwa-version-recovery";
const VERSION_CHECK_INTERVAL_MS = 5 * 60_000;
const LazyModalRenderer = lazy(() =>
  import("./components/layout/ModalRenderer").then((module) => ({ default: module.ModalRenderer })),
);

type HealthResponse = {
  status: string;
  timestamp: string;
  version: string;
};

type CustomFontFace = {
  filename: string;
  family: string;
  url: string;
  weight?: string;
  style?: string;
  unicodeRange?: string;
};

const registeredCustomFontFaceKeys = new Set<string>();

function stripFontFamilyQuotes(family: string): string {
  const trimmed = family.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote !== `"` && quote !== `'`) || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }

  return trimmed.slice(1, -1).trim();
}

function toCssFontFamilyValue(family: string): string {
  const cleanFamily = stripFontFamilyQuotes(family);
  return `"${cleanFamily.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function customFontFaceKey(family: string, font: CustomFontFace): string {
  return [family, font.url, font.weight ?? "400", font.style ?? "normal", font.unicodeRange ?? ""].join("|");
}

function syncRangeSliderProgress(input: HTMLInputElement) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || 0);
  const span = max - min;
  const percent = Number.isFinite(span) && span > 0 ? ((value - min) / span) * 100 : 0;
  input.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, percent))}%`);
}

async function recoverFromVersionSkew(serverVersion: string) {
  if (sessionStorage.getItem(VERSION_RECOVERY_KEY) === serverVersion) {
    return;
  }

  sessionStorage.setItem(VERSION_RECOVERY_KEY, serverVersion);
  await forceRefreshSpa({
    queryParamKey: "v",
    queryParamValue: serverVersion,
  });
}

export function App() {
  const theme = useUIStore((s) => s.theme);
  const isLite = import.meta.env.VITE_MARINARA_LITE === "true";
  const fontSize = useUIStore((s) => s.fontSize);
  const language = useUIStore((s) => s.language);
  const visualTheme = useUIStore((s) => s.visualTheme);
  const fontFamily = useUIStore((s) => s.fontFamily);
  const hasModalOpen = useUIStore((s) => s.modal !== null);
  useLegacyThemeMigration();
  useLegacyExtensionMigration();
  useSettingsSync();
  const showDownloadModal = useSidecarStore((s) => s.showDownloadModal);
  const setShowDownloadModal = useSidecarStore((s) => s.setShowDownloadModal);
  const fetchSidecarStatus = useSidecarStore((s) => s.fetchStatus);

  useEffect(() => {
    const syncAll = () => {
      document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(syncRangeSliderProgress);
    };
    const syncNode = (node: Node) => {
      if (node instanceof HTMLInputElement && node.type === "range") {
        syncRangeSliderProgress(node);
        return;
      }
      if (node instanceof Element) {
        node.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(syncRangeSliderProgress);
      }
    };
    const syncEventTarget = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === "range") {
        syncRangeSliderProgress(event.target);
      }
    };

    syncAll();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach(syncNode);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", syncEventTarget, true);
    document.addEventListener("change", syncEventTarget, true);
    document.addEventListener("focusin", syncEventTarget, true);
    document.addEventListener("pointerover", syncEventTarget, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("input", syncEventTarget, true);
      document.removeEventListener("change", syncEventTarget, true);
      document.removeEventListener("focusin", syncEventTarget, true);
      document.removeEventListener("pointerover", syncEventTarget, true);
    };
  }, []);

  // Fetch sidecar status on mount so the Local AI card is populated when opened later.
  useEffect(() => {
    if (!isLite) void fetchSidecarStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply theme + font size to the document root whenever they change
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // Apply visual theme (default / sillytavern) to the document root
  useEffect(() => {
    if (visualTheme && visualTheme !== "default") {
      document.documentElement.dataset.visualTheme = visualTheme;
    } else {
      delete document.documentElement.dataset.visualTheme;
    }
  }, [visualTheme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    const checkVersion = async () => {
      try {
        const res = await fetch("/api/health", {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        if (!res.ok) {
          return;
        }

        const health = (await res.json()) as HealthResponse;
        if (cancelled) {
          return;
        }

        if (health.version === APP_VERSION) {
          sessionStorage.removeItem(VERSION_RECOVERY_KEY);
          return;
        }

        await recoverFromVersionSkew(health.version);
      } catch {
        // Ignore version checks when the network is unavailable.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    };

    void checkVersion();
    const intervalId = window.setInterval(() => {
      void checkVersion();
    }, VERSION_CHECK_INTERVAL_MS);

    window.addEventListener("pageshow", checkVersion);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("pageshow", checkVersion);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Apply custom font family via CSS variable
  useEffect(() => {
    const family = fontFamily ? stripFontFamilyQuotes(fontFamily) : "";
    if (family) {
      document.documentElement.style.setProperty("--font-user", toCssFontFamilyValue(family));
    } else {
      document.documentElement.style.removeProperty("--font-user");
    }
  }, [fontFamily]);

  // Register custom font faces without forcing every shard to load at startup.
  const { data: customFonts } = useQuery<CustomFontFace[]>({
    queryKey: ["custom-fonts"],
    queryFn: () => api.get("/fonts"),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!customFonts?.length) return;

    // Prefer FontFace API over injecting CSS into a <style> tag to avoid CSS injection
    if (typeof FontFace === "undefined" || !document.fonts) {
      return;
    }

    customFonts.forEach((f) => {
      if (!f.family || !f.url) {
        return;
      }

      try {
        const family = stripFontFamilyQuotes(f.family);
        if (!family) {
          return;
        }

        const key = customFontFaceKey(family, f);
        if (registeredCustomFontFaceKeys.has(key)) {
          return;
        }

        const fontFace = new FontFace(family, `url("${f.url}")`, {
          display: "swap",
          weight: f.weight ?? "400",
          style: f.style ?? "normal",
          ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
        });

        document.fonts.add(fontFace);
        registeredCustomFontFaceKeys.add(key);
      } catch {
        // Ignore construction errors for invalid font definitions
      }
    });
  }, [customFonts]);

  return (
    <>
      <CustomThemeInjector />
      <ChibiProfessorMariEasterEgg />
      <AppShell />
      {!isLite && <ModelDownloadModal open={showDownloadModal} onClose={() => setShowDownloadModal(false)} />}
      {hasModalOpen && (
        <Suspense fallback={null}>
          <LazyModalRenderer />
        </Suspense>
      )}
      <AppDialogRenderer />
      <CsrfOriginWarningBanner />
      <Toaster
        position="bottom-right"
        theme={theme}
        closeButton
        toastOptions={{
          style: {
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
            userSelect: "text",
            WebkitUserSelect: "text",
          },
        }}
      />
    </>
  );
}
