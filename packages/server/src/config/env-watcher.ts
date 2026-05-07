// ──────────────────────────────────────────────
// .env hot-reload watcher
// ──────────────────────────────────────────────
// Polls the monorepo-root .env file and re-applies changes to process.env
// without requiring a server restart. Most security middleware (basic-auth,
// IP allowlist, CSRF, admin secret, etc.) reads via getter functions in
// runtime-config.ts, so updates take effect on the next request.
//
// A small set of variables are bound at boot and CANNOT take effect from a
// reload — we still propagate them to process.env, but log a warning so the
// operator knows a restart is required for them.

import { existsSync, statSync, watchFile, unwatchFile } from "node:fs";
import { logger } from "../lib/logger.js";
import { getEnvFilePath, reloadRuntimeEnv, type EnvReloadResult } from "./runtime-config.js";

// Keys whose values are bound at process / app startup and won't take effect
// without a full restart, even though we propagate them to process.env.
//
// CORS_ORIGINS is intentionally NOT in this list — the @fastify/cors plugin
// uses a function-based origin that re-reads getCorsConfig() per request
// (see cors-config.ts), so adding/removing origins is hot-reloadable. The
// only sub-case that still needs a restart is switching between an explicit
// origin list and "*" (the credentials response header changes), but that's
// rare enough that we don't list the var here as "always restart-required."
const RESTART_REQUIRED_KEYS = new Set<string>([
  "PORT",
  "HOST",
  "SSL_CERT",
  "SSL_KEY",
  "DATA_DIR",
  "STORAGE_BACKEND",
  "FILE_STORAGE_DIR",
  "DATABASE_URL",
  "DATABASE_DRIVER",
  "ENCRYPTION_KEY",
  "TZ",
  "AUTO_OPEN_BROWSER",
  "AUTO_CREATE_DEFAULT_CONNECTION",
  "NODE_ENV",
]);

// Keys whose values must be masked when logged.
const SENSITIVE_KEYS = new Set<string>([
  "BASIC_AUTH_PASS",
  "ADMIN_SECRET",
  "ENCRYPTION_KEY",
  "GIPHY_API_KEY",
]);

function maskValue(key: string, value: string | undefined): string {
  if (value === undefined) return "<unset>";
  if (SENSITIVE_KEYS.has(key)) {
    if (!value) return "<empty>";
    return `<set, length=${value.length}>`;
  }
  return value === "" ? "<empty>" : value;
}

function describeKey(key: string): string {
  return `${key}=${maskValue(key, process.env[key])}`;
}

function applyLogLevel(diff: EnvReloadResult) {
  if (!diff.updated.includes("LOG_LEVEL") && !diff.added.includes("LOG_LEVEL") && !diff.removed.includes("LOG_LEVEL")) {
    return;
  }
  const next = (process.env.LOG_LEVEL ?? "warn").trim() || "warn";
  try {
    logger.level = next;
  } catch (err) {
    logger.warn({ err, requested: next }, "[env-watcher] Could not apply new LOG_LEVEL to logger");
  }
}

function logDiff(diff: EnvReloadResult) {
  const totalChanges = diff.added.length + diff.updated.length + diff.removed.length;
  if (totalChanges === 0) {
    logger.debug("[env-watcher] .env modified, no effective changes");
    return;
  }

  const restartKeys: string[] = [];
  for (const key of [...diff.added, ...diff.updated, ...diff.removed]) {
    if (RESTART_REQUIRED_KEYS.has(key)) restartKeys.push(key);
  }

  if (diff.added.length > 0) {
    logger.info(`[env-watcher] Added: ${diff.added.map(describeKey).join(", ")}`);
  }
  if (diff.updated.length > 0) {
    logger.info(`[env-watcher] Updated: ${diff.updated.map(describeKey).join(", ")}`);
  }
  if (diff.removed.length > 0) {
    logger.info(`[env-watcher] Removed: ${diff.removed.join(", ")}`);
  }

  if (restartKeys.length > 0) {
    logger.warn(
      `[env-watcher] These variables changed but require a server restart to take effect: ${restartKeys.join(", ")}`,
    );
  }
}

export interface EnvWatcherHandle {
  stop(): void;
  reloadNow(): EnvReloadResult | null;
}

export function startEnvWatcher(): EnvWatcherHandle {
  const envPath = getEnvFilePath();
  let stopped = false;

  if (!existsSync(envPath)) {
    logger.info(`[env-watcher] No .env file at ${envPath}; watcher will start once the file is created`);
  } else {
    logger.info(`[env-watcher] Watching ${envPath} for changes (changes propagate without restart)`);
  }

  // Track the last seen mtime/size to ignore polling ticks where nothing
  // actually changed (watchFile can fire on attribute touches too).
  let lastMtimeMs = existsSync(envPath) ? statSync(envPath).mtimeMs : 0;
  let lastSize = existsSync(envPath) ? statSync(envPath).size : -1;

  const handler = (curr: { mtimeMs: number; size: number }, prev: { mtimeMs: number }) => {
    if (stopped) return;
    if (curr.mtimeMs === 0 && prev.mtimeMs !== 0) {
      logger.warn(`[env-watcher] .env disappeared at ${envPath}; clearing previously loaded keys`);
    }
    if (curr.mtimeMs === lastMtimeMs && curr.size === lastSize) return;
    lastMtimeMs = curr.mtimeMs;
    lastSize = curr.size;
    try {
      const diff = reloadRuntimeEnv();
      logDiff(diff);
      applyLogLevel(diff);
    } catch (err) {
      logger.error(err, "[env-watcher] Failed to reload .env");
    }
  };

  watchFile(envPath, { interval: 2_000, persistent: false }, handler);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      unwatchFile(envPath, handler);
    },
    reloadNow() {
      try {
        const diff = reloadRuntimeEnv();
        logDiff(diff);
        applyLogLevel(diff);
        return diff;
      } catch (err) {
        logger.error(err, "[env-watcher] Manual reload failed");
        return null;
      }
    },
  };
}
