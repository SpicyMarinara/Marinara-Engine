import dotenv from "dotenv";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_ROOT = resolve(__dirname, "../..");
const MONOREPO_ROOT = resolve(__dirname, "../../..");
const DEFAULT_PORT = 7860;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_DATA_DIR = resolve(MONOREPO_ROOT, "data");
const LEGACY_DATA_DIR = resolve(SERVER_ROOT, "data");

let envLoaded = false;
let legacyDataDirWarned = false;

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

function directoryHasContent(targetPath: string) {
  if (!existsSync(targetPath)) return false;

  try {
    return readdirSync(targetPath).length > 0;
  } catch {
    return false;
  }
}

function isDisabledFlag(value: string | undefined | null) {
  return ["0", "false", "no", "off"].includes((value ?? "").trim().toLowerCase());
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
  if (raw) return resolveFromRepoRoot(raw);

  const defaultHasContent = directoryHasContent(DEFAULT_DATA_DIR);
  const legacyHasContent = directoryHasContent(LEGACY_DATA_DIR);

  if (!defaultHasContent && legacyHasContent) {
    if (!legacyDataDirWarned) {
      console.warn(
        `[config] Using legacy data directory at ${LEGACY_DATA_DIR}. ` +
          `Set DATA_DIR explicitly or move data into ${DEFAULT_DATA_DIR} to adopt the repo-root default.`,
      );
      legacyDataDirWarned = true;
    }
    return LEGACY_DATA_DIR;
  }

  return DEFAULT_DATA_DIR;
}

export function getDatabaseDriver() {
  return normalizeEnvValue(process.env.DATABASE_DRIVER);
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

  return `file:${resolveFromRepoRoot(rawPath)}`;
}

export function getDatabaseFilePath() {
  const url = getDatabaseUrl();
  if (!url.startsWith("file:")) return null;

  const filePath = url.slice("file:".length);
  if (!filePath || filePath === ":memory:" || filePath.startsWith(":memory:")) return null;
  return filePath;
}

export function getIpAllowlist() {
  return normalizeEnvValue(process.env.IP_ALLOWLIST);
}

export function isDebugAgentsEnabled() {
  const value = normalizeEnvValue(process.env.DEBUG_AGENTS);
  return value === "1" || value?.toLowerCase() === "true";
}

export function getGifApiKey() {
  return normalizeEnvValue(process.env.GIPHY_API_KEY);
}

export function getSpotifyRedirectUri() {
  return `${getServerProtocol()}://127.0.0.1:${getPort()}/api/spotify/callback`;
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
