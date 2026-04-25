// ──────────────────────────────────────────────
// Utility: API Key Encryption
// ──────────────────────────────────────────────
import { logger } from "../lib/logger.js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./data-dir.js";
import { getEncryptionKeyOverride } from "../config/runtime-config.js";

const ALGORITHM = "aes-256-gcm";

let cachedKey: Buffer | null = null;

/**
 * Resolve the encryption key with the following priority:
 *  1. ENCRYPTION_KEY env var  (explicit override)
 *  2. Auto-generated key persisted in <DATA_DIR>/.encryption-key
 *
 * If no key exists anywhere, one is generated and saved automatically
 * so updates never break existing installs.
 */
function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  // 1. Env var takes priority
  const envKey = getEncryptionKeyOverride();
  if (envKey) {
    cachedKey = Buffer.from(envKey, "hex");
    return cachedKey;
  }

  // 2. Check for persisted key in data dir
  const keyPath = join(DATA_DIR, ".encryption-key");
  if (existsSync(keyPath)) {
    const stored = readFileSync(keyPath, "utf-8").trim();
    if (stored) {
      cachedKey = Buffer.from(stored, "hex");
      return cachedKey;
    }
  }

  // 3. Auto-generate and persist a new key
  const newKey = randomBytes(32);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(keyPath, newKey.toString("hex") + "\n", { mode: 0o600 });
  logger.info("[CRYPTO] No ENCRYPTION_KEY found — generated and saved to %s", keyPath);
  cachedKey = newKey;
  return cachedKey;
}

/** Encrypt a plaintext API key. Returns "iv:encrypted:authTag" in hex. */
export function encryptApiKey(plaintext: string): string {
  if (!plaintext) return "";
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}

/** Decrypt an encrypted API key string. */
export function decryptApiKey(encrypted: string): string {
  if (!encrypted) return "";
  const key = getEncryptionKey();
  const [ivHex, encHex, authTagHex] = encrypted.split(":");
  if (!ivHex || !encHex || !authTagHex) return "";
  try {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    // Key was encrypted with a different encryption key that no longer exists
    logger.warn("[CRYPTO] Failed to decrypt API key — encryption key may have changed. Please re-enter the API key.");
    return "";
  }
}
