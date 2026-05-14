import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { APP_VERSION } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { safeFetch } from "../../utils/security.js";

export const OPENAI_CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

const REFRESH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_REFRESH_INTERVAL_DAYS = 8;
const EXPIRY_REFRESH_SKEW_SECONDS = 60;

type JsonRecord = Record<string, unknown>;

type CodexAuthJson = {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string | null;
    id_token?: string | JsonRecord | null;
    [key: string]: unknown;
  } | null;
  last_refresh?: string | null;
  [key: string]: unknown;
};

export type OpenAIChatGPTAuth = {
  accessToken: string;
  accountId: string | null;
  planType: string | null;
  isFedrampAccount: boolean;
  authFilePath: string;
  refreshed: boolean;
};

let refreshInFlight: Promise<OpenAIChatGPTAuth> | null = null;

function getCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured || join(homedir(), ".codex");
}

export function getCodexAuthFilePath(): string {
  return join(getCodexHome(), "auth.json");
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true";
}

function decodeJwtPayload(token: string): JsonRecord | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return asRecord(JSON.parse(decoded));
  } catch {
    return null;
  }
}

function getNestedAuthClaims(claims: JsonRecord | null): JsonRecord | null {
  return asRecord(claims?.["https://api.openai.com/auth"]);
}

function normalizeIdTokenInfo(value: unknown): JsonRecord | null {
  if (typeof value === "string") {
    const claims = decodeJwtPayload(value);
    const authClaims = getNestedAuthClaims(claims);
    return {
      email: stringValue(claims?.email) ?? stringValue(asRecord(claims?.["https://api.openai.com/profile"])?.email),
      chatgpt_plan_type: authClaims?.chatgpt_plan_type,
      chatgpt_user_id: stringValue(authClaims?.chatgpt_user_id) ?? stringValue(authClaims?.user_id),
      chatgpt_account_id: stringValue(authClaims?.chatgpt_account_id),
      chatgpt_account_is_fedramp: boolValue(authClaims?.chatgpt_account_is_fedramp),
      raw_jwt: value,
    };
  }
  return asRecord(value);
}

function jwtExpiresSoon(accessToken: string): boolean {
  const exp = decodeJwtPayload(accessToken)?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp <= nowSeconds + EXPIRY_REFRESH_SKEW_SECONDS;
}

function lastRefreshIsStale(lastRefresh: unknown): boolean {
  const raw = stringValue(lastRefresh);
  if (!raw) return false;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return false;
  const ageMs = Date.now() - parsed;
  return ageMs > TOKEN_REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}

function authPolicy() {
  return {
    allowLocal: false,
    allowLoopback: false,
    allowMdns: false,
    allowedProtocols: ["https:"],
    flagName: "OPENAI_CHATGPT_AUTH",
  };
}

async function readCodexAuth(authFilePath: string): Promise<CodexAuthJson> {
  let raw: string;
  try {
    raw = await readFile(authFilePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No Codex ChatGPT login found at ${authFilePath}. Run \`codex login\` on this host, then try again.`,
      );
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as unknown;
  const auth = asRecord(parsed);
  if (!auth) throw new Error(`Codex auth file at ${authFilePath} is not a JSON object.`);
  return auth as CodexAuthJson;
}

function authFromJson(auth: CodexAuthJson, authFilePath: string, refreshed: boolean): OpenAIChatGPTAuth {
  const tokens = auth.tokens;
  if (!tokens || typeof tokens !== "object") {
    const mode = stringValue(auth.auth_mode) ?? (auth.OPENAI_API_KEY ? "ApiKey" : "unknown");
    throw new Error(
      `Codex auth at ${authFilePath} is ${mode} auth, not ChatGPT OAuth. Run \`codex login\` on this host.`,
    );
  }

  const accessToken = stringValue(tokens.access_token);
  if (!accessToken) {
    throw new Error(`Codex ChatGPT auth at ${authFilePath} does not contain an access token. Run \`codex login\`.`);
  }

  const idTokenInfo = normalizeIdTokenInfo(tokens.id_token);
  const accessClaims = decodeJwtPayload(accessToken);
  const accessAuthClaims = getNestedAuthClaims(accessClaims);
  const accountId =
    stringValue(tokens.account_id) ??
    stringValue(idTokenInfo?.chatgpt_account_id) ??
    stringValue(accessAuthClaims?.chatgpt_account_id);
  const planTypeRaw = idTokenInfo?.chatgpt_plan_type;
  const planType =
    typeof planTypeRaw === "string"
      ? planTypeRaw
      : asRecord(planTypeRaw)?.known
        ? stringValue(asRecord(planTypeRaw)?.known)
        : asRecord(planTypeRaw)?.unknown
          ? stringValue(asRecord(planTypeRaw)?.unknown)
          : null;

  return {
    accessToken,
    accountId,
    planType,
    isFedrampAccount: boolValue(idTokenInfo?.chatgpt_account_is_fedramp),
    authFilePath,
    refreshed,
  };
}

async function refreshAuth(auth: CodexAuthJson, authFilePath: string): Promise<OpenAIChatGPTAuth> {
  const tokens = auth.tokens;
  const refreshToken = stringValue(tokens?.refresh_token);
  if (!tokens || !refreshToken) {
    throw new Error(`Codex ChatGPT access token is stale, but no refresh token is available. Run \`codex login\`.`);
  }

  const res = await safeFetch(REFRESH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    policy: authPolicy(),
    maxResponseBytes: 1024 * 1024,
    decodeCompressedResponse: true,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to refresh Codex ChatGPT login (${res.status}): ${text.slice(0, 200)}`);
  }

  const response = (await res.json()) as JsonRecord;
  const nextAccessToken = stringValue(response.access_token) ?? stringValue(tokens.access_token);
  if (!nextAccessToken) {
    throw new Error("Codex ChatGPT token refresh did not return an access token.");
  }

  tokens.access_token = nextAccessToken;
  const nextRefreshToken = stringValue(response.refresh_token);
  if (nextRefreshToken) tokens.refresh_token = nextRefreshToken;
  const nextIdToken = stringValue(response.id_token);
  if (nextIdToken) tokens.id_token = nextIdToken;
  auth.last_refresh = new Date().toISOString();

  await mkdir(dirname(authFilePath), { recursive: true });
  await writeFile(authFilePath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  await chmod(authFilePath, 0o600).catch(() => {});
  logger.info("[openai-chatgpt] Refreshed local Codex ChatGPT auth token");

  return authFromJson(auth, authFilePath, true);
}

async function loadAuthImpl(): Promise<OpenAIChatGPTAuth> {
  const authFilePath = getCodexAuthFilePath();
  const auth = await readCodexAuth(authFilePath);
  const tokens = auth.tokens;
  const accessToken = stringValue(tokens?.access_token);
  const shouldRefresh = accessToken != null && (jwtExpiresSoon(accessToken) || lastRefreshIsStale(auth.last_refresh));

  if (shouldRefresh) return refreshAuth(auth, authFilePath);
  return authFromJson(auth, authFilePath, false);
}

export async function getOpenAIChatGPTAuth(): Promise<OpenAIChatGPTAuth> {
  if (!refreshInFlight) {
    refreshInFlight = loadAuthImpl().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export function buildOpenAIChatGPTHeaders(auth: OpenAIChatGPTAuth): Record<string, string> {
  const headers: Record<string, string> = {
    version: APP_VERSION,
    originator: "Marinara-Engine",
    "User-Agent": `MarinaraEngine/${APP_VERSION}`,
  };
  if (auth.accountId) headers["ChatGPT-Account-ID"] = auth.accountId;
  if (auth.isFedrampAccount) headers["X-OpenAI-Fedramp"] = "true";
  return headers;
}

export async function fetchOpenAIChatGPTModels(): Promise<Array<{ id: string; name: string }>> {
  const auth = await getOpenAIChatGPTAuth();
  const url = `${OPENAI_CHATGPT_CODEX_BASE_URL}/models?client_version=${encodeURIComponent(APP_VERSION)}`;
  const res = await safeFetch(url, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...buildOpenAIChatGPTHeaders(auth),
    },
    policy: authPolicy(),
    maxResponseBytes: 5 * 1024 * 1024,
    decodeCompressedResponse: true,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ChatGPT model catalog returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as JsonRecord;
  const models = Array.isArray(json.models) ? json.models : [];
  return models
    .map((item) => {
      const record = asRecord(item);
      const id = stringValue(record?.slug) ?? stringValue(record?.id);
      if (!id) return null;
      return { id, name: stringValue(record?.display_name) ?? stringValue(record?.name) ?? id };
    })
    .filter((model): model is { id: string; name: string } => Boolean(model));
}
