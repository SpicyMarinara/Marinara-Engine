import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";
import { existsSync } from "fs";
import { isAbsolute, resolve } from "path";

const SERVER_ROOT = __dirname;
const MONOREPO_ROOT = resolve(__dirname, "..", "..");
const envPath = resolve(MONOREPO_ROOT, ".env");

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function normalizeEnvValue(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveFromServerRoot(targetPath) {
  if (isAbsolute(targetPath)) return targetPath;
  return resolve(SERVER_ROOT, targetPath);
}

const dataDir = (() => {
  const raw = normalizeEnvValue(process.env.DATA_DIR);
  return raw ? resolveFromServerRoot(raw) : resolve(SERVER_ROOT, "data");
})();

const databaseUrl = (() => {
  const raw = normalizeEnvValue(process.env.DATABASE_URL);
  if (!raw) return `file:${resolve(dataDir, "marinara-engine.db")}`;
  if (!raw.startsWith("file:")) return raw;

  const rawPath = raw.slice("file:".length);
  if (!rawPath || rawPath === ":memory:" || rawPath.startsWith(":memory:")) return raw;

  return `file:${resolveFromServerRoot(rawPath)}`;
})();

export default defineConfig({
  schema: [
    "./src/db/schema/chats.ts",
    "./src/db/schema/characters.ts",
    "./src/db/schema/lorebooks.ts",
    "./src/db/schema/prompts.ts",
    "./src/db/schema/connections.ts",
    "./src/db/schema/assets.ts",
    "./src/db/schema/agents.ts",
    "./src/db/schema/custom-tools.ts",
    "./src/db/schema/game-state.ts",
    "./src/db/schema/regex-scripts.ts",
    "./src/db/schema/gallery.ts",
  ],
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: databaseUrl,
  },
});
