// ──────────────────────────────────────────────
// Shared Logger — Pino singleton
// ──────────────────────────────────────────────
// Every module in the server package should import `logger` from here
// instead of using `console.log/warn/error` directly. This ensures
// LOG_LEVEL actually controls what gets printed.
//
// The Fastify app reuses this same instance so request-scoped child
// loggers (req.log / reply.log) inherit the same level and transport.
// ──────────────────────────────────────────────
import pino from "pino";
import { getLogLevel, getNodeEnv } from "../config/runtime-config.js";

export const logger = pino({
  level: getLogLevel(),
  transport:
    getNodeEnv() !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
