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
import { Toaster } from "sonner";
import { useUIStore } from "./stores/ui.store";
import { useSidecarStore } from "./stores/sidecar.store";
import { api } from "./lib/api-client";
import { forceRefreshSpa } from "./lib/browser-runtime";
import { useLegacyThemeMigration } from "./hooks/use-themes";
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
  const fontSize = useUIStore((s) => s.fontSize);
  const language = useUIStore((s) => s.language);
  const visualTheme = useUIStore((s) => s.visualTheme);
  const fontFamily = useUIStore((s) => s.fontFamily);
  const hasModalOpen = useUIStore((s) => s.modal !== null);
  useLegacyThemeMigration();
  useSettingsSync();
  const showDownloadModal = useSidecarStore((s) => s.showDownloadModal);
  const setShowDownloadModal = useSidecarStore((s) => s.setShowDownloadModal);
  const fetchSidecarStatus = useSidecarStore((s) => s.fetchStatus);

  // Fetch sidecar status on mount so the Local AI card is populated when opened later.
  useEffect(() => {
    void fetchSidecarStatus();
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
    if (fontFamily) {
      document.documentElement.style.setProperty("--font-user", `"${fontFamily}"`);
    } else {
      document.documentElement.style.removeProperty("--font-user");
    }
  }, [fontFamily]);

  // Pre-load custom fonts at startup so switching to Appearance tab doesn't cause a flash
  const { data: customFonts } = useQuery<{ filename: string; family: string; url: string }[]>({
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
        const fontFace = new FontFace(f.family, `url("${f.url}")`, {
          display: "swap",
        });

        fontFace
          .load()
          .then((loadedFace) => {
            document.fonts.add(loadedFace);
          })
          .catch(() => {
            // Ignore individual font load errors to avoid breaking others
          });
      } catch {
        // Ignore construction errors for invalid font definitions
      }
    });
  }, [customFonts]);

  return (
    <>
      <CustomThemeInjector />
      <AppShell />
      <ModelDownloadModal open={showDownloadModal} onClose={() => setShowDownloadModal(false)} />
      {hasModalOpen && (
        <Suspense fallback={null}>
          <LazyModalRenderer />
        </Suspense>
      )}
      <AppDialogRenderer />
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
