// ──────────────────────────────────────────────
// Diagnostic: CSRF origin trust banner
// ──────────────────────────────────────────────
// Probes /api/csrf/origin-status on mount. If the current origin would be
// rejected by the CSRF hook for unsafe mutations, renders a sticky top banner
// so the user knows BEFORE they try to save and watch the change vanish.
//
// Stays out of the way for the 99% case — when the origin is auto-trusted
// (loopback / LAN / Tailscale-IP / Docker-IP / configured), the component
// renders nothing.

import { useEffect, useState } from "react";
import { api } from "../../lib/api-client";

type OriginStatus = {
  trusted: boolean;
  origin: string | null;
  source: "origin" | "referer" | "host" | "none";
  code: "CSRF_ORIGIN_NOT_TRUSTED" | "CSRF_REFERER_NOT_TRUSTED" | "CSRF_NO_ORIGIN" | null;
  hint: string | null;
};

const SESSION_DISMISS_KEY = "marinara:csrf-origin-warning-dismissed";

function extractEnvLine(hint: string): string | null {
  // Hint format: "Add 'http://…' to CSRF_TRUSTED_ORIGINS in your .env — comma-separated if you already have entries,
  //               e.g. CSRF_TRUSTED_ORIGINS=http://existing.example,http://…. No restart needed (takes effect within ~2s)."
  // [^\s]+ spans dots — required for IP literals like 71.175.221.189 — and the trailing period in the hint
  // sentence is stripped afterwards. \b anchors to "CSRF_TRUSTED_ORIGINS=" so the bare mention earlier in the
  // hint ("…to CSRF_TRUSTED_ORIGINS in your .env…") doesn't match.
  const match = hint.match(/\bCSRF_TRUSTED_ORIGINS=[^\s]+/);
  return match ? match[0].replace(/\.$/, "") : null;
}

export function CsrfOriginWarningBanner() {
  const [status, setStatus] = useState<OriginStatus | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<OriginStatus>("/csrf/origin-status")
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        // Probe failure is non-fatal — the toast on actual rejection still fires.
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.trusted || dismissed) return null;

  const envLine = status.hint ? extractEnvLine(status.hint) : null;
  const offender = status.origin ?? window.location.origin;

  const copyEnv = async () => {
    if (!envLine) return;
    try {
      await navigator.clipboard.writeText(envLine);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard API can fail under file:// or non-secure contexts — fall back silently.
    }
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "var(--destructive, #b91c1c)",
        color: "var(--destructive-foreground, #fff)",
        borderBottom: "2px solid color-mix(in srgb, var(--destructive, #b91c1c) 60%, black)",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
        paddingTop: "max(0.75rem, env(safe-area-inset-top))",
        paddingBottom: "0.75rem",
        paddingLeft: "1rem",
        paddingRight: "1rem",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: "0.75rem",
          maxWidth: "1200px",
          margin: "0 auto",
        }}
      >
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.25rem" }}>
            ⚠ Saves will silently fail — this origin is not trusted
          </div>
          <div style={{ fontSize: "0.85rem", opacity: 0.95, lineHeight: 1.4 }}>
            Marinara&apos;s CSRF protection rejects unsafe API requests from{" "}
            <code
              style={{
                background: "rgba(0,0,0,0.25)",
                padding: "0 0.3rem",
                borderRadius: "3px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.82rem",
              }}
            >
              {offender}
            </code>
            . Add this line to your <code>.env</code> (no restart needed, takes effect within ~2s):
          </div>
          {envLine ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.5rem",
                marginTop: "0.5rem",
              }}
            >
              <code
                style={{
                  flex: "1 1 auto",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  padding: "0.35rem 0.55rem",
                  borderRadius: "4px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "0.8rem",
                  wordBreak: "break-all",
                  userSelect: "all",
                }}
              >
                {envLine}
              </code>
              <button
                type="button"
                onClick={copyEnv}
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "1px solid rgba(255,255,255,0.35)",
                  color: "inherit",
                  padding: "0.35rem 0.7rem",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          ) : null}
          <div style={{ fontSize: "0.75rem", opacity: 0.85, marginTop: "0.5rem", lineHeight: 1.35 }}>
            Auto-trusted without adding here: loopback (<code>127.0.0.1</code>, <code>localhost</code>), LAN IPs (
            <code>192.168.x.x</code>, <code>10.x.x.x</code>), Tailscale CGNAT (<code>100.64.0.0/10</code>), Docker
            bridge (<code>172.16.0.0/12</code>). Public IPs and DNS names need to be listed.
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide warning for this session"
          title="Hide for this session"
          style={{
            flexShrink: 0,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.4)",
            color: "inherit",
            width: "2rem",
            height: "2rem",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "1rem",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
