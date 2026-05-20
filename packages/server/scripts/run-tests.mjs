// ──────────────────────────────────────────────
// Server test runner
// ──────────────────────────────────────────────
// Exists so the `test` package-script stays shell-agnostic. The natural
// inline form —
//
//   LOG_LEVEL=silent tsx --test src/.../*.test.ts
//
// is POSIX-only: cmd.exe / PowerShell read `LOG_LEVEL=silent` as a command
// name and fail with `'LOG_LEVEL' is not recognized` before a single test
// runs. Assigning the env var in JS and spawning tsx ourselves behaves
// identically on Linux, macOS, and Windows.

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Quiet the Pino logger for the run unless the caller set a level explicitly.
// Several suites deliberately exercise warn-level log paths (orphan-sweep
// failures, resume demotion, malformed tool-call ids); silencing keeps the
// runner output readable. `??=` so an explicit `LOG_LEVEL=debug` still wins.
process.env.LOG_LEVEL ??= "silent";

// `node:test` (Node >= 21) expands these glob patterns itself, so no shell
// globbing is needed — which matters on Windows, where cmd.exe does not
// expand `*`. Passing them literally gives identical behavior everywhere.
const TEST_GLOBS = [
  "src/services/llm/providers/__tests__/*.test.ts",
  "src/services/llm/providers/claude-subscription/__tests__/*.test.ts",
];

// Going through tsx's CLI entry and the current Node binary (rather than a
// bare `tsx` on PATH) keeps the runner working whether it's invoked as a
// package script or by hand, and sidesteps the platform-specific bin shim
// (`tsx` vs `tsx.cmd`) and the shell entirely.
const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const result = spawnSync(process.execPath, [tsxCli, "--test", ...TEST_GLOBS], {
  stdio: "inherit",
  cwd: packageRoot,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
