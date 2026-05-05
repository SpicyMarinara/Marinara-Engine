// ──────────────────────────────────────────────
// Extension Types
// ──────────────────────────────────────────────

/**
 * A user-installed extension stored on the Marinara server.
 *
 * Extension JS is executed in the page via a same-origin <script src> tag
 * pointing at /api/extensions/:id/script.js so the strict CSP (`script-src 'self'`)
 * can stay in place — there is no `new Function(...)` or `eval` involved.
 */
export interface InstalledExtension {
  id: string;
  name: string;
  description: string;
  /** Optional CSS injected as a <style> tag while enabled. */
  css?: string | null;
  /** Optional JavaScript served at /api/extensions/:id/script.js while enabled. */
  js?: string | null;
  /** Whether the extension is currently active. */
  enabled: boolean;
  /** When the user originally imported it. */
  installedAt: string;
  createdAt: string;
  updatedAt: string;
}
