import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

try {
  const { stdout } = await execFileAsync("git", ["ls-files", "--", "win/installer/*.exe"], {
    cwd: REPO_ROOT,
    shell: process.platform === "win32",
  });

  const trackedInstallers = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (trackedInstallers.length > 0) {
    console.error("Tracked installer binaries are not allowed in the repository:");
    for (const file of trackedInstallers) {
      console.error(`- ${file}`);
    }
    console.error("Publish installer artifacts on GitHub Releases instead.");
    process.exit(1);
  }

  console.log("No tracked installer binaries found.");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
