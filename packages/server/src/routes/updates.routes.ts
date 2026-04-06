// ──────────────────────────────────────────────
// Updates: Check for new versions and apply updates
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { APP_VERSION } from "@marinara-engine/shared";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { promisify } from "util";
import { getMonorepoRoot } from "../config/runtime-config.js";
import { getBuildCommit, getBuildLabel } from "../config/build-info.js";

const execFileAsync = promisify(execFile);

const GITHUB_REPO = "SpicyMarinara/Marinara-Engine";
const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_REPO}`;
const GITHUB_TAGS_API = `${GITHUB_API_BASE}/git/matching-refs/tags/v`;
const GITHUB_RELEASE_BY_TAG_API = (tag: string) => `${GITHUB_API_BASE}/releases/tags/${tag}`;
const UPDATE_REMOTE = "origin";
const UPDATE_BRANCH = "main";
const UPDATE_REF = `${UPDATE_REMOTE}/${UPDATE_BRANCH}`;

// ── Cached release info (15-min TTL) ──
let cachedRelease: {
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
} | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 15 * 60_000;

// ── Cached commit-level check (5-min TTL) ──
let cachedCommitsBehind: number | null = null;
let commitCheckTimestamp = 0;
const COMMIT_CHECK_TTL_MS = 5 * 60_000;

/** Detect whether this install is a git repo. */
function isGitInstall(): boolean {
  const monorepoRoot = getMonorepoRoot();
  return existsSync(resolve(monorepoRoot, ".git"));
}

async function fetchUpdateRef(root: string) {
  await execFileAsync("git", ["fetch", UPDATE_REMOTE, UPDATE_BRANCH, "--quiet"], {
    cwd: root,
    timeout: 15_000,
  });
}

async function resolveGitRef(root: string, ref: string, shortLength?: number): Promise<string | null> {
  const args = ["rev-parse"];
  if (shortLength != null) {
    args.push(`--short=${shortLength}`);
  }
  args.push(ref);

  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getCurrentBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd: root,
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function hasTrackedChanges(root: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short", "--untracked-files=no"], {
      cwd: root,
      timeout: 5_000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Check how many commits behind origin/main the local HEAD is. Returns 0 if up to date, null on error. */
async function getCommitsBehind(): Promise<number | null> {
  if (!isGitInstall()) return null;
  const root = getMonorepoRoot();
  try {
    // Fetch the tracked auto-update target (no checkout).
    await fetchUpdateRef(root);
    const { stdout } = await execFileAsync("git", ["rev-list", "--count", `HEAD..${UPDATE_REF}`], {
      cwd: root,
      timeout: 5_000,
    });
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return null;
  }
}

/** Compare semver strings. Returns true if b > a. */
function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (bv > av) return true;
    if (bv < av) return false;
  }
  return false;
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const lv = left[i] ?? 0;
    const rv = right[i] ?? 0;
    if (lv > rv) return 1;
    if (lv < rv) return -1;
  }

  return 0;
}

function normalizeTag(tag: string) {
  return tag.replace(/^v/, "");
}

function isStableVersionTag(tag: string) {
  return /^v\d+\.\d+\.\d+$/.test(tag.trim());
}

function buildFallbackRelease(tag: string) {
  return {
    latestVersion: normalizeTag(tag),
    releaseUrl: `${GITHUB_REPO_URL}/releases/tag/${tag}`,
    releaseNotes: "",
    publishedAt: "",
  };
}

function buildRequestHeaders() {
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": `MarinaraEngine/${APP_VERSION}`,
  };
}

async function resolveLatestReleaseFromGitHub(signal: AbortSignal) {
  const tagsRes = await fetch(GITHUB_TAGS_API, {
    headers: buildRequestHeaders(),
    signal,
  });

  if (!tagsRes.ok) {
    throw new Error(`GitHub tags API returned ${tagsRes.status}`);
  }

  const tagRefs = (await tagsRes.json()) as Array<{ ref?: string }>;
  const latestTag = tagRefs
    .map((entry) => entry.ref?.split("/").pop()?.trim() ?? "")
    .filter(isStableVersionTag)
    .sort(compareVersions)
    .at(-1);

  if (!latestTag) {
    throw new Error("No stable vX.Y.Z tags were found on GitHub");
  }

  const releaseRes = await fetch(GITHUB_RELEASE_BY_TAG_API(latestTag), {
    headers: buildRequestHeaders(),
    signal,
  });

  if (!releaseRes.ok) {
    return buildFallbackRelease(latestTag);
  }

  const release = (await releaseRes.json()) as {
    html_url?: string;
    body?: string;
    published_at?: string;
  };

  return {
    latestVersion: normalizeTag(latestTag),
    releaseUrl: release.html_url ?? `${GITHUB_REPO_URL}/releases/tag/${latestTag}`,
    releaseNotes: release.body ?? "",
    publishedAt: release.published_at ?? "",
  };
}

export async function updatesRoutes(app: FastifyInstance) {
  // ── Check for updates ──
  // GET /api/updates/check
  // Fetches the newest stable Git tag from GitHub, then hydrates it
  // with matching release metadata when that release exists.
  // For git installs, also checks if the local commit is behind origin/main.
  app.get("/check", async (_req, reply) => {
    const now = Date.now();
    const currentCommit = getBuildCommit();
    const currentBuild = getBuildLabel();
    const gitInstall = isGitInstall();

    // Check commits behind for git installs
    let commitsBehind: number | null = null;
    if (gitInstall) {
      if (cachedCommitsBehind !== null && now - commitCheckTimestamp < COMMIT_CHECK_TTL_MS) {
        commitsBehind = cachedCommitsBehind;
      } else {
        commitsBehind = await getCommitsBehind();
        cachedCommitsBehind = commitsBehind;
        commitCheckTimestamp = now;
      }
    }

    // Return cached release info if fresh
    if (cachedRelease && now - cacheTimestamp < CACHE_TTL_MS) {
      const versionUpdate = isNewerVersion(APP_VERSION, cachedRelease.latestVersion);
      return {
        currentVersion: APP_VERSION,
        currentCommit,
        currentBuild,
        ...cachedRelease,
        updateAvailable: versionUpdate || (commitsBehind != null && commitsBehind > 0),
        versionUpdate,
        commitsBehind: commitsBehind ?? 0,
        installType: gitInstall ? "git" : "standalone",
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        cachedRelease = await resolveLatestReleaseFromGitHub(controller.signal);
      } finally {
        clearTimeout(timeout);
      }
      cacheTimestamp = now;

      const versionUpdate = isNewerVersion(APP_VERSION, cachedRelease.latestVersion);
      return {
        currentVersion: APP_VERSION,
        currentCommit,
        currentBuild,
        ...cachedRelease,
        updateAvailable: versionUpdate || (commitsBehind != null && commitsBehind > 0),
        versionUpdate,
        commitsBehind: commitsBehind ?? 0,
        installType: gitInstall ? "git" : "standalone",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({
        error: `Failed to check for updates: ${message}`,
        currentVersion: APP_VERSION,
        currentCommit,
        currentBuild,
        updateAvailable: commitsBehind != null && commitsBehind > 0,
        commitsBehind: commitsBehind ?? 0,
      });
    }
  });

  // ── Apply update (git installs only) ──
  // POST /api/updates/apply
  // Fast-forwards to origin/main, installs, rebuilds, then signals the process to restart.
  app.post("/apply", async (_req, reply) => {
    if (!isGitInstall()) {
      return reply.status(400).send({
        error:
          "Auto-update is only available for git-based installs. For Docker, run: docker compose pull && docker compose up -d",
        installType: "standalone",
      });
    }

    const root = getMonorepoRoot();

    try {
      const currentBranch = await getCurrentBranch(root);
      const oldHead = await resolveGitRef(root, "HEAD");
      if (!oldHead) {
        throw new Error("Could not read the current git commit.");
      }

      await fetchUpdateRef(root);
      const targetHead = await resolveGitRef(root, UPDATE_REF);
      if (!targetHead) {
        throw new Error(`Could not resolve ${UPDATE_REF}.`);
      }

      // Step 0: stash local tracked changes so the fast-forward does not fail.
      let stashed = false;
      try {
        if (await hasTrackedChanges(root)) {
          await execFileAsync("git", ["stash", "push", "-q", "-m", "auto-stash before update"], {
            cwd: root,
            timeout: 10_000,
          });
          stashed = true;
        }
      } catch {
        /* clean tree — nothing to stash */
      }

      // Step 1: fast-forward to the latest origin/main commit.
      if (oldHead !== targetHead) {
        try {
          await execFileAsync("git", ["merge", "--ff-only", UPDATE_REF], {
            cwd: root,
            timeout: 60_000,
          });
        } catch (mergeErr) {
          if (stashed) await execFileAsync("git", ["stash", "pop", "-q"], { cwd: root, timeout: 10_000 }).catch(() => {});
          const branchLabel = currentBranch ? ` branch "${currentBranch}"` : " current checkout";
          const message = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
          throw new Error(`Could not fast-forward the${branchLabel} to ${UPDATE_REF}: ${message}`);
        }
      }

      // Restore stashed changes after successful pull
      if (stashed) {
        await execFileAsync("git", ["stash", "pop", "-q"], { cwd: root, timeout: 10_000 }).catch(() => {});
      }

      const newHead = await resolveGitRef(root, "HEAD");
      if (!newHead) {
        throw new Error("Could not read the updated git commit.");
      }
      if (newHead !== targetHead) {
        throw new Error(`Update target mismatch: expected ${UPDATE_REF} at ${targetHead}, got ${newHead}.`);
      }

      const alreadyUpToDate = oldHead === targetHead;

      // If HEAD already matches origin/main, check if the source actually differs
      // from the running build (e.g. previous update pulled code but failed to build,
      // or the running dist is from a stale commit).
      if (alreadyUpToDate) {
        const currentCommitHash = getBuildCommit();
        const sourceCommit = await resolveGitRef(root, "HEAD", 12);

        // If the commit we're running matches HEAD and version matches, truly up to date
        if (sourceCommit && currentCommitHash && sourceCommit === currentCommitHash) {
          const { readFileSync } = await import("fs");
          try {
            const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
            if ((pkg.version as string) === APP_VERSION) {
              return { status: "already_up_to_date", message: "Already on the latest version." };
            }
          } catch {
            return { status: "already_up_to_date", message: "Already on the latest version." };
          }
        }
        // Otherwise, source differs from running build — need to rebuild
      }

      // Step 2: pnpm install
      // shell: true is required on Windows where pnpm is a .cmd file
      await execFileAsync("pnpm", ["install", "--frozen-lockfile"], {
        cwd: root,
        timeout: 120_000,
        shell: true,
      });

      // Step 3: Rebuild all packages
      await execFileAsync("pnpm", ["build"], {
        cwd: root,
        timeout: 300_000,
        shell: true,
      });

      // Step 4: Signal exit so the user can relaunch with the new version.
      // Send response first, then schedule exit.
      const result = {
        status: "updated",
        message: "Update applied successfully. Please relaunch the app to use the new version.",
      };

      // Give Fastify time to flush the response, then exit
      setTimeout(() => {
        console.log("[Update] Shutting down after update...");
        process.exit(0);
      }, 500);

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: `Update failed: ${message}`,
        hint: `You can try running the update manually: git fetch ${UPDATE_REMOTE} ${UPDATE_BRANCH} && git merge --ff-only ${UPDATE_REF} && pnpm install && pnpm build`,
      });
    }
  });
}
