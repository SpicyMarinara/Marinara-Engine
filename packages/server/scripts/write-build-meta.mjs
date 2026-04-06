import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const MONOREPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const BUILD_META_PATH = resolve(PACKAGE_ROOT, "dist", "config", "build-meta.json");
const COMMIT_LENGTH = 12;

function normalizeCommit(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, COMMIT_LENGTH);
}

function resolveCommit() {
  const envCommit = normalizeCommit(process.env.MARINARA_GIT_COMMIT ?? process.env.GITHUB_SHA);
  if (envCommit) return envCommit;

  try {
    return normalizeCommit(
      execFileSync("git", ["rev-parse", `--short=${COMMIT_LENGTH}`, "HEAD"], {
        cwd: MONOREPO_ROOT,
        encoding: "utf8",
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

mkdirSync(resolve(PACKAGE_ROOT, "dist", "config"), { recursive: true });
writeFileSync(
  BUILD_META_PATH,
  `${JSON.stringify({ commit: resolveCommit(), builtAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8",
);
