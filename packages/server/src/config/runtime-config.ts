import dotenv from "dotenv";
import { logger as sharedLogger } from "../lib/logger.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_ROOT = resolve(__dirname, "../..");
const MONOREPO_ROOT = resolve(__dirname, "../../../..");
const DEFAULT_PORT = 7860;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_DATA_DIR = resolve(SERVER_ROOT, "data");
const REGRESSION_DATA_DIR = resolve(MONOREPO_ROOT, "data");
const DEFAULT_DATABASE_FILE = "marinara-engine.db";
const DEFAULT_DATABASE_PATH = resolve(DEFAULT_DATA_DIR, DEFAULT_DATABASE_FILE);
const REGRESSION_DATABASE_PATH = resolve(REGRESSION_DATA_DIR, DEFAULT_DATABASE_FILE);

let envLoaded = false;

export function loadRuntimeEnv() {
  if (envLoaded) return;

  const envPath = resolve(MONOREPO_ROOT, ".env");
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }

  envLoaded = true;
}

loadRuntimeEnv();

function normalizeEnvValue(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveFromRepoRoot(targetPath: string) {
  if (isAbsolute(targetPath)) return targetPath;
  return resolve(MONOREPO_ROOT, targetPath);
}

function resolveFromServerRoot(targetPath: string) {
  if (isAbsolute(targetPath)) return targetPath;
  return resolve(SERVER_ROOT, targetPath);
}

function isDisabledFlag(value: string | undefined | null) {
  return ["0", "false", "no", "off"].includes((value ?? "").trim().toLowerCase());
}

function isEnabledFlag(value: string | undefined | null) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function parseCsv(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getMonorepoRoot() {
  return MONOREPO_ROOT;
}

export function getServerRoot() {
  return SERVER_ROOT;
}

export function getHost() {
  return normalizeEnvValue(process.env.HOST) ?? DEFAULT_HOST;
}

export function getPort() {
  const parsed = Number.parseInt(process.env.PORT ?? "", 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

export function getNodeEnv() {
  return normalizeEnvValue(process.env.NODE_ENV) ?? "development";
}

export function getLogLevel() {
  return normalizeEnvValue(process.env.LOG_LEVEL) ?? "warn";
}

export function getServerProtocol() {
  return getTlsFilePaths() ? "https" : "http";
}

export function getDataDir() {
  const raw = normalizeEnvValue(process.env.DATA_DIR);
  if (raw) return resolveFromServerRoot(raw);
  return DEFAULT_DATA_DIR;
}

export function getDatabaseDriver() {
  return normalizeEnvValue(process.env.DATABASE_DRIVER);
}

export function getStorageBackend() {
  const raw = normalizeEnvValue(process.env.STORAGE_BACKEND ?? process.env.MARINARA_STORAGE_BACKEND);
  if (raw) return raw.toLowerCase();

  // New default for v1.5.7+: user data is persisted as files. Advanced users
  // can opt back into the legacy persistent SQLite database with
  // STORAGE_BACKEND=sqlite.
  return "files";
}

export function isFileStorageBackend() {
  return getStorageBackend() !== "sqlite";
}

export function getFileStorageDir() {
  const raw = normalizeEnvValue(process.env.FILE_STORAGE_DIR ?? process.env.MARINARA_FILE_STORAGE_DIR);
  if (raw) return resolveFromServerRoot(raw);
  return resolve(getDataDir(), "storage");
}

export function getDatabaseUrl() {
  const raw = normalizeEnvValue(process.env.DATABASE_URL);
  if (!raw) {
    return `file:${resolve(getDataDir(), "marinara-engine.db")}`;
  }

  if (!raw.startsWith("file:")) {
    return raw;
  }

  const rawPath = raw.slice("file:".length);
  if (!rawPath || rawPath === ":memory:" || rawPath.startsWith(":memory:")) {
    return raw;
  }

  return `file:${resolveFromServerRoot(rawPath)}`;
}

export function getDatabaseFilePath() {
  const url = getDatabaseUrl();
  if (!url.startsWith("file:")) return null;

  const filePath = url.slice("file:".length);
  if (!filePath || filePath === ":memory:" || filePath.startsWith(":memory:")) return null;
  return filePath;
}

export function getLegacyDatabaseImportPaths() {
  const candidates = [getDatabaseFilePath(), DEFAULT_DATABASE_PATH, REGRESSION_DATABASE_PATH].filter(
    (path): path is string => Boolean(path),
  );
  return [...new Set(candidates)];
}

export function getIpAllowlist() {
  // Explicit off-switch lets users keep their list configured but
  // temporarily disable enforcement without deleting the entries.
  if (isDisabledFlag(process.env.IP_ALLOWLIST_ENABLED)) return null;
  return normalizeEnvValue(process.env.IP_ALLOWLIST);
}

export function getBasicAuthConfig() {
  return {
    user: normalizeEnvValue(process.env.BASIC_AUTH_USER),
    pass: normalizeEnvValue(process.env.BASIC_AUTH_PASS),
    realm: normalizeEnvValue(process.env.BASIC_AUTH_REALM) ?? "Marinara Engine",
  };
}

/**
 * Opt-in switch that lets the server accept unauthenticated remote
 * connections (i.e. neither loopback nor IP_ALLOWLIST nor Basic Auth).
 * Default false — protects users who accidentally expose the port.
 */
export function isUnauthenticatedRemoteAllowed() {
  return isEnabledFlag(process.env.ALLOW_UNAUTHENTICATED_REMOTE);
}

/**
 * Explicit compatibility switch for old LAN/Tailscale/Docker convenience.
 * Default false: loopback stays passwordless; every other client needs auth.
 */
export function isUnauthenticatedPrivateNetworkAllowed() {
  return isEnabledFlag(process.env.ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK);
}

/**
 * Optional override for the no-auth-lockdown private-network exemption list.
 * Comma-separated IPs / CIDRs. When set, REPLACES the built-in defaults
 * (RFC 1918, CGNAT, link-local, IPv6 ULA). When unset, defaults are used.
 */
export function getTrustedPrivateNetworksOverride() {
  return normalizeEnvValue(process.env.TRUSTED_PRIVATE_NETWORKS);
}

export function isDebugAgentsEnabled() {
  const value = normalizeEnvValue(process.env.DEBUG_AGENTS);
  return value === "1" || value?.toLowerCase() === "true";
}

export function getGifApiKey() {
  return normalizeEnvValue(process.env.GIPHY_API_KEY);
}

export function getAdminSecret() {
  return normalizeEnvValue(process.env.ADMIN_SECRET);
}

export function getCsrfTrustedOrigins() {
  return parseCsv(process.env.CSRF_TRUSTED_ORIGINS);
}

export function isUpdatesApplyEnabled() {
  return isEnabledFlag(process.env.UPDATES_APPLY_ENABLED);
}

export function isUpdatesRemoteApplyAllowed() {
  return isEnabledFlag(process.env.UPDATES_ALLOW_REMOTE_APPLY);
}

export function isProviderLocalUrlsEnabled() {
  return isEnabledFlag(process.env.PROVIDER_LOCAL_URLS_ENABLED);
}

export function isImageLocalUrlsEnabled() {
  return isEnabledFlag(process.env.IMAGE_LOCAL_URLS_ENABLED);
}

export function isTtsLocalUrlsEnabled() {
  return isEnabledFlag(process.env.TTS_LOCAL_URLS_ENABLED);
}

export function isDeeplxLocalUrlsEnabled() {
  return isEnabledFlag(process.env.DEEPLX_LOCAL_URLS_ENABLED);
}

export function isWebhookLocalUrlsEnabled() {
  return isEnabledFlag(process.env.WEBHOOK_LOCAL_URLS_ENABLED);
}

export function isCustomToolScriptEnabled() {
  return isEnabledFlag(process.env.CUSTOM_TOOL_SCRIPT_ENABLED);
}

export function isSidecarRuntimeInstallEnabled() {
  return isEnabledFlag(process.env.SIDECAR_RUNTIME_INSTALL_ENABLED);
}

export function isHapticsRemoteAllowed() {
  return isEnabledFlag(process.env.HAPTICS_ALLOW_REMOTE);
}

export function getImportAllowedRoots() {
  return parseCsv(process.env.IMPORT_ALLOWED_ROOTS).map(resolveFromRepoRoot);
}

export function getEncryptionKeyOverride() {
  return normalizeEnvValue(process.env.ENCRYPTION_KEY);
}

export function getSpotifyRedirectUriOverride() {
  return normalizeEnvValue(process.env.SPOTIFY_REDIRECT_URI);
}

function getLoopbackFallbackRedirectUri() {
  return `http://127.0.0.1:${getPort()}/api/spotify/callback`;
}

function stripPort(host: string) {
  return host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
}

function isLoopbackHost(host: string) {
  const hostname = stripPort(host);
  return hostname === "127.0.0.1" || hostname === "::1";
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first ? first : null;
}

type RedirectUriRequest = {
  protocol?: string;
  hostname?: string;
  headers: Record<string, string | string[] | undefined>;
};

export function buildSpotifyRedirectUri(req: RedirectUriRequest): string {
  const override = getSpotifyRedirectUriOverride();
  if (override) return override;

  const protocol = (req.protocol ?? "http").toLowerCase();
  const hostHeader = firstHeaderValue(req.headers["host"]);
  const hostname = req.hostname ?? (hostHeader ? stripPort(hostHeader) : null);

  if (!hostname) return getLoopbackFallbackRedirectUri();
  const host = hostHeader ?? hostname;

  if (protocol === "https") return `https://${host}/api/spotify/callback`;
  if (protocol === "http" && isLoopbackHost(host)) return `http://${host}/api/spotify/callback`;
  return getLoopbackFallbackRedirectUri();
}

export function getSpotifyRedirectUri() {
  return getSpotifyRedirectUriOverride() ?? getLoopbackFallbackRedirectUri();
}

export function getCorsConfig() {
  const raw = normalizeEnvValue(process.env.CORS_ORIGINS);
  if (!raw) {
    return {
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      credentials: true,
    };
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return {
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      credentials: true,
    };
  }

  if (origins.includes("*")) {
    return {
      origin: "*",
      credentials: false,
    };
  }

  return {
    origin: origins.length === 1 ? origins[0]! : origins,
    credentials: true,
  };
}

export function getTlsFilePaths() {
  const cert = normalizeEnvValue(process.env.SSL_CERT);
  const key = normalizeEnvValue(process.env.SSL_KEY);
  if (!cert || !key) return null;

  return {
    certPath: resolveFromRepoRoot(cert),
    keyPath: resolveFromRepoRoot(key),
  };
}

export function loadTlsOptions() {
  const tlsPaths = getTlsFilePaths();
  if (!tlsPaths) return null;

  try {
    return {
      cert: readFileSync(tlsPaths.certPath),
      key: readFileSync(tlsPaths.keyPath),
    };
  } catch (err) {
    throw new Error(
      `Failed to load TLS certificate/key files.\n` +
        `  SSL_CERT=${process.env.SSL_CERT}\n` +
        `  SSL_KEY=${process.env.SSL_KEY}\n` +
        `  ${err instanceof Error ? err.message : String(err)}\n` +
        `Please ensure the paths are correct and the files are readable.`,
    );
  }
}

export function isAutoOpenBrowserDisabled(value = process.env.AUTO_OPEN_BROWSER) {
  return isDisabledFlag(value);
}

export function isAutoCreateDefaultConnectionDisabled(value = process.env.AUTO_CREATE_DEFAULT_CONNECTION) {
  return isDisabledFlag(value);
}

export function logStorageDiagnostics(
  logger: { info(...args: any[]): void; warn(...args: any[]): void } = sharedLogger,
) {
  const dataDir = getDataDir();
  const dbPath = getDatabaseFilePath();
  const backend = getStorageBackend();
  const legacyImportPaths = getLegacyDatabaseImportPaths();

  logger.info(`[storage] DATA_DIR=${dataDir}`);
  logger.info(`[storage] STORAGE_BACKEND=${backend}`);
  if (backend !== "sqlite") {
    logger.info(`[storage] FILE_STORAGE_DIR=${getFileStorageDir()}`);
    if (legacyImportPaths.length > 0) {
      logger.info(`[storage] LEGACY_DATABASE_IMPORT_SOURCES=${legacyImportPaths.join(", ")}`);
    }
  } else if (dbPath) {
    logger.info(`[storage] DATABASE_FILE=${dbPath}`);
  } else {
    logger.info(`[storage] DATABASE_URL=${getDatabaseUrl()}`);
  }

  if (existsSync(DEFAULT_DATABASE_PATH) && existsSync(REGRESSION_DATABASE_PATH)) {
    if (dbPath === DEFAULT_DATABASE_PATH) {
      logger.warn(
        `[storage] Both database locations exist: ${DEFAULT_DATABASE_PATH} and ${REGRESSION_DATABASE_PATH}. ` +
          `Using ${DEFAULT_DATABASE_PATH} for compatibility. The repo-root database may contain data written during the recent path regression. ` +
          `Do not delete either file until recovery is confirmed.`,
      );
      return;
    }

    logger.warn(
      `[storage] Both database locations exist: ${DEFAULT_DATABASE_PATH} and ${REGRESSION_DATABASE_PATH}. ` +
        `The current database resolves to ${dbPath ?? getDatabaseUrl()}. Do not delete either file until recovery is confirmed.`,
    );
  }

  if (dbPath === DEFAULT_DATABASE_PATH && !existsSync(DEFAULT_DATABASE_PATH) && existsSync(REGRESSION_DATABASE_PATH)) {
    logger.warn(
      `[storage] Found a repo-root database at ${REGRESSION_DATABASE_PATH}, but the current compatibility path resolves to ${DEFAULT_DATABASE_PATH}. ` +
        `If data appears missing, inspect both locations and do not delete either file until recovery is confirmed.`,
    );
  }
}
