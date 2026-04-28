// ──────────────────────────────────────────────
// Taskbar Shortcut Migration (Windows-only)
// ──────────────────────────────────────────────
// Re-points the user's Start Menu and Desktop "Marinara Engine" shortcuts at
// the bundled MarinaraLauncher.exe and stamps an AppUserModelID on the .lnk,
// so that pinning the shortcut to the taskbar groups the running console
// under the pinned icon (instead of spawning a separate generic cmd entry).
//
// Idempotent: if a shortcut already targets the launcher we skip it. Only
// shortcuts that currently point at *this* install's start.bat are touched —
// other Marinara installs and unrelated shortcuts are left alone.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "../../lib/logger.js";

const AUMID = "Pasta-Devs.MarinaraEngine";
const SHORTCUT_TITLE = "Marinara Engine";

function readShortcutTarget(lnkPath: string): string | null {
  const cmd =
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); " +
    "Write-Output $s.TargetPath";
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    { encoding: "utf8", env: { ...process.env, LNK: lnkPath }, windowsHide: true },
  );
  if (res.status !== 0) return null;
  return (res.stdout ?? "").trim() || null;
}

function pathsEqual(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function rewriteShortcut(lnkPath: string, exe: string, args: string, workDir: string, icon: string): boolean {
  const cmd =
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); " +
    "$s.TargetPath = $env:EXE; " +
    "$s.Arguments = $env:ARGS; " +
    "$s.WorkingDirectory = $env:WD; " +
    "$s.IconLocation = $env:ICON; " +
    "$s.Save()";
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    {
      encoding: "utf8",
      env: { ...process.env, LNK: lnkPath, EXE: exe, ARGS: args, WD: workDir, ICON: icon },
      windowsHide: true,
    },
  );
  return res.status === 0;
}

function stampAumid(launcherExe: string, lnkPath: string): boolean {
  const res = spawnSync(launcherExe, ["--stamp-lnk", lnkPath, AUMID], { windowsHide: true });
  return res.status === 0;
}

export function migrateTaskbarShortcuts(installDir: string): void {
  if (process.platform !== "win32") return;

  const launcherExe = join(installDir, "MarinaraLauncher.exe");
  if (!existsSync(launcherExe)) {
    logger.debug("Taskbar migration: MarinaraLauncher.exe not present, skipping");
    return;
  }

  const startBat = join(installDir, "start.bat");
  if (!existsSync(startBat)) {
    logger.debug("Taskbar migration: start.bat not present, skipping");
    return;
  }

  const appData = process.env.APPDATA;
  const userProfile = process.env.USERPROFILE;
  const candidates: string[] = [];
  if (appData) {
    candidates.push(join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Marinara Engine", "Marinara Engine.lnk"));
  }
  if (userProfile) {
    candidates.push(join(userProfile, "Desktop", "Marinara Engine.lnk"));
  }
  // Test-only escape hatch — comma/semicolon-delimited extra .lnk paths to consider.
  const extra = process.env.MARINARA_LAUNCHER_TEST_LNKS;
  if (extra) {
    for (const p of extra.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
      candidates.push(p);
    }
  }

  const iconPath = join(installDir, "app-icon.ico");
  const iconLocation = `${iconPath},0`;
  const argsLine = `${AUMID} "${startBat}" "${SHORTCUT_TITLE}"`;
  const workDir = installDir;

  for (const lnk of candidates) {
    if (!existsSync(lnk)) continue;

    const currentTarget = readShortcutTarget(lnk);
    if (!currentTarget) {
      logger.warn("Taskbar migration: could not read target for %s, skipping", lnk);
      continue;
    }

    if (pathsEqual(currentTarget, launcherExe)) {
      logger.debug("Taskbar migration: %s already targets the launcher, skipping", lnk);
      continue;
    }

    if (!pathsEqual(currentTarget, startBat)) {
      logger.debug(
        "Taskbar migration: %s targets %s (not this install), skipping",
        lnk,
        currentTarget,
      );
      continue;
    }

    if (!rewriteShortcut(lnk, launcherExe, argsLine, workDir, iconLocation)) {
      logger.warn("Taskbar migration: failed to rewrite %s", lnk);
      continue;
    }

    if (!stampAumid(launcherExe, lnk)) {
      logger.warn("Taskbar migration: failed to stamp AUMID on %s", lnk);
      continue;
    }

    logger.info("Migrated taskbar shortcut: %s", lnk);
  }
}
