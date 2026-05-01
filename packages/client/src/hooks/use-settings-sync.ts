// ──────────────────────────────────────────────
// Hook: Cross-device UI settings sync
// ──────────────────────────────────────────────
// On mount: fetches the server's saved settings blob and overlays it onto the
// UI store so every browser/device sees the same preferences. If the server
// has no blob yet, the current local state is pushed as the initial seed
// (one-time migration for users upgrading from browser-only storage).
//
// While the app runs: subscribes to UI store changes, debounces serialization,
// and pushes the synced subset to the server. Only user-facing preference
// edits trigger a push — transient UI state (modal open, detail panels, etc.)
// is filtered out via `pickSyncedSettings`.
import { useEffect } from "react";
import { api } from "../lib/api-client";
import { pickSyncedSettings, useUIStore } from "../stores/ui.store";

type SettingsResponse = { value: string | null };

const SETTINGS_KEY = "ui";
const SETTINGS_PATH = `/app-settings/${SETTINGS_KEY}`;
const DEBOUNCE_MS = 1000;

export function useSettingsSync() {
  useEffect(() => {
    let disposed = false;
    let ready = false;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPushed = "";

    const serialize = () => JSON.stringify(pickSyncedSettings(useUIStore.getState()));

    const pushNow = () => {
      pushTimer = null;
      if (disposed) return;
      const payload = serialize();
      if (payload === lastPushed) return;
      lastPushed = payload;
      api.put(SETTINGS_PATH, { value: payload }).catch(() => {
        // Server unreachable — next change will retry. We keep `lastPushed`
        // as the failed payload so we only re-send when the user actually
        // changes something again.
      });
    };

    const schedulePush = () => {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, DEBOUNCE_MS);
    };

    const flushNow = () => {
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
        pushNow();
      }
    };

    const unsubscribe = useUIStore.subscribe((state, prev) => {
      if (!ready || disposed) return;
      const current = JSON.stringify(pickSyncedSettings(state));
      const previous = JSON.stringify(pickSyncedSettings(prev));
      if (current !== previous) schedulePush();
    });

    // Flush any pending edits before the tab closes so they reach the server.
    const handleBeforeUnload = () => flushNow();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    void (async () => {
      try {
        const data = await api.get<SettingsResponse>(SETTINGS_PATH);
        if (disposed) return;
        if (data.value) {
          try {
            const parsed = JSON.parse(data.value);
            if (parsed && typeof parsed === "object") {
              // Migrate old flat gradient fields → per-scheme nested (v10 → v11).
              if ("convoGradientFrom" in parsed || "convoGradientTo" in parsed) {
                parsed.convoGradient = {
                  dark: {
                    from: parsed.convoGradientFrom ?? "#0a0a0e",
                    to: parsed.convoGradientTo ?? "#1c2133",
                  },
                  light: { from: "#f2eff7", to: "#eae6f0" },
                };
                delete parsed.convoGradientFrom;
                delete parsed.convoGradientTo;
              }
              useUIStore.setState(parsed);
              lastPushed = JSON.stringify(pickSyncedSettings(useUIStore.getState()));
            }
          } catch {
            // Corrupt blob on the server — ignore and let the next edit overwrite it.
            lastPushed = serialize();
          }
        } else {
          // Server has no settings yet — seed it with whatever is in the local
          // store (either defaults or previously-localStorage-persisted values).
          const payload = serialize();
          lastPushed = payload;
          try {
            await api.put(SETTINGS_PATH, { value: payload });
          } catch {
            // Seed failed; leave `lastPushed` set so the next change triggers a retry.
          }
        }
      } catch {
        // Server unreachable at startup — run with local state only.
        lastPushed = serialize();
      } finally {
        if (!disposed) ready = true;
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushNow();
    };
  }, []);
}
