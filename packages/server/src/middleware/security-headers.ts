import type { FastifyReply, FastifyRequest } from "fastify";

const SECURITY_HEADERS: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
};

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "xr-spatial-tracking=()",
].join(", ");

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

export function securityHeadersHook(_request: FastifyRequest, reply: FastifyReply, done: () => void) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(name, value);
  }
  reply.header("Permissions-Policy", PERMISSIONS_POLICY);
  reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  done();
}
