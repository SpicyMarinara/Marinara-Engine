// Tests for the synthetic-session lifecycle module.
//
// File-system-touching tests use a per-test temp directory under
// `os.tmpdir()` so they never write to the real `~/.claude/projects/...`
// location (which would risk polluting the user's actual CC session list).

import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  assembleEntries,
  cleanupOrphanedSessions,
  cleanupSessionFile,
  constructSessionFile,
  sessionsDirFor,
  type ConstructOptions,
} from "../synthetic-session.ts";
import type { CommonSessionMeta } from "../jsonl-entries.ts";
import type { ChatMessage } from "../../../base-provider.ts";

const META: CommonSessionMeta = {
  sessionId: "fixed-session-id",
  cwd: "/tmp/test-cwd",
  version: "test-1.0.0",
  gitBranch: "test-branch",
  permissionMode: "bypassPermissions",
};

// `synthetic-session` is a Linux/macOS-only module: `constructSessionFile`
// throws on win32 and the provider falls back to transcript-fold there, so
// none of this module's code path runs on Windows. Skipping these suites on
// win32 avoids asserting POSIX path math and a Unix-only write path on a
// platform where neither executes — coverage the Linux run already provides.
// The win32 contract that *does* matter — the provider selecting the fold
// path — is asserted in `claude-subscription.provider.test.ts`.
const WIN32_SKIP =
  process.platform === "win32" && "synthetic-session is Unix-only (win32 uses the fold path)";

describe("sessionsDirFor", { skip: WIN32_SKIP }, () => {
  // The default-path tests assume CLAUDE_CONFIG_DIR is unset (so the
  // function falls back to `~/.claude`). Developers running this suite in
  // a shell with CLAUDE_CONFIG_DIR exported for their own Claude Code
  // install would otherwise see spurious failures here. Save/clear before
  // each test and restore after so the env var becomes a per-test opt-in.
  let priorConfigDir: string | undefined;
  beforeEach(() => {
    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
  });
  afterEach(() => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
  });

  it("replaces every '/' with '-' in the cwd to match CC's project-dir convention", () => {
    const dir = sessionsDirFor("/home/user/project");
    assert.ok(dir.endsWith("/.claude/projects/-home-user-project"), `unexpected suffix: ${dir}`);
  });

  it("handles a cwd that already starts at root", () => {
    const dir = sessionsDirFor("/");
    assert.ok(dir.endsWith("/.claude/projects/-"));
  });

  it("honors CLAUDE_CONFIG_DIR, replacing the ~/.claude prefix per SDK contract", () => {
    process.env.CLAUDE_CONFIG_DIR = "/var/lib/marinara/claude-config";
    const dir = sessionsDirFor("/home/user/project");
    assert.strictEqual(dir, "/var/lib/marinara/claude-config/projects/-home-user-project");
  });
});

describe("assembleEntries", { skip: WIN32_SKIP }, () => {
  it("skips system messages (they ride systemPrompt, not the JSONL)", () => {
    const history: ChatMessage[] = [
      { role: "system", content: "you are helpful" },
      { role: "user", content: "hi" },
    ];
    const entries = assembleEntries(history, META, "m");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.type, "user");
  });

  it("chains parentUuid pointers in order", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
    ];
    const entries = assembleEntries(history, META, "m");
    assert.equal(entries.length, 3);
    assert.equal(entries[0]!.parentUuid, null);
    assert.equal(entries[1]!.parentUuid, entries[0]!.uuid);
    assert.equal(entries[2]!.parentUuid, entries[1]!.uuid);
  });

  it("routes role=tool messages through buildUserEntry (tool_result blocks)", () => {
    const history: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }],
      },
      { role: "tool", content: "result text", tool_call_id: "t1" },
    ];
    const entries = assembleEntries(history, META, "m");
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.type, "assistant");
    assert.equal(entries[1]!.type, "user");
    const blocks = entries[1]!.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks[0]!["type"], "tool_result");
    assert.equal(blocks[0]!["tool_use_id"], "t1");
  });

  it("returns an empty entries array for empty history", () => {
    assert.deepEqual(assembleEntries([], META, "m"), []);
  });
});

describe("constructSessionFile", { skip: WIN32_SKIP }, () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "marinara-jsonl-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const baseOpts = (sessionsDir: string): ConstructOptions => ({
    model: "test-model",
    sessionsDir,
    gitBranch: "test-branch",
    sdkVersion: "test-1.0.0",
  });

  it("writes a JSONL file with one entry per history message", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const { sessionId, path } = await constructSessionFile(history, baseOpts(dir));
    assert.ok(sessionId.length > 0);
    assert.ok(path.startsWith(dir), "path should be inside the override dir");
    assert.ok(path.endsWith(`${sessionId}.jsonl`));
    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 2);
    const u = JSON.parse(lines[0]!) as Record<string, unknown>;
    const a = JSON.parse(lines[1]!) as Record<string, unknown>;
    assert.equal(u["type"], "user");
    assert.equal(a["type"], "assistant");
    assert.equal(u["sessionId"], sessionId);
    assert.equal(a["sessionId"], sessionId);
    assert.equal(u["gitBranch"], "test-branch");
    assert.equal(u["version"], "test-1.0.0");
  });

  it("writes a sidecar marker (.mr) alongside the JSONL so the sweep knows the file is ours", async () => {
    const { path } = await constructSessionFile(
      [{ role: "user", content: "hi" }],
      baseOpts(dir),
    );
    const sidecar = `${path}.mr`;
    const s = await stat(sidecar);
    assert.ok(s.isFile(), "sidecar should exist as a regular file");
    assert.equal(s.size, 0, "sidecar is a presence marker — content is not meaningful");
  });

  it("creates the sessions directory if it does not already exist", async () => {
    const nested = join(dir, "nested", "dir");
    await constructSessionFile([{ role: "user", content: "x" }], baseOpts(nested));
    const s = await stat(nested);
    assert.ok(s.isDirectory());
  });

  it("writes an empty file (no entries) when history is empty after filtering", async () => {
    // Only a system message; assembleEntries strips it, leaving zero entries.
    const { path } = await constructSessionFile(
      [{ role: "system", content: "s" }],
      baseOpts(dir),
    );
    const text = await readFile(path, "utf8");
    assert.equal(text, "");
  });
});

describe("cleanupSessionFile", { skip: WIN32_SKIP }, () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "marinara-jsonl-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("removes the named session file and its sidecar", async () => {
    const path = join(dir, "abc-123.jsonl");
    const sidecar = `${path}.mr`;
    await writeFile(path, "x\n", "utf8");
    await writeFile(sidecar, "", "utf8");
    await cleanupSessionFile(path);
    await assert.rejects(() => stat(path), /ENOENT/);
    await assert.rejects(() => stat(sidecar), /ENOENT/);
  });

  it("swallows ENOENT on both files (already gone is fine)", async () => {
    // Neither file exists; cleanup must not throw on either ENOENT.
    await cleanupSessionFile(join(dir, "does-not-exist.jsonl"));
  });

  it("removes the sidecar even if the JSONL was already gone (partial cleanup state)", async () => {
    // Simulates: sweep deleted JSONL, then crashed before deleting sidecar.
    // Next provider call invokes cleanupSessionFile which should still finish
    // the job — sidecar gone, no throw.
    const path = join(dir, "partial.jsonl");
    const sidecar = `${path}.mr`;
    await writeFile(sidecar, "", "utf8");
    await cleanupSessionFile(path);
    await assert.rejects(() => stat(sidecar), /ENOENT/);
  });

  it("integrates with constructSessionFile's returned path (no dir threading)", async () => {
    // Regression: prior API required threading `dir` through to cleanup.
    // The new API takes the path directly so callers can't forget which
    // sessionsDir override was used.
    const { path } = await constructSessionFile(
      [{ role: "user", content: "x" }],
      { model: "m", sessionsDir: dir, gitBranch: "b", sdkVersion: "v" },
    );
    await cleanupSessionFile(path);
    await assert.rejects(() => stat(path), /ENOENT/);
    await assert.rejects(() => stat(`${path}.mr`), /ENOENT/);
  });
});

describe("cleanupOrphanedSessions", { skip: WIN32_SKIP }, () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "marinara-jsonl-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 0 when the directory does not exist", async () => {
    const removed = await cleanupOrphanedSessions(1000, Date.now(), join(dir, "missing"));
    assert.equal(removed, 0);
  });

  it("removes sessions (jsonl + sidecar) older than maxAgeMs and keeps recent ones", async () => {
    const recentPath = join(dir, "recent.jsonl");
    const oldPath = join(dir, "old.jsonl");
    await writeFile(recentPath, "x", "utf8");
    await writeFile(`${recentPath}.mr`, "", "utf8");
    await writeFile(oldPath, "x", "utf8");
    await writeFile(`${oldPath}.mr`, "", "utf8");

    const now = Date.now();
    const oneHourAgo = (now - 60 * 60 * 1000) / 1000;
    // Backdate only the OLD session's sidecar — the sweep keys off sidecar
    // mtime, so this is what makes the session eligible for eviction.
    await utimes(`${oldPath}.mr`, oneHourAgo, oneHourAgo);

    const removed = await cleanupOrphanedSessions(30 * 60 * 1000, now, dir);
    assert.equal(removed, 1);
    await stat(recentPath); // still there
    await stat(`${recentPath}.mr`); // sidecar still there
    await assert.rejects(() => stat(oldPath), /ENOENT/);
    await assert.rejects(() => stat(`${oldPath}.mr`), /ENOENT/);
  });

  it("never touches a .jsonl that lacks a sidecar (real CLI sessions share this directory)", async () => {
    // This is THE invariant the sidecar mechanism exists to protect. The
    // user's `claude` CLI writes its real session history into the same
    // `<cwd>/projects/<cwd-as-dashes>/` directory we use. Sweeping a JSONL
    // without a sidecar would destroy genuine CLI session data.
    const cliSession = join(dir, "cli-real-session.jsonl");
    await writeFile(cliSession, "x", "utf8");
    const oneHourAgo = (Date.now() - 60 * 60 * 1000) / 1000;
    await utimes(cliSession, oneHourAgo, oneHourAgo);

    const removed = await cleanupOrphanedSessions(30 * 60 * 1000, Date.now(), dir);
    assert.equal(removed, 0);
    await stat(cliSession); // still there — sweep MUST not touch it
  });

  it("cleans up an orphan sidecar whose JSONL was already removed", async () => {
    // Crash scenario: cleanupSessionFile removed the JSONL, then the process
    // died before it could remove the sidecar. The next sweep should reap
    // the orphan sidecar so it doesn't linger forever.
    const sidecar = join(dir, "orphan.jsonl.mr");
    await writeFile(sidecar, "", "utf8");
    const oneHourAgo = (Date.now() - 60 * 60 * 1000) / 1000;
    await utimes(sidecar, oneHourAgo, oneHourAgo);

    const removed = await cleanupOrphanedSessions(30 * 60 * 1000, Date.now(), dir);
    assert.equal(removed, 1);
    await assert.rejects(() => stat(sidecar), /ENOENT/);
  });

  it("ignores non-sidecar files in the directory", async () => {
    // Sanity check: a stray .txt with an old mtime must not be deleted.
    const other = join(dir, "notes.txt");
    await writeFile(other, "x", "utf8");
    const oneHourAgo = (Date.now() - 60 * 60 * 1000) / 1000;
    await utimes(other, oneHourAgo, oneHourAgo);

    const removed = await cleanupOrphanedSessions(30 * 60 * 1000, Date.now(), dir);
    assert.equal(removed, 0);
    await stat(other); // still there
  });
});
