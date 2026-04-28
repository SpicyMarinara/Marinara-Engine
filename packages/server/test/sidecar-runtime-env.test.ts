import test from "node:test";
import assert from "node:assert/strict";
import { delimiter } from "node:path";
import { buildLlamaProcessEnv } from "../src/services/sidecar/sidecar-runtime-env.js";

test("adds the bundled runtime directory to LD_LIBRARY_PATH on Android", () => {
  const env = buildLlamaProcessEnv(
    {
      source: "bundled",
      serverPath: "/data/data/com.termux/files/home/Marinara-Engine/packages/server/data/sidecar-runtime/b8851-android-arm64-cpu/llama-b8851/llama-server",
    },
    "android",
    {},
  );

  assert.equal(
    env.LD_LIBRARY_PATH,
    "/data/data/com.termux/files/home/Marinara-Engine/packages/server/data/sidecar-runtime/b8851-android-arm64-cpu/llama-b8851",
  );
});

test("prepends the bundled runtime directory only once", () => {
  const runtimeDir = "/app/data/sidecar-runtime/b8855-linux-x64-cpu/llama-b8855";
  const env = buildLlamaProcessEnv(
    {
      source: "bundled",
      serverPath: `${runtimeDir}/llama-server`,
    },
    "linux",
    {
      LD_LIBRARY_PATH: `${runtimeDir}${delimiter}/usr/lib`,
    },
  );

  assert.equal(env.LD_LIBRARY_PATH, `${runtimeDir}${delimiter}/usr/lib`);
});

test("leaves system runtimes unchanged", () => {
  const env = buildLlamaProcessEnv(
    {
      source: "system",
      serverPath: "/usr/bin/llama-server",
    },
    "linux",
    {
      LD_LIBRARY_PATH: "/usr/lib",
    },
  );

  assert.equal(env.LD_LIBRARY_PATH, "/usr/lib");
});

test("prepends bundled runtime directories to PATH on Windows", () => {
  const env = buildLlamaProcessEnv(
    {
      source: "bundled",
      directoryPath: "C:\\Marinara\\sidecar-runtime\\b8934-win-x64-cuda",
      serverPath: "C:\\Marinara\\sidecar-runtime\\b8934-win-x64-cuda\\llama-server.exe",
    },
    "win32",
    {
      PATH: "C:\\Windows\\System32",
    },
  );

  assert.equal(
    env.PATH,
    `C:\\Marinara\\sidecar-runtime\\b8934-win-x64-cuda${delimiter}C:\\Windows\\System32`,
  );
});
