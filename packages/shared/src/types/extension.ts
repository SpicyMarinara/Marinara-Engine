// ──────────────────────────────────────────────
// Extension Types
// ──────────────────────────────────────────────

/**
 * A user-installed extension stored on the Marinara server.
 *
 * Extension JS is delivered to the client as part of the list payload and
 * executed in the page via the existing blob-URL loader in
 * `CustomThemeInjector.tsx`. There is no server-side script-serving endpoint —
 * CSP/eval characteristics are governed entirely by that loader.
 */
export interface InstalledExtension {
  id: string;
  name: string;
  description: string;
  /** Optional CSS injected as a <style> tag while enabled. */
  css?: string | null;
  /** Optional JavaScript payload consumed by the client loader while enabled. */
  js?: string | null;
  /** Whether the extension is currently active. */
  enabled: boolean;
  /** When the user originally imported it. */
  installedAt: string;
  createdAt: string;
  updatedAt: string;
}
