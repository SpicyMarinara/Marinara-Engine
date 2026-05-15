import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const ANDROID_APK_NOTICE = `> [!IMPORTANT]
> **Android APK notice:** The APK is not a standalone Marinara Engine app yet. It is a WebView shell for the local Marinara server, so Termux must be installed and \`./start-termux.sh\` must be running on the same Android device before you open the APK. Follow the [Android (Termux) installation guide](https://github.com/Pasta-Devs/Marinara-Engine/blob/main/docs/installation/android-termux.md) first; the APK is only an optional home-screen shell.

`;

function parseArgs(args) {
  // pnpm 10 forwards a literal `--` separator into argv; skip any leading `--` entries.
  const filtered = args.filter((arg) => arg !== "--");
  const [version, ...rest] = filtered;
  if (!version) {
    throw new Error("Usage: node scripts/render-release-notes.mjs <version> [--output <path>]");
  }

  const outputFlagIndex = rest.findIndex((arg) => arg === "--output");
  const outputPath = outputFlagIndex === -1 ? null : rest[outputFlagIndex + 1];
  if (outputFlagIndex !== -1 && !outputPath) {
    throw new Error("Missing value for --output");
  }

  return {
    version: version.replace(/^v/, ""),
    outputPath: outputPath ? resolve(REPO_ROOT, outputPath) : null,
  };
}

function extractReleaseEntry(changelog, version) {
  // Accept both historical `## [X.Y.Z]` and newer `## vX.Y.Z` heading formats.
  const headingPatterns = [`## [${version}]`, `## v${version}`, `## ${version}`];
  let start = -1;
  let heading = "";
  for (const candidate of headingPatterns) {
    const idx = changelog.indexOf(candidate);
    if (idx !== -1) {
      start = idx;
      heading = candidate;
      break;
    }
  }
  if (start === -1) {
    throw new Error(`CHANGELOG.md does not contain an entry for ${version}`);
  }

  const afterHeading = changelog.slice(start + heading.length);
  // Next section may use either heading style.
  const nextSectionOffset = afterHeading.search(/\n## (\[|v?\d)/);
  const body = (nextSectionOffset === -1 ? afterHeading : afterHeading.slice(0, nextSectionOffset)).trim();

  if (!body) {
    throw new Error(`CHANGELOG.md entry for ${version} is empty`);
  }

  return body + "\n";
}

try {
  const { version, outputPath } = parseArgs(process.argv.slice(2));
  const changelog = await readFile(resolve(REPO_ROOT, "CHANGELOG.md"), "utf8");
  const notes = ANDROID_APK_NOTICE + extractReleaseEntry(changelog, version);

  if (outputPath) {
    await writeFile(outputPath, notes);
  } else {
    process.stdout.write(notes);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
