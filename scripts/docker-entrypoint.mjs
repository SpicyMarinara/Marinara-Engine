import { existsSync, lchownSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const DEFAULT_COMMAND = ["node", "packages/server/dist/index.js"];

function log(message) {
  process.stderr.write(`[docker-entrypoint] ${message}\n`);
}

function parseNameServiceFile(path, nameOrId, fieldIndex) {
  if (/^\d+$/.test(nameOrId)) return Number(nameOrId);

  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n");
  } catch {
    return null;
  }

  for (const row of rows) {
    const fields = row.split(":");
    if (fields[0] === nameOrId) {
      const parsed = Number(fields[fieldIndex]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function resolveUid(user) {
  return parseNameServiceFile("/etc/passwd", user, 2);
}

function resolveGid(group) {
  return parseNameServiceFile("/etc/group", group, 2);
}

function resolveStoragePath(value) {
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function shouldRepairOwnership(path, uid, gid) {
  if (!existsSync(path)) return true;
  const stat = lstatSync(path);
  return stat.uid !== uid || stat.gid !== gid;
}

function chownRecursive(path, uid, gid) {
  const stack = [path];
  let firstError = null;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    try {
      const stat = lstatSync(current);
      lchownSync(current, uid, gid);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;

      for (const child of readdirSync(current)) {
        stack.push(join(current, child));
      }
    } catch (error) {
      firstError ??= error;
    }
  }

  if (firstError) throw firstError;
}

function prepareDataDirectories(uid, gid) {
  const dataDir = resolveStoragePath(process.env.DATA_DIR) ?? "/app/data";
  const fileStorageDir = resolveStoragePath(process.env.FILE_STORAGE_DIR) ?? join(dataDir, "storage");
  const dirs = [...new Set([dataDir, fileStorageDir])];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  if (process.env.MARINARA_SKIP_DATA_CHOWN === "true") return;

  for (const dir of dirs) {
    if (!shouldRepairOwnership(dir, uid, gid)) continue;
    log(`Repairing ownership for ${dir}`);
    chownRecursive(dir, uid, gid);
  }
}

function dropPrivileges(uid, gid) {
  process.setgid(gid);
  process.setuid(uid);
}

function run() {
  const command = process.argv.slice(2);
  const [bin, ...args] = command.length > 0 ? command : DEFAULT_COMMAND;

  if (process.getuid?.() === 0) {
    const user = process.env.MARINARA_DOCKER_USER ?? "node";
    const group = process.env.MARINARA_DOCKER_GROUP ?? user;
    const uid = resolveUid(user);
    const gid = resolveGid(group);

    if (uid == null || gid == null) {
      log(`Could not resolve runtime user "${user}:${group}"; continuing as root.`);
    } else {
      try {
        prepareDataDirectories(uid, gid);
      } catch (error) {
        log(`Could not repair data directory ownership: ${error instanceof Error ? error.message : String(error)}`);
      }
      dropPrivileges(uid, gid);
    }
  }

  const child = spawn(bin, args, { stdio: "inherit", env: process.env });
  const forwardSignal = (signal) => {
    child.kill(signal);
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.on("error", (error) => {
    log(`Failed to start ${bin}: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(128 + (osConstants.signals[signal] ?? 0));
    }
    process.exit(code ?? 0);
  });
}

run();
