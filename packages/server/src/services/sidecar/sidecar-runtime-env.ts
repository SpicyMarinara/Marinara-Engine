import { delimiter, dirname } from "path";

type LlamaRuntimeEnvInput = {
  serverPath: string;
  source: string | null | undefined;
};

function prependPathEntry(currentValue: string | undefined, entry: string): string {
  const segments = (currentValue ?? "")
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== entry);

  return [entry, ...segments].join(delimiter);
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

  const runtimeDir = dirname(runtime.serverPath);
  if (platform === "linux" || platform === "android") {
    env.LD_LIBRARY_PATH = prependPathEntry(env.LD_LIBRARY_PATH, runtimeDir);
  } else if (platform === "darwin") {
    env.DYLD_LIBRARY_PATH = prependPathEntry(env.DYLD_LIBRARY_PATH, runtimeDir);
  }

  return env;
}
