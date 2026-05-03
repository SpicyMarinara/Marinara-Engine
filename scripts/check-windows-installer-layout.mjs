import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const installerPath = resolve(REPO_ROOT, "win/installer/installer.nsi");

try {
  const content = await readFile(installerPath, "utf8");
  const lines = content.split(/\r?\n/);
  const code = lines.map((line) => (/^\s*;/.test(line) ? "" : line)).join("\n");

  const unsafePatterns = [
    {
      pattern: /\bgit clone\b[^\r\n]*"?\$INSTDIR\\repo-temp"?/i,
      message: 'Initial clone target must not be under "$INSTDIR".',
    },
    {
      pattern: /\brobocopy\s+"?\$INSTDIR\\repo-temp"?\s+"?\$INSTDIR"?\b/i,
      message: 'Do not robocopy from "$INSTDIR\\repo-temp" into its parent "$INSTDIR".',
    },
    {
      pattern:
        /\bStrCpy\s+\$[A-Za-z0-9_]+\s+(?:"\$TEMP\\MarinaraEngine-repo-temp"|\$TEMP\\MarinaraEngine-repo-temp)\s*(?:\r?\n|$)/i,
      message: 'Temporary clone paths must include a per-run suffix, not fixed "$TEMP\\MarinaraEngine-repo-temp".',
    },
    {
      pattern: /\bStrCpy\s+\$[A-Za-z0-9_]+\s+(?:"\$INSTDIR\.__stage"|\$INSTDIR\.__stage)\s*(?:\r?\n|$)/i,
      message: 'Temporary stage paths must include a per-run suffix, not fixed "$INSTDIR.__stage".',
    },
  ];

  const failures = unsafePatterns.filter(({ pattern }) => pattern.test(code));

  const unsafeVariableAssignments = [
    {
      pattern: /\bStrCpy\s+(\$[A-Za-z0-9_]+)\s+"?\$INSTDIR\\repo-temp"?\b/i,
      message: (variable) => `Temporary clone variable ${variable} must not point under "$INSTDIR".`,
    },
    {
      pattern: /\b(?:SetEnv|SetEnvironmentVariable)\s+(\$[A-Za-z0-9_]+)\s+"?\$INSTDIR\\repo-temp"?\b/i,
      message: (variable) => `Environment staging variable ${variable} must not point under "$INSTDIR".`,
    },
  ];

  const unsafeVariables = new Map();
  for (const line of lines) {
    const codeLine = /^\s*;/.test(line) ? "" : line;
    for (const { pattern, message } of unsafeVariableAssignments) {
      const match = pattern.exec(codeLine);
      if (match) {
        const variable = match[1].toUpperCase();
        unsafeVariables.set(variable, message(match[1]));
      }
    }
  }

  for (const message of unsafeVariables.values()) {
    failures.push({ message });
  }

  for (const [variable] of unsafeVariables) {
    const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const unsafeVariableUse = new RegExp(`\\b(?:git clone|robocopy)\\b[^\\r\\n]*"?${escapedVariable}"?\\b`, "i");
    if (unsafeVariableUse.test(code)) {
      failures.push({
        message: `Do not use ${variable} as a git clone or robocopy source after assigning it under "$INSTDIR".`,
      });
    }
  }

  if (failures.length > 0) {
    console.error("Unsafe Windows installer staging layout detected:");
    for (const failure of failures) {
      console.error(`- ${failure.message}`);
    }
    console.error("Stage repository clones outside the final install directory.");
    process.exit(1);
  }

  console.log("Windows installer staging layout is safe.");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
