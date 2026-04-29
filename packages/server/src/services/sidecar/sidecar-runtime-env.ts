import { delimiter, dirname, win32 } from "path";

type LlamaRuntimeEnvInput = {
  serverPath: string;
  directoryPath?: string;
  source: string | null | undefined;
};

function prependPathEntry(currentValue: string | undefined, entry: string, pathDelimiter = delimiter): string {
  const segments = (currentValue ?? "")
    .split(pathDelimiter)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== entry);

  return [entry, ...segments].join(pathDelimiter);
}

export function buildLlamaProcessEnv(
  runtime: LlamaRuntimeEnvInput,
  platform: NodeJS.Platform = process.platform,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };

  if (runtime.source !== "bundled") {
    return env;
  }

  if (platform === "win32") {
    const runtimeDir = win32.dirname(runtime.serverPath);
    // Windows exposes process.env as a case-insensitive Proxy, but spreading
    // it into a plain object preserves the native key casing (typically "Path").
    // Writing to env.PATH when the real key is "Path" creates a duplicate,
    // causing the child process to lose its system PATH and breaking DLL
    // resolution for CUDA and other GPU backends.
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    env[pathKey] = prependPathEntry(
      prependPathEntry(env[pathKey], runtimeDir, win32.delimiter),
      runtime.directoryPath ?? runtimeDir,
      win32.delimiter,
    );
  } else {
    const runtimeDir = dirname(runtime.serverPath);
    if (platform === "linux" || platform === "android") {
      env.LD_LIBRARY_PATH = prependPathEntry(env.LD_LIBRARY_PATH, runtimeDir);
    } else if (platform === "darwin") {
      env.DYLD_LIBRARY_PATH = prependPathEntry(env.DYLD_LIBRARY_PATH, runtimeDir);
    }
  }

  return env;
}
