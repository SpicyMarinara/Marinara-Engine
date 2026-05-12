// ──────────────────────────────────────────────
// Routes: CSRF self-diagnostics
// ──────────────────────────────────────────────
// Lets the browser ask "is the origin I'm sitting on trusted?" on page load
// so the client can show a banner BEFORE the user tries to save and watches
// the change silently vanish. The endpoint is read-only — it does not mutate
// or rate-log; the real CSRF hook is still the gatekeeper for unsafe methods.

import type { FastifyInstance } from "fastify";
import { evaluateRequestOriginTrust } from "../middleware/csrf-protection.js";

export async function csrfDiagnosticsRoutes(app: FastifyInstance) {
  app.get("/origin-status", async (request) => {
    const verdict = evaluateRequestOriginTrust(request);
    return {
      trusted: verdict.trusted,
      origin: verdict.origin,
      source: verdict.source,
      code: verdict.code,
      hint: verdict.hint,
    };
  });
}
