import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..");

const README_RELEASE_LINE =
  "Current stable release: **[v%s](https://github.com/Pasta-Devs/Marinara-Engine/releases/tag/v%s)**.";

function format(template, ...values) {
  let next = template;
  for (const value of values) {
    next = next.replace("%s", value);
  }
  return next;
}

async function readText(relativePath) {
  return readFile(resolve(REPO_ROOT, relativePath), "utf8");
}

async function writeText(relativePath, content) {
  await writeFile(resolve(REPO_ROOT, relativePath), content);
}

function replaceOrThrow(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Could not find ${label}`);
  }

  return content.replace(pattern, replacement);
}

function updateJsonVersion(content, version) {
  return replaceOrThrow(content, /"version":\s*"[^"]+"/, `"version": "${version}"`, "package version");
}

function updateSharedDefaults(content, version) {
  return replaceOrThrow(
    content,
    /export const APP_VERSION = "[^"]+";/,
    `export const APP_VERSION = "${version}";`,
    "APP_VERSION constant",
  );
}

function updateInstallerNsi(content, version) {
  return replaceOrThrow(content, /!define APP_VERSION "[^"]+"/, `!define APP_VERSION "${version}"`, "NSIS APP_VERSION");
}

function updateInstallerBat(content, version) {
  return replaceOrThrow(
    content,
    /(echo\s+\^\|\s+v)(\d+\.\d+\.\d+)(\s+\^\|)/,
    `$1${version}$3`,
    "installer banner version",
  );
}

function updateAndroidBuildGradle(content, version, androidVersionCode) {
  let next = replaceOrThrow(content, /versionName "[^"]+"/, `versionName "${version}"`, "Android versionName");

  if (androidVersionCode != null) {
    next = replaceOrThrow(next, /versionCode \d+/, `versionCode ${androidVersionCode}`, "Android versionCode");
  }

  return next;
}

function updateReadme(content, version) {
  return replaceOrThrow(
    content,
    /Current stable release: \*\*\[v[^\]]+\]\(https:\/\/github\.com\/Pasta-Devs\/Marinara-Engine\/releases\/tag\/v[^)]+\)\*\*\./,
    format(README_RELEASE_LINE, version, version),
    "README latest release line",
  );
}

export async function readCanonicalVersion() {
  const packageJson = JSON.parse(await readText("package.json"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("Root package.json is missing a version");
  }
  return packageJson.version;
}

export async function readAndroidVersionCode() {
  const buildGradle = await readText("android/app/build.gradle");
  const match = buildGradle.match(/versionCode (\d+)/);
  if (!match) {
    throw new Error("Could not read Android versionCode");
  }
  return Number.parseInt(match[1], 10);
}

const DERIVED_VERSION_FILES = [
  {
    path: "packages/client/package.json",
    render: (content, version) => updateJsonVersion(content, version),
  },
  {
    path: "packages/server/package.json",
    render: (content, version) => updateJsonVersion(content, version),
  },
  {
    path: "packages/shared/package.json",
    render: (content, version) => updateJsonVersion(content, version),
  },
  {
    path: "packages/shared/src/constants/defaults.ts",
    render: (content, version) => updateSharedDefaults(content, version),
  },
  {
    path: "win/installer/installer.nsi",
    render: (content, version) => updateInstallerNsi(content, version),
  },
  {
    path: "win/installer/install.bat",
    render: (content, version) => updateInstallerBat(content, version),
  },
  {
    path: "android/app/build.gradle",
    render: (content, version, androidVersionCode) => updateAndroidBuildGradle(content, version, androidVersionCode),
  },
  {
    path: "README.md",
    render: (content, version) => updateReadme(content, version),
  },
];

async function buildExpectedFiles(androidVersionCode) {
  const version = await readCanonicalVersion();
  const resolvedAndroidVersionCode = androidVersionCode ?? (await readAndroidVersionCode());
  const files = [];

  for (const spec of DERIVED_VERSION_FILES) {
    const current = await readText(spec.path);
    files.push({
      path: spec.path,
      current,
      expected: spec.render(current, version, resolvedAndroidVersionCode),
    });
  }

  return { version, androidVersionCode: resolvedAndroidVersionCode, files };
}

export async function syncVersionFiles(options = {}) {
  const state = await buildExpectedFiles(options.androidVersionCode);
  const changed = [];

  for (const file of state.files) {
    if (file.current === file.expected) continue;
    await writeText(file.path, file.expected);
    changed.push(file.path);
  }

  return {
    version: state.version,
    androidVersionCode: state.androidVersionCode,
    changed,
  };
}

export async function checkVersionDrift() {
  const state = await buildExpectedFiles();
  return {
    version: state.version,
    androidVersionCode: state.androidVersionCode,
    mismatches: state.files.filter((file) => file.current !== file.expected).map((file) => file.path),
  };
}
