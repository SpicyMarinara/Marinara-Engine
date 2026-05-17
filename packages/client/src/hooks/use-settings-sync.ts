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
import {
  normalizeTrackerPanelSizeProfile,
  normalizeTrackerTemperatureUnit,
  normalizeTrackerThoughtBubbleDisplay,
  pickSyncedSettings,
  useUIStore,
} from "../stores/ui.store";

type SettingsResponse = { value: string | null };

const SETTINGS_KEY = "ui";
const SETTINGS_PATH = `/app-settings/${SETTINGS_KEY}`;
const LOCAL_SETTINGS_KEY = "marinara-engine-ui";
const LOCAL_UPDATED_AT_KEY = "marinara-engine-ui-updated-at";
const DEBOUNCE_MS = 1000;

type SyncedSettingsObject = ReturnType<typeof pickSyncedSettings>;
type ServerSettingsPayload = SyncedSettingsObject & { __updatedAt?: number };

function readLocalUpdatedAt(): number | null {
  const value = window.localStorage.getItem(LOCAL_UPDATED_AT_KEY);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function writeLocalUpdatedAt(updatedAt: number): void {
  window.localStorage.setItem(LOCAL_UPDATED_AT_KEY, String(updatedAt));
}

function hasLocalPersistedUiState(): boolean {
  return window.localStorage.getItem(LOCAL_SETTINGS_KEY) !== null;
}

function serializeSettings(settings: SyncedSettingsObject): string {
  return JSON.stringify(settings);
}

function buildServerSettingsValue(settings: SyncedSettingsObject, updatedAt: number): string {
  return JSON.stringify({ ...settings, __updatedAt: updatedAt } satisfies ServerSettingsPayload);
}

function parseServerSettingsValue(value: string): {
  settings: Partial<SyncedSettingsObject> & Record<string, unknown>;
  updatedAt: number | null;
} {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid settings payload");
  }

  const payload = { ...(parsed as ServerSettingsPayload) };
  const updatedAt =
    typeof payload.__updatedAt === "number" && Number.isFinite(payload.__updatedAt) ? payload.__updatedAt : null;
  delete payload.__updatedAt;
  return { settings: payload, updatedAt };
}

export function useSettingsSync() {
  useEffect(() => {
    let disposed = false;
    let ready = false;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPushed = "";
    let pendingUpdatedAt: number | null = null;

    const serialize = () => serializeSettings(pickSyncedSettings(useUIStore.getState()));

    const pushNow = () => {
      pushTimer = null;
      if (disposed) return;
      const settings = pickSyncedSettings(useUIStore.getState());
      const settingsFingerprint = serializeSettings(settings);
      if (settingsFingerprint === lastPushed) return;
      const updatedAt = pendingUpdatedAt ?? readLocalUpdatedAt() ?? Date.now();
      pendingUpdatedAt = null;
      writeLocalUpdatedAt(updatedAt);
      lastPushed = settingsFingerprint;
      api.put(SETTINGS_PATH, { value: buildServerSettingsValue(settings, updatedAt) }).catch(() => {
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
      const current = serializeSettings(pickSyncedSettings(state));
      const previous = serializeSettings(pickSyncedSettings(prev));
      if (current !== previous) {
        pendingUpdatedAt = Date.now();
        writeLocalUpdatedAt(pendingUpdatedAt);
        schedulePush();
      }
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
        const localSettings = pickSyncedSettings(useUIStore.getState());
        const localFingerprint = serializeSettings(localSettings);
        const defaultFingerprint = serializeSettings(pickSyncedSettings(useUIStore.getInitialState()));
        const localCustomized = hasLocalPersistedUiState() && localFingerprint !== defaultFingerprint;
        let localUpdatedAt = readLocalUpdatedAt();
        if (!localUpdatedAt && localCustomized) {
          localUpdatedAt = Date.now();
          writeLocalUpdatedAt(localUpdatedAt);
        }

        const data = await api.get<SettingsResponse>(SETTINGS_PATH);
        if (disposed) return;
        if (data.value) {
          try {
            const parsed = parseServerSettingsValue(data.value);
            if (parsed.settings && typeof parsed.settings === "object") {
              // Migrate old flat gradient fields → per-scheme nested (v10 → v11).
              if ("convoGradientFrom" in parsed.settings || "convoGradientTo" in parsed.settings) {
                const legacyGradientFrom =
                  typeof parsed.settings.convoGradientFrom === "string" ? parsed.settings.convoGradientFrom : "#0a0a0e";
                const legacyGradientTo =
                  typeof parsed.settings.convoGradientTo === "string" ? parsed.settings.convoGradientTo : "#1c2133";
                parsed.settings.convoGradient = {
                  dark: {
                    from: legacyGradientFrom,
                    to: legacyGradientTo,
                  },
                  light: { from: "#f2eff7", to: "#eae6f0" },
                };
                delete parsed.settings.convoGradientFrom;
                delete parsed.settings.convoGradientTo;
              }
              parsed.settings.trackerPanelSizeProfile = normalizeTrackerPanelSizeProfile(
                parsed.settings.trackerPanelSizeProfile,
                parsed.settings.trackerPanelWidth,
              );
              delete parsed.settings.trackerPanelWidth;
              parsed.settings.trackerPanelThoughtBubbleDisplay = normalizeTrackerThoughtBubbleDisplay(
                parsed.settings.trackerPanelThoughtBubbleDisplay,
              );
              parsed.settings.trackerPanelDockedThoughtsAlwaysVisible =
                parsed.settings.trackerPanelDockedThoughtsAlwaysVisible === true;
              parsed.settings.trackerTemperatureUnit = normalizeTrackerTemperatureUnit(
                parsed.settings.trackerTemperatureUnit,
              );

              const serverUpdatedAt = parsed.updatedAt;
              const localIsNewer =
                localUpdatedAt !== null &&
                (serverUpdatedAt === null ? localCustomized : localUpdatedAt > serverUpdatedAt);

              if (localIsNewer) {
                lastPushed = "";
                pushNow();
              } else {
                useUIStore.setState(parsed.settings);
                lastPushed = serialize();
                if (serverUpdatedAt !== null) writeLocalUpdatedAt(serverUpdatedAt);
              }
            }
          } catch {
            // Corrupt blob on the server — ignore and let the next edit overwrite it.
            lastPushed = serialize();
          }
        } else {
          // Server has no settings yet — seed it with whatever is in the local
          // store (either defaults or previously-localStorage-persisted values).
          const settings = pickSyncedSettings(useUIStore.getState());
          const updatedAt = localUpdatedAt ?? Date.now();
          writeLocalUpdatedAt(updatedAt);
          const payload = serializeSettings(settings);
          lastPushed = payload;
          try {
            await api.put(SETTINGS_PATH, { value: buildServerSettingsValue(settings, updatedAt) });
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
      flushNow();
      disposed = true;
      unsubscribe();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
