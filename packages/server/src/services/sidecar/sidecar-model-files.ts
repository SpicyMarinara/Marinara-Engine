import { basename } from "path";

export function isLikelyMmprojModelPath(modelPath: string): boolean {
  const filename = basename(modelPath).toLowerCase();
  return filename.includes("mmproj") || /(?:^|[-_.])mm-?proj(?:[-_.]|$)/i.test(filename) || filename.includes("projector");
}

export function isSupportedLlamaCppModelFilename(modelPath: string): boolean {
  return modelPath.toLowerCase().endsWith(".gguf") && !isLikelyMmprojModelPath(modelPath);
}

export function assertSupportedLlamaCppModelPath(modelPath: string): void {
  if (isLikelyMmprojModelPath(modelPath)) {
    throw new Error(
      "The selected GGUF is a multimodal projector (mmproj), not a chat model. Select the main model GGUF instead.",
    );
  }
}
